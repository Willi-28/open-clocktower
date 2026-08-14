/**
 * Steam integration.
 *
 * The desktop client joins self-hosted servers over normal HTTPS, so Steam is
 * only initialised for presence: the app shows up as running and the Steam
 * overlay works. No lobbies, no matchmaking, no P2P networking.
 *
 * Bound to steamworks.js (ceifa) 0.4.0 - pinned exactly in package.json.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Load and initialise the Steam SDK. Throws if Steam is not running. */
export function initSteam(appId = 480) {
  const steamworks = require('steamworks.js');
  const client = steamworks.init(appId);
  return { steamworks, client, steamId: String(client.localplayer.getSteamId().steamId64) };
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
