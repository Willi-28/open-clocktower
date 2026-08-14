/**
 * Local gateway for the desktop client.
 *
 * The Electron window always loads the bundled frontend from this local origin:
 *
 *   - `/?shell=1` shows the desktop-only server address bar.
 *   - `/` shows the normal Open Clocktower setup/game UI from the bundled build.
 *   - `/api` and `/ws` are proxied to the selected self-hosted server.
 *
 * This keeps Steam/Desktop UI changes inside the desktop bundle instead of
 * depending on the remote Docker server already serving the newest frontend.
 * Legacy loopback upstreams are still supported for the existing gateway tests.
 */

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json',
};

/**
 * @param {object}   opts
 * @param {string}   opts.staticDir           bundled frontend dist
 * @param {Function} [opts.onCreateRoom]      legacy async () => ({ port })
 * @param {Function} [opts.onRoomCreated]     legacy (roomId) => void
 * @param {number}   [opts.port]              preferred loopback port
 * @returns {Promise<{port,setUpstream,getUpstream,close}>}
 */
export function startGateway({ staticDir, onCreateRoom, onRoomCreated, port = 0 }) {
  let upstream = null; // { baseUrl } for self-hosted servers, or legacy { port }
  let starting = null; // in-flight legacy lazy host start

  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';
    const pathname = url.split('?')[0];
    if (pathname.startsWith('/api') || pathname.startsWith('/ws')) {
      if (!upstream && req.method === 'POST' && pathname === '/api/rooms' && onCreateRoom) {
        try {
          starting = starting || onCreateRoom();
          upstream = await starting;
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ detail: `Could not connect to server: ${error?.message ?? error}` }));
          return;
        }
      }
      if (!upstream) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Not connected to a server yet.' }));
        return;
      }
      const tapRoomId = req.method === 'POST' && pathname === '/api/rooms';
      proxyHttp(req, res, upstream, tapRoomId ? onRoomCreated : null);
      return;
    }
    serveStatic(url, res, staticDir);
  });

  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url || '/').split('?')[0];
    if (!pathname.startsWith('/ws') || !upstream) {
      socket.destroy();
      return;
    }
    proxyWebSocket(req, socket, head, upstream);
  });

  const gatewayApi = () => ({
    port: server.address().port,
    setUpstream: (next) => { upstream = next; },
    getUpstream: () => upstream,
    close: () => server.close(),
  });

  function listenOn(requestedPort) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        server.off('error', onError);
        server.off('listening', onListening);
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const onListening = () => {
        cleanup();
        resolve(gatewayApi());
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(requestedPort, '127.0.0.1');
    });
  }

  return listenOn(port).catch((error) => {
    if (port && error?.code === 'EADDRINUSE') {
      console.warn(`[desktop] gateway port ${port} is busy; falling back to a random local port.`);
      return listenOn(0);
    }
    throw error;
  });
}

function targetFor(upstream, requestUrl, websocket = false) {
  if (upstream?.baseUrl) {
    const baseUrl = `${String(upstream.baseUrl).replace(/\/+$/, '')}/`;
    const target = new URL(requestUrl, baseUrl);
    if (websocket) {
      target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    }
    return target;
  }
  if (typeof upstream?.port !== 'number') {
    throw new Error('Invalid gateway upstream.');
  }
  return new URL(`${websocket ? 'ws' : 'http'}://127.0.0.1:${upstream.port}${requestUrl}`);
}

function headersForTarget(req, target) {
  return {
    ...req.headers,
    host: target.host,
  };
}

/** Forward an HTTP request to the upstream server; optionally sniff room.id. */
function proxyHttp(req, res, upstream, onRoomCreated) {
  const target = targetFor(upstream, req.url || '/');
  const transport = target.protocol === 'https:' ? https : http;
  const outbound = transport.request(
    {
      hostname: target.hostname,
      port: target.port || undefined,
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers: headersForTarget(req, target),
    },
    (upRes) => {
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      if (!onRoomCreated) {
        upRes.pipe(res);
        return;
      }
      const chunks = [];
      upRes.on('data', (chunk) => {
        chunks.push(chunk);
        res.write(chunk);
      });
      upRes.on('end', () => {
        res.end();
        try {
          const roomId = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.room?.id;
          if (roomId) {
            onRoomCreated(String(roomId));
          }
        } catch {
          // Non-JSON or error responses do not carry a room id.
        }
      });
    },
  );
  outbound.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502);
    }
    res.end();
  });
  req.pipe(outbound);
}

/** Pipe a WebSocket upgrade to the upstream server. */
function proxyWebSocket(req, socket, head, upstream) {
  const target = targetFor(upstream, req.url || '/', true);
  const port = Number(target.port || (target.protocol === 'wss:' ? 443 : 80));
  const upstreamSocket = target.protocol === 'wss:'
    ? tls.connect({ host: target.hostname, port, servername: target.hostname }, writeUpgrade)
    : net.connect(port, target.hostname, writeUpgrade);

  function writeUpgrade() {
    upstreamSocket.write(`${req.method} ${target.pathname}${target.search} HTTP/1.1\r\n`);
    let sentHost = false;
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      if (name.toLowerCase() === 'host') {
        upstreamSocket.write(`Host: ${target.host}\r\n`);
        sentHost = true;
        continue;
      }
      upstreamSocket.write(`${name}: ${req.rawHeaders[i + 1]}\r\n`);
    }
    if (!sentHost) {
      upstreamSocket.write(`Host: ${target.host}\r\n`);
    }
    upstreamSocket.write('\r\n');
    if (head && head.length) {
      upstreamSocket.write(head);
    }
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  }

  upstreamSocket.on('error', () => socket.destroy());
  socket.on('error', () => upstreamSocket.destroy());
}

/** Serve a static file from the frontend dist, falling back to index.html (SPA). */
function serveStatic(url, res, staticDir) {
  const clean = decodeURIComponent(url.split('?')[0]);
  let filePath = path.join(staticDir, clean === '/' ? 'index.html' : clean);
  // Prevent path traversal outside the static root.
  if (!filePath.startsWith(staticDir)) {
    filePath = path.join(staticDir, 'index.html');
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      // SPA fallback: unknown non-file route -> index.html
      fs.readFile(path.join(staticDir, 'index.html'), (fallbackError, html) => {
        if (fallbackError) {
          res.writeHead(404);
          res.end('Not found');
        } else {
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(html);
        }
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  });
}
