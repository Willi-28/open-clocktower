/**
 * Player lookup helpers.
 *
 * Components use these small helpers to avoid repeating room null checks and
 * seat-index map construction in render code.
 */

import type { Player, RoomState } from '../../api/client';

/**
 * Resolves a display name from the current room while keeping missing players readable.
 */
export function playerNameInRoom(room: RoomState | null, playerId: string | undefined) {
  return room?.players.find((player) => player.id === playerId)?.display_name ?? 'Unknown';
}

/**
 * Indexes seated players by seat for table hit testing and rendering.
 */
export function seatedPlayersBySeat(room: RoomState | null) {
  const bySeat = new Map<number, Player>();
  room?.players.forEach((player) => {
    if (player.seat_index !== null) {
      bySeat.set(player.seat_index, player);
    }
  });
  return bySeat;
}
