/**
 * Local Open Clocktower server lifecycle for the desktop host.
 *
 * "Create Room" spawns the SAME FastAPI backend used by Docker, backed by
 * SQLite (temporary host), then waits for it to become healthy. Closing the room
 * terminates it cleanly. Nothing about the backend changes — only how it is
 * launched and configured (all via env vars).
 *
 *  - Packaged:  runs the bundled OpenClocktowerServer.exe (PyInstaller onefile).
 *  - Dev:       runs `py -m uvicorn app.main:app` from apps/backend.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';

function waitForHealth(port, timeoutMs, getExit) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 1000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
        } else {
          retry();
        }
      });
      req.on('error', retry);
      req.on('timeout', () => req.destroy());
    };
    const retry = () => {
      // Fail fast (with the real reason) if the server process already died.
      const exit = getExit?.();
      if (exit) {
        reject(new Error(`server process exited before becoming healthy (${JSON.stringify(exit)})`));
      } else if (Date.now() > deadline) {
        reject(new Error('Local server did not become healthy in time'));
      } else {
        setTimeout(attempt, 200);
      }
    };
    attempt();
  });
}

function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) {
    return;
  }
  if (process.platform === 'win32') {
    // A PyInstaller onefile spawns a child; kill the whole tree.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  } else {
    child.kill('SIGTERM');
  }
}

/**
 * @param {object}  opts
 * @param {number}  opts.port       port for the server
 * @param {string}  opts.dataDir    per-user writable dir for SQLite + uploads
 * @param {string} [opts.bindHost]  bind address (default 127.0.0.1; use 0.0.0.0
 *                                   to let LAN browsers join the host directly)
 * @param {string} [opts.exePath]   bundled server exe (packaged mode)
 * @param {string} [opts.devCwd]    apps/backend path (dev mode, uses `py`)
 * @param {number} [opts.timeoutMs] health wait budget (default 40s; a cold
 *                                   onefile exe extracts on first run)
 * @returns {Promise<{stop:Function}>}
 */
export async function startServer({ port, dataDir, bindHost = '127.0.0.1', exePath, devCwd, timeoutMs = 40000 }) {
  // SQLite cannot create its file in a missing directory, so ensure the data and
  // upload dirs exist before the server boots (this was the "did not become
  // healthy" cause on a fresh install).
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

  const dbPath = path.join(dataDir, 'clocktower.db').replace(/\\/g, '/');
  const env = {
    ...process.env,
    APP_ENV: 'production',
    FORCE_HTTPS: 'false',
    DATABASE_URL: `sqlite:///${dbPath}`,
    DATA_DIR: dataDir,
    UPLOAD_DIR: path.join(dataDir, 'uploads'),
  };

  // Capture server output to a log so failures on a user's machine are diagnosable.
  const logPath = path.join(dataDir, 'server.log');
  const logFd = fs.openSync(logPath, 'a');
  const stdio = ['ignore', logFd, logFd];

  const args = ['--host', bindHost, '--port', String(port)];
  const child = exePath
    ? spawn(exePath, args, { env, stdio, windowsHide: true })
    : spawn('py', ['-m', 'uvicorn', 'app.main:app', ...args], { cwd: devCwd, env, stdio });

  let exitInfo = null;
  child.on('exit', (code, signal) => { exitInfo = { code, signal }; });
  child.on('error', (error) => { exitInfo = { error: error.message }; });

  try {
    await waitForHealth(port, timeoutMs, () => exitInfo);
  } catch (error) {
    stopChild(child);
    throw new Error(`${error.message}. See ${logPath}`);
  }

  return {
    stop: () => {
      stopChild(child);
      try {
        fs.closeSync(logFd);
      } catch {
        // already closed
      }
    },
  };
}
