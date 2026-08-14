/**
 * Steam integration: lobby management + a TransportChannel over Steam networking.
 *
 * Bound to steamworks.js (ceifa) 0.4.0 — pinned exactly in package.json. This is
 * the ONLY Steam-aware code in the app; the tunnel and everything else are
 * transport-generic and covered by test/tunnel.test.mjs.
 *
 * NETWORKING: uses Steam's legacy P2P messaging (ISteamNetworking), which routes
 * through the Steam Datagram Relay when a direct path is unavailable — so NO PORT
 * FORWARDING is ever required. Legacy P2P requires the RECEIVER to accept a
 * session before packets are delivered, so we register a P2PSessionRequest
 * callback and accept immediately (createSteamChannel). Reliable, in-order
 * delivery satisfies the tunnel's TransportChannel contract.
 *
 * Status: written against the 0.4.0 declarations (client.d.ts / callbacks.d.ts),
 * but MUST still be validated with two Steam accounts on two PCs (see README) —
 * no Steam client is available in the build environment.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// SendType.Reliable / LobbyType are `const enum`s in the .d.ts, so they are not
// guaranteed to exist as runtime objects in plain JS — use the ordinals, which
// are stable Steamworks values.
const SEND_RELIABLE = 2; // networking.SendType.Reliable
const LOBBY_PUBLIC = 2; // matchmaking.LobbyType.Public
const LOBBY_FRIENDS_ONLY = 1; // matchmaking.LobbyType.FriendsOnly

/** Load and initialise the Steam SDK. Throws if Steam is not running. */
export function initSteam(appId = 480) {
  const steamworks = require('steamworks.js');
  const client = steamworks.init(appId);
  return { steamworks, client, steamId: String(client.localplayer.getSteamId().steamId64) };
}

/** Host: create a joinable lobby; the creator is the Steam lobby owner. */
export async function createRoomLobby(client, { maxMembers = 16, friendsOnly = false } = {}) {
  const lobby = await client.matchmaking.createLobby(friendsOnly ? LOBBY_FRIENDS_ONLY : LOBBY_PUBLIC, maxMembers);
  lobby.setJoinable(true);
  // Tag so a lobby list can recognise Open Clocktower rooms.
  lobby.setData('game', 'open-clocktower');
  return lobby;
}

/** Joiner: join a lobby by id (from an invite or manual entry). */
export function joinLobby(client, lobbyId) {
  return client.matchmaking.joinLobby(BigInt(lobbyId));
}

/** Owner steamId64 (as string) of a joined lobby — i.e. the host to tunnel to. */
export function lobbyOwnerId(lobby) {
  return String(lobby.getOwner().steamId64);
}

/** Steam must pump its callbacks regularly; call this on an interval. */
export function startCallbackPump(client, intervalMs = 16) {
  const timer = setInterval(() => {
    try {
      client.runCallbacks();
    } catch {
      // never let a callback error kill the pump
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

/**
 * When a friend accepts a Steam invite, Steam fires GameLobbyJoinRequested with
 * the lobby id. Returns the registration handle (call .disconnect() to remove).
 */
export function onLobbyInvite(steam, handler) {
  const SteamCallback = resolveSteamCallback(steam);
  return steam.client.callback.register(SteamCallback.GameLobbyJoinRequested, (value) => {
    handler(String(value.lobby_steam_id));
  });
}

/**
 * Build a TransportChannel (send / onMessage / onPeerLeft) over Steam P2P. Peers
 * are addressed by steamId64 string. Incoming packets are polled and dispatched;
 * incoming session requests are accepted so packets actually flow.
 *
 * @param {{client:object, steamworks:object}} steam
 */
export function createSteamChannel(steam) {
  const { client } = steam;
  const SteamCallback = resolveSteamCallback(steam);
  let onMessage = () => {};
  let onPeerLeft = () => {};

  // Accept incoming sessions (required before readP2PPacket returns their data).
  const sessionHandle = client.callback.register(SteamCallback.P2PSessionRequest, (value) => {
    client.networking.acceptP2PSession(value.remote);
  });
  const failHandle = client.callback.register(SteamCallback.P2PSessionConnectFail, (value) => {
    onPeerLeft(String(value.remote));
  });

  const poll = setInterval(() => {
    let size = client.networking.isP2PPacketAvailable();
    while (size) {
      const packet = client.networking.readP2PPacket(size);
      onMessage(String(packet.steamId.steamId64), packet.data);
      size = client.networking.isP2PPacketAvailable();
    }
  }, 4);

  return {
    send: (peerId, buffer) => client.networking.sendP2PPacket(BigInt(peerId), SEND_RELIABLE, Buffer.from(buffer)),
    onMessage: (callback) => {
      onMessage = callback;
    },
    onPeerLeft: (callback) => {
      onPeerLeft = callback;
    },
    // Called by main.mjs when a lobby member-left callback fires.
    notifyPeerLeft: (peerId) => onPeerLeft(String(peerId)),
    close: () => {
      clearInterval(poll);
      sessionHandle?.disconnect?.();
      failHandle?.disconnect?.();
    },
  };
}

/**
 * The SteamCallback enum is a napi runtime object, but its location moved between
 * releases (module-level vs under client.callback). Resolve defensively and fail
 * loudly rather than silently registering nothing.
 */
function resolveSteamCallback(steam) {
  const enumObject = steam.steamworks?.SteamCallback ?? steam.client?.callback?.SteamCallback;
  if (!enumObject || enumObject.P2PSessionRequest === undefined) {
    throw new Error('steamworks.js SteamCallback enum not found — check the installed version (expected 0.4.0).');
  }
  return enumObject;
}
