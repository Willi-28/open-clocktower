/**
 * Proves the gateway serves the real frontend before any server exists, and only
 * starts the host on the frontend's Create Room POST — no Steam/Electron needed.
 *
 * Run: node apps/desktop/test/gateway.test.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

import { startGateway } from '../src/gateway.mjs';

const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'octgw-'));
fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><div id="root">landing</div>');
fs.writeFileSync(path.join(staticDir, 'app.js'), 'console.log(1)');

// Stand-in backend: answers create-room and health like the real one.
const backend = await new Promise((resolve) => {
  const s = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/rooms') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ room: { id: 'ROOM1' }, player_id: 'p1', player_secret: 'sekret' }));
    } else if (req.url === '/api/health') {
      res.writeHead(200);
      res.end('{"status":"ok"}');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  s.listen(0, '127.0.0.1', () => resolve({ port: s.address().port, close: () => s.close() }));
});

let created = 0;
let roomIdSeen = null;
const gw = await startGateway({
  staticDir,
  onCreateRoom: async () => { created += 1; return { port: backend.port }; },
  onRoomCreated: (id) => { roomIdSeen = id; },
});

function req(method, p, body, port = gw.port) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ status: res.statusCode, body: b, ct: res.headers['content-type'] }));
    });
    r.on('error', reject);
    r.end(body);
  });
}

// 1) real landing page served before any server exists
const idx = await req('GET', '/');
assert.equal(idx.status, 200);
assert.match(idx.body, /landing/);
assert.match(idx.ct, /html/);
assert.match((await req('GET', '/app.js')).ct, /javascript/);

// 2) /api before hosting/joining -> 503 (no upstream yet, no server started)
assert.equal((await req('GET', '/api/health')).status, 503);
assert.equal(created, 0);

// 3) Create Room POST lazily starts the host, proxies, and taps the room id
const create = await req('POST', '/api/rooms', JSON.stringify({ name: 'x' }));
assert.equal(create.status, 200);
assert.match(create.body, /ROOM1/);
assert.equal(created, 1);
assert.equal(roomIdSeen, 'ROOM1');

// 4) now proxied through to the backend
assert.equal((await req('GET', '/api/health')).status, 200);

// 5) SPA fallback for unknown routes
const spa = await req('GET', '/deep/route');
assert.equal(spa.status, 200);
assert.match(spa.body, /landing/);

// 6) Desktop URL-first mode: keep the local UI, proxy API to a selected server
const remoteGw = await startGateway({ staticDir });
remoteGw.setUpstream({ baseUrl: `http://127.0.0.1:${backend.port}` });
const remoteIdx = await req('GET', '/', undefined, remoteGw.port);
assert.equal(remoteIdx.status, 200);
assert.match(remoteIdx.body, /landing/);
assert.equal((await req('GET', '/api/health', undefined, remoteGw.port)).status, 200);
remoteGw.setUpstream(null);
assert.equal((await req('GET', '/api/health', undefined, remoteGw.port)).status, 503);

// 7) Desktop persistence mode: a preferred gateway port is honored so the
// browser origin, and therefore localStorage, stays stable across app restarts.
const preferredPort = await new Promise((resolve) => {
  const s = http.createServer();
  s.listen(0, '127.0.0.1', () => {
    const port = s.address().port;
    s.close(() => resolve(port));
  });
});
const fixedGw = await startGateway({ staticDir, port: preferredPort });
assert.equal(fixedGw.port, preferredPort);

console.log('gateway.test: OK - local UI, 503 pre-connect, legacy create-room proxy, remote server proxy, SPA fallback');
fixedGw.close();
remoteGw.close();
gw.close();
backend.close();
fs.rmSync(staticDir, { recursive: true, force: true });
process.exit(0);
