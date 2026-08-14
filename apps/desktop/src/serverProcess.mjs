/**
 * Local Open Clocktower server lifecycle for the desktop host.
 *
 * "Create Room" spawns the SAME FastAPI backend used by Docker, bound to
 * 127.0.0.1 and backed by SQLite (temporary host), then waits for it to become
 * healthy. Closing the room terminates it cleanly. Nothing about the backend
 * changes — only how it is launched and configured (all via env vars).
 *
 *  - Packaged:  runs the bundled OpenClocktowerServer.exe (PyInstaller onefile).
 *  - Dev:       runs `py -m uvicorn app.main:app` from apps/backend.
 */

import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';

function waitForHealth(port, timeoutMs) {
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
      if (Date.now() > deadline) {
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
 * @param {number}  opts.port       loopback port for the server
 * @param {string}  opts.dataDir    per-user writable dir for SQLite + uploads
 * @param {string} [opts.exePath]   bundled server exe (packaged mode)
 * @param {string} [opts.devCwd]    apps/backend path (dev mode, uses `py`)
 * @param {number} [opts.timeoutMs] health wait budget (default 25s)
 * @returns {Promise<{stop:Function}>}
 */
export async function startServer({ port, dataDir, exePath, devCwd, timeoutMs = 25000 }) {
  const dbPath = path.join(dataDir, 'clocktower.db').replace(/\\/g, '/');
  const env = {
    ...process.env,
    APP_ENV: 'production',
    FORCE_HTTPS: 'false',
    DATABASE_URL: `sqlite:///${dbPath}`,
    DATA_DIR: dataDir,
    UPLOAD_DIR: path.join(dataDir, 'uploads'),
  };

  const args = ['--host', '127.0.0.1', '--port', String(port)];
  const child = exePath
    ? spawn(exePath, args, { env, stdio: 'inherit', windowsHide: true })
    : spawn('py', ['-m', 'uvicorn', 'app.main:app', ...args], { cwd: devCwd, env, stdio: 'inherit' });

  child.on('error', (error) => {
    // Surfaced by the health-wait rejection below; log for diagnostics.
    console.error('[server] failed to spawn:', error.message);
  });

  try {
    await waitForHealth(port, timeoutMs);
  } catch (error) {
    stopChild(child);
    throw error;
  }

  return { stop: () => stopChild(child) };
}
