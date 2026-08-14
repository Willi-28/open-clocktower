/**
 * Proves the local gateway serves the bundled frontend, refuses API traffic
 * until a server is selected, proxies to the selected server afterwards, and
 * does not hand its origin to non-loopback hosts or to path traversal.
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
// A file next to (but outside) the static root: traversal must never reach it.
const secretPath = path.join(staticDir, '..', `octgw-secret-${process.pid}.txt`);
fs.writeFileSync(secretPath, 'TOP-SECRET');

// Stand-in for a self-hosted Open Clocktower server.
const backend = await new Promise((resolve) => {
  const s = http.createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"ok"}');
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  s.listen(0, '127.0.0.1', () => resolve({ port: s.address().port, close: () => s.close() }));
});

const gw = await startGateway({ staticDir });

function req(method, p, { port = gw.port, host } = {}) {
  return new Promise((resolve, reject) => {
    const headers = host ? { Host: host } : undefined;
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => resolve({ status: res.statusCode, body: b, ct: res.headers['content-type'] }));
    });
    r.on('error', reject);
    r.end();
  });
}

// 1) the bundled landing page is served before any server is selected
const idx = await req('GET', '/');
assert.equal(idx.status, 200);
assert.match(idx.body, /landing/);
assert.match(idx.ct, /html/);
assert.match((await req('GET', '/app.js')).ct, /javascript/);

// 2) /api before connecting -> 503, never a silent failure
assert.equal((await req('GET', '/api/health')).status, 503);

// 3) after selecting a server, API traffic is proxied there
gw.setUpstream({ baseUrl: `http://127.0.0.1:${backend.port}` });
assert.equal((await req('GET', '/api/health')).status, 200);
gw.setUpstream(null);
assert.equal((await req('GET', '/api/health')).status, 503);
gw.setUpstream({ baseUrl: `http://127.0.0.1:${backend.port}` });

// 4) SPA fallback for unknown routes
const spa = await req('GET', '/deep/route');
assert.equal(spa.status, 200);
assert.match(spa.body, /landing/);

// 5) path traversal cannot escape the static root (encoded or not)
for (const attack of [
  `/../${path.basename(secretPath)}`,
  `/..%2f${path.basename(secretPath)}`,
  `/%2e%2e/${path.basename(secretPath)}`,
  '/../../../../../../etc/passwd',
]) {
  const escaped = await req('GET', attack);
  assert.doesNotMatch(escaped.body, /TOP-SECRET/, `traversal leaked via ${attack}`);
}

// 6) DNS rebinding: only loopback host names may use this origin
assert.equal((await req('GET', '/', { host: 'attacker.example' })).status, 403);
assert.equal((await req('GET', '/api/health', { host: 'attacker.example' })).status, 403);
assert.equal((await req('GET', '/', { host: 'localhost' })).status, 200);

// 7) a preferred gateway port is honored so the browser origin - and therefore
// localStorage - stays stable across app restarts
const preferredPort = await new Promise((resolve) => {
  const s = http.createServer();
  s.listen(0, '127.0.0.1', () => {
    const port = s.address().port;
    s.close(() => resolve(port));
  });
});
const fixedGw = await startGateway({ staticDir, port: preferredPort });
assert.equal(fixedGw.port, preferredPort);

console.log('gateway.test: OK - bundled UI, 503 pre-connect, server proxy, SPA fallback, traversal blocked, host pinned, fixed port');
fixedGw.close();
gw.close();
backend.close();
fs.rmSync(staticDir, { recursive: true, force: true });
fs.rmSync(secretPath, { force: true });
process.exit(0);
