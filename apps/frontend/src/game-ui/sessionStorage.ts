/**
 * Browser storage key helpers.
 *
 * Session state, local guesses, and local reminders are keyed by room and
 * player id so one browser can safely join different rooms over time.
 */

/** Build the room-local key that stores the current player id. */
export function sessionKey(roomId: string) {
  return `open-clocktower:${roomId}:player`;
}

/** Build the room-local key that stores the current player's bearer secret. */
export function secretKey(roomId: string) {
  return `open-clocktower:${roomId}:secret`;
}

/** Build the key that stores the last room/player session pointer. */
export function lastSessionKey() {
  return 'open-clocktower:last-session';
}

/** Build the key for local character guesses. */
export function guessKey(roomId: string, playerId: string) {
  return `open-clocktower:${roomId}:${playerId}:guesses`;
}

/** Build the key for local reminder token placements. */
export function reminderKey(roomId: string, playerId: string) {
  return `open-clocktower:${roomId}:${playerId}:reminders`;
}
