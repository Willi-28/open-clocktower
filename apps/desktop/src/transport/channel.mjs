/**
 * TransportChannel contract + an in-memory loopback implementation for tests.
 *
 * A TransportChannel is the ONLY thing the tunnel needs from the network:
 *
 *   channel.send(peerId, buffer)     // reliable, ordered, boundary-preserving
 *   channel.onMessage((peerId, buffer) => {})
 *   channel.onPeerLeft((peerId) => {})   // optional
 *
 * Steam's ISteamNetworkingSockets/Messages implements this for real (see
 * ../steam/steam.mjs); the loopback below implements it with zero dependencies
 * so the tunnel's multiplexing/ordering logic can be tested without Steam.
 */

class InMemoryChannel {
  constructor(selfName) {
    this._self = selfName;
    this._peer = null;
    this._onMessage = () => {};
    this._onPeerLeft = () => {};
  }

  onMessage(callback) {
    this._onMessage = callback;
  }

  onPeerLeft(callback) {
    this._onPeerLeft = callback;
  }

  send(_peerId, buffer) {
    // Copy + deliver on the next tick to mimic a real async network while
    // preserving FIFO ordering (which Steam reliable messaging also guarantees).
    const peer = this._peer;
    const from = this._self;
    const copy = Buffer.from(buffer);
    setImmediate(() => peer._onMessage(from, copy));
  }

  close() {
    const peer = this._peer;
    const from = this._self;
    setImmediate(() => peer._onPeerLeft(from));
  }
}

/**
 * Create two linked channels. `send` on one delivers to `onMessage` on the other
 * with the sender's name as the peerId (the tunnel client only ever has the host
 * as its single peer, so it ignores that argument on its side).
 */
export function createLoopbackPair(clientName = 'client', hostName = 'host') {
  const clientChannel = new InMemoryChannel(clientName);
  const hostChannel = new InMemoryChannel(hostName);
  clientChannel._peer = hostChannel;
  hostChannel._peer = clientChannel;
  return { clientChannel, hostChannel };
}
