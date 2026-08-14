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
 */

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';

// The server only listens on loopback, but a browser can still be pointed at it
// by a hostname that resolves to 127.0.0.1 (DNS rebinding), which would put an
// attacker's page on this origin - and therefore on the localStorage holding the
// player session. Requests must address the gateway by its loopback name.
const ALLOWED_HOST_NAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Return whether a Host header addresses this gateway on loopback. */
function isLoopbackHost(hostHeader) {
  if (!hostHeader) {
    return false;
  }
  const hostName = String(hostHeader).replace(/:\d+$/, '');
  return ALLOWED_HOST_NAMES.has(hostName);
}

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
 * @param {number}   [opts.port]              preferred loopback port
 * @returns {Promise<{port,setUpstream,getUpstream,close}>}
 */
export function startGateway({ staticDir, port = 0 }) {
  let upstream = null; // { baseUrl } of the selected self-hosted server

  const server = http.createServer((req, res) => {
    if (!isLoopbackHost(req.headers.host)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    const url = req.url || '/';
    const pathname = url.split('?')[0];
    if (pathname.startsWith('/api') || pathname.startsWith('/ws')) {
      if (!upstream) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Not connected to a server yet.' }));
        return;
      }
      proxyHttp(req, res, upstream);
      return;
    }
    serveStatic(url, res, staticDir);
  });

  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url || '/').split('?')[0];
    if (!pathname.startsWith('/ws') || !upstream || !isLoopbackHost(req.headers.host)) {
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
  if (!upstream?.baseUrl) {
    throw new Error('Invalid gateway upstream.');
  }
  const baseUrl = `${String(upstream.baseUrl).replace(/\/+$/, '')}/`;
  const target = new URL(requestUrl, baseUrl);
  if (websocket) {
    target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
  }
  return target;
}

function headersForTarget(req, target) {
  return {
    ...req.headers,
    host: target.host,
  };
}

/** Forward an HTTP request to the upstream server. */
function proxyHttp(req, res, upstream) {
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
      upRes.pipe(res);
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
  const indexPath = path.join(staticDir, 'index.html');
  let clean = '/';
  try {
    clean = decodeURIComponent(url.split('?')[0]);
  } catch {
    // A malformed percent-escape is not a real asset request.
    clean = '/';
  }
  let filePath = path.resolve(staticDir, `.${path.posix.resolve('/', clean)}`);
  // Prevent path traversal outside the static root. A prefix check is not
  // enough on its own ("<root>-other" also starts with "<root>").
  const relative = path.relative(staticDir, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    filePath = indexPath;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      // SPA fallback: unknown non-file route -> index.html
      fs.readFile(indexPath, (fallbackError, html) => {
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
