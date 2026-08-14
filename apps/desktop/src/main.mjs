/**
 * Electron main process — the Steam desktop shell.
 *
 * The shell reuses the EXISTING backend and frontend unchanged. It only:
 *   Create Room -> pick a loopback port, spawn the shared server (SQLite), create
 *                  a Steam lobby (host = owner), bridge remote players in over the
 *                  Steam tunnel, then load the game UI from the local server.
 *   Join        -> join the lobby, run the local tunnel to the host, then load the
 *                  game UI from the local tunnel port (frontend is none the wiser).
 *   Custom      -> load any http(s) URL directly (Docker self-host, domain, IP) —
 *                  the plain browser path, fully preserved.
 *
 * On close, the server, tunnels and lobby are torn down cleanly.
 */

import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import electron from 'electron';

import { startServer } from './serverProcess.mjs';
import { startTunnelHost } from './transport/tunnelHost.mjs';
import { startTunnelClient } from './transport/tunnelClient.mjs';
import { initSteam, createRoomLobby, joinLobby, lobbyOwnerId, createSteamChannel, startCallbackPump, onLobbyInvite } from './steam/steam.mjs';

const { app, BrowserWindow, ipcMain, shell } = electron;
const dirname = path.dirname(fileURLToPath(import.meta.url));
const STEAM_APP_ID = Number(process.env.OCT_STEAM_APPID || 480);

/** @type {{stop:Function}[]} */
let teardownStack = [];
let steam = null;
let stopPump = null;
let mainWindow = null;

/** Reserve a free loopback port by briefly binding it. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Tear down the current room (server + tunnels + lobby) in reverse order. */
async function endSession() {
  while (teardownStack.length) {
    const handle = teardownStack.pop();
    try {
      await handle.stop();
    } catch (error) {
      console.error('[teardown]', error?.message ?? error);
    }
  }
}

function serverExePath() {
  // Packaged: extraResources places the PyInstaller build under resources/server.
  return app.isPackaged ? path.join(process.resourcesPath, 'server', 'OpenClocktowerServer.exe') : undefined;
}

function backendDevCwd() {
  // Dev: run `py -m uvicorn` from the repo's apps/backend.
  return path.resolve(dirname, '..', '..', 'backend');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: '#0b0d13',
    webPreferences: {
      preload: path.join(dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // External links open in the real browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  return mainWindow.loadFile(path.join(dirname, 'launcher', 'launcher.html'));
}

// ── IPC: launcher actions ────────────────────────────────────────────────

ipcMain.handle('desktop:status', () => ({
  steam: Boolean(steam),
  steamId: steam?.steamId ?? null,
  appId: STEAM_APP_ID,
}));

ipcMain.handle('desktop:createRoom', async (_event, options = {}) => {
  if (!steam) {
    throw new Error('Steam is not running. Start Steam and relaunch, or use "Connect to server".');
  }
  await endSession();

  const port = await freePort();
  const dataDir = path.join(app.getPath('userData'), 'server');
  const server = await startServer({ port, dataDir, exePath: serverExePath(), devCwd: backendDevCwd() });
  teardownStack.push(server);

  const lobby = await createRoomLobby(steam.client, options);
  teardownStack.push({ stop: () => lobby.leave?.() });

  const channel = createSteamChannel(steam);
  teardownStack.push({ stop: () => channel.close() });
  const host = startTunnelHost({ channel, backendPort: port });
  teardownStack.push(host);
  steam.channel = channel;

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  return { port, lobbyId: String(lobby.id) };
});

ipcMain.handle('desktop:joinRoom', async (_event, lobbyId) => {
  if (!steam) {
    throw new Error('Steam is not running. Start Steam and relaunch, or use "Connect to server".');
  }
  await endSession();

  const lobby = await joinLobby(steam.client, lobbyId);
  teardownStack.push({ stop: () => lobby.leave?.() });
  const hostPeerId = lobbyOwnerId(lobby);

  const channel = createSteamChannel(steam);
  teardownStack.push({ stop: () => channel.close() });
  const tunnel = await startTunnelClient({ channel, hostPeerId, localPort: 0 });
  teardownStack.push(tunnel);
  steam.channel = channel;

  await mainWindow.loadURL(`http://127.0.0.1:${tunnel.port}/`);
  return { port: tunnel.port, hostPeerId };
});

ipcMain.handle('desktop:connectCustom', async (_event, url) => {
  await endSession();
  await mainWindow.loadURL(url);
  return { url };
});

ipcMain.handle('desktop:leaveRoom', async () => {
  await endSession();
  await mainWindow.loadFile(path.join(dirname, 'launcher', 'launcher.html'));
  return { ok: true };
});

// ── App lifecycle ────────────────────────────────────────────────────────

app.whenReady().then(() => {
  try {
    steam = initSteam(STEAM_APP_ID);
    steam.steamworks.electronEnableSteamOverlay?.();
    stopPump = startCallbackPump(steam.client);
    // If a friend accepts a Steam invite, join that lobby automatically.
    onLobbyInvite(steam, (lobbyId) => mainWindow?.webContents.send('desktop:autojoin', lobbyId));
  } catch (error) {
    // Steam not running is not fatal: the "Connect to server" path still works.
    console.warn('[steam] init failed:', error?.message ?? error);
    steam = null;
  }
  createWindow();
});

app.on('window-all-closed', async () => {
  await endSession();
  stopPump?.();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (event) => {
  if (teardownStack.length) {
    event.preventDefault();
    await endSession();
    stopPump?.();
    app.exit(0);
  }
});
