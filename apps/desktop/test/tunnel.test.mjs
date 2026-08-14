/**
 * Proves the transport tunnel end to end WITHOUT Steam or Electron:
 * browser TCP -> tunnel client -> in-memory channel -> tunnel host -> "backend".
 *
 * The stand-in backend is an upper-casing echo server. If bytes survive the
 * round trip (including a payload larger than one Steam message, to exercise
 * chunking + ordering), the multiplexing is correct and the Steam adapter only
 * has to satisfy the same TransportChannel contract.
 *
 * Run: node apps/desktop/test/tunnel.test.mjs
 */

import net from 'node:net';
import assert from 'node:assert/strict';

import { createLoopbackPair } from '../src/transport/channel.mjs';
import { startTunnelHost } from '../src/transport/tunnelHost.mjs';
import { startTunnelClient } from '../src/transport/tunnelClient.mjs';

function startEchoBackend() {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on('data', (chunk) => socket.write(chunk.toString('latin1').toUpperCase()));
    });
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => server.close() }));
  });
}

function roundTrip(port, text) {
  return new Promise((resolve, reject) => {
    const client = net.connect(port, '127.0.0.1', () => client.write(text));
    let received = '';
    client.on('data', (chunk) => {
      received += chunk.toString('latin1');
      if (received.length >= text.length) {
        client.end();
        resolve(received);
      }
    });
    client.on('error', reject);
  });
}

const backend = await startEchoBackend();
const { clientChannel, hostChannel } = createLoopbackPair('client', 'host');
const host = startTunnelHost({ channel: hostChannel, backendPort: backend.port });
const tunnel = await startTunnelClient({ channel: clientChannel, hostPeerId: 'host', localPort: 0 });

// 1) small message through the whole tunnel
assert.equal(await roundTrip(tunnel.port, 'hello over steam'), 'HELLO OVER STEAM');

// 2) 1 MiB payload: bigger than MAX_PAYLOAD, so it must be split into ordered
//    DATA frames and reassembled in order.
const big = 'ab'.repeat(512 * 1024); // 1 MiB
const bigResult = await roundTrip(tunnel.port, big);
assert.equal(bigResult.length, big.length);
assert.equal(bigResult, big.toUpperCase());

// 3) two independent connections stay isolated (per-conn namespacing)
const [a, b] = await Promise.all([roundTrip(tunnel.port, 'alpha'), roundTrip(tunnel.port, 'bravo')]);
assert.equal(a, 'ALPHA');
assert.equal(b, 'BRAVO');

console.log('tunnel.test: OK — small, 1 MiB chunked, and concurrent connections all round-tripped');
tunnel.close();
host.close();
backend.close();
process.exit(0);
