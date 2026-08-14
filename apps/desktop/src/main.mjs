/**
 * Electron main process — desktop server picker.
 *
 * Hosting is self-hosted only (Docker). This app is a fullscreen, frameless
 * client for using a self-hosted Open Clocktower server:
 *
 *   1. Opens on a local shell with only a server address bar.
 *   2. "Connect" validates the server (backend health check), keeps the bundled
 *      desktop UI loaded, and routes API/WebSocket traffic to that server.
 *   3. The normal setup screen handles creating or joining rooms on that server.
 *   4. A Leave Game button (frontend, bottom-right) quits the frameless window.
 *
 * Steam is initialised only so the app registers as running / shows the overlay;
 * no lobbies or networking are used (browser and desktop join servers the same
 * way, over normal HTTPS). The frontend is shared apart from small guarded
 * hooks that are inert when window.desktop is undefined.
 */

import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import electron from 'electron';

import { startGateway } from './gateway.mjs';
import { initSteam, startCallbackPump } from './steam/steam.mjs';

const { app, BrowserWindow, ipcMain, shell } = electron;
const dirname = path.dirname(fileURLToPath(import.meta.url));
const STEAM_APP_ID = Number(process.env.OCT_STEAM_APPID || 480);
const DEFAULT_GATEWAY_PORT = 28741;

let steam = null;
let stopPump = null;
let gateway = null;
let mainWindow = null;

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
}

if (hasInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });
}

function frontendStaticDir() {
  // Packaged: extraResources places the built UI under resources/frontend.
  return app.isPackaged ? path.join(process.resourcesPath, 'frontend') : path.resolve(dirname, '..', '..', 'frontend', 'dist');
}

/** Keep the desktop origin stable so localStorage survives app restarts. */
function configuredGatewayPort() {
  const raw = Number(process.env.OCT_DESKTOP_PORT ?? DEFAULT_GATEWAY_PORT);
  if (Number.isInteger(raw) && raw >= 0 && raw <= 65535) {
    return raw;
  }
  return DEFAULT_GATEWAY_PORT;
}

/** Normalise a typed server URL (default https, strip trailing slash). */
function normalizeUrl(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    throw new Error('Enter a server URL.');
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

/** Backend check: confirm the URL is a reachable Open Clocktower server. */
function checkServer(baseUrl) {
  return new Promise((resolve, reject) => {
    const lib = baseUrl.startsWith('https') ? https : http;
    const healthUrl = new URL('/api/health', `${baseUrl}/`);
    const req = lib.get(healthUrl, { timeout: 6000 }, (res) => {
      res.resume();
      if (res.statusCode === 200) {
        resolve();
      } else {
        reject(new Error(`Server responded ${res.statusCode}. Is this an Open Clocktower server?`));
      }
    });
    req.on('error', () => reject(new Error('Could not reach that server. Check the URL and that it is online.')));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Server did not respond in time.'));
    });
  });
}

ipcMain.handle('desktop:connect', async (_event, options = {}) => {
  const base = normalizeUrl(options.url);
  await checkServer(base);
  gateway.setUpstream({ baseUrl: base });
  await mainWindow.loadURL(`http://127.0.0.1:${gateway.port}/`);
  return { url: base };
});

ipcMain.handle('desktop:close', () => {
  app.quit();
});

ipcMain.handle('desktop:change-server', async () => {
  gateway.setUpstream(null);
  await mainWindow.loadURL(`http://127.0.0.1:${gateway.port}/?shell=1`);
  return {};
});

function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d13',
    webPreferences: {
      preload: path.join(dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Open external links (e.g. the docs link) in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  // ?shell marks the local server-address entry screen.
  return mainWindow.loadURL(`http://127.0.0.1:${gateway.port}/?shell=1`);
}

if (hasInstanceLock) {
  app.whenReady().then(async () => {
    try {
      steam = initSteam(STEAM_APP_ID);
      steam.steamworks.electronEnableSteamOverlay?.();
      stopPump = startCallbackPump(steam.client);
    } catch (error) {
      // Steam not running is fine: this client joins servers over plain HTTPS.
      console.warn('[steam] init skipped:', error?.message ?? error);
      steam = null;
    }

    gateway = await startGateway({
      staticDir: frontendStaticDir(),
      port: configuredGatewayPort(),
      onCreateRoom: async () => {
        throw new Error('Connect to a server before creating or joining rooms.');
      },
    });

    await createWindow();
  });
}

app.on('window-all-closed', () => {
  gateway?.close();
  stopPump?.();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
