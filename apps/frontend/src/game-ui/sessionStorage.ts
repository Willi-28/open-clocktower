export function sessionKey(roomId: string) {
  return `open-clocktower:${roomId}:player`;
}

export function lastSessionKey() {
  return 'open-clocktower:last-session';
}

export function guessKey(roomId: string, playerId: string) {
  return `open-clocktower:${roomId}:${playerId}:guesses`;
}

export function reminderKey(roomId: string, playerId: string) {
  return `open-clocktower:${roomId}:${playerId}:reminders`;
}
