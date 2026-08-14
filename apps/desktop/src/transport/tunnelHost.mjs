/**
 * Tunnel host (room owner side).
 *
 * Receives tunneled connections from remote peers over the channel and replays
 * each one against the local backend (127.0.0.1:<backendPort>). The backend sees
 * ordinary localhost HTTP/WS clients and is completely unaware of Steam.
 *
 * Every peer's connIds live in their own namespace, so two joining players never
 * collide even though each numbers its connections from 1.
 */

import net from 'node:net';

import { OP_OPEN, OP_DATA, OP_CLOSE, encodeFrame, decodeFrame, sendData } from './framing.mjs';

/**
 * @param {object} opts
 * @param {{send:Function,onMessage:Function,onPeerLeft?:Function}} opts.channel
 * @param {number} opts.backendPort
 * @param {string} [opts.backendHost]  default 127.0.0.1
 * @returns {{close:Function}}
 */
export function startTunnelHost({ channel, backendPort, backendHost = '127.0.0.1' }) {
  const peers = new Map(); // peerId -> Map(connId -> net.Socket)

  function connsFor(peerId) {
    let conns = peers.get(peerId);
    if (!conns) {
      conns = new Map();
      peers.set(peerId, conns);
    }
    return conns;
  }

  channel.onMessage((peerId, buffer) => {
    const { op, connId, payload } = decodeFrame(buffer);
    const conns = connsFor(peerId);

    if (op === OP_OPEN) {
      // Node buffers writes issued before 'connect' completes, and the channel is
      // ordered, so DATA that follows this OPEN is written in the right order.
      const socket = net.connect(backendPort, backendHost);
      conns.set(connId, socket);
      socket.on('data', (chunk) => sendData(channel.send.bind(channel), peerId, connId, chunk));
      socket.on('close', () => {
        if (conns.delete(connId)) {
          channel.send(peerId, encodeFrame(OP_CLOSE, connId));
        }
      });
      socket.on('error', () => {});
    } else if (op === OP_DATA) {
      const socket = conns.get(connId);
      if (socket) {
        socket.write(payload);
      }
    } else if (op === OP_CLOSE) {
      const socket = conns.get(connId);
      if (socket) {
        conns.delete(connId);
        socket.end();
      }
    }
  });

  channel.onPeerLeft?.((peerId) => {
    const conns = peers.get(peerId);
    if (conns) {
      for (const socket of conns.values()) {
        socket.destroy();
      }
      peers.delete(peerId);
    }
  });

  return {
    close: () => {
      for (const conns of peers.values()) {
        for (const socket of conns.values()) {
          socket.destroy();
        }
      }
      peers.clear();
    },
  };
}
