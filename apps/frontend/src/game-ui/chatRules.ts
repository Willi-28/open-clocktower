/**
 * Text chat permission rules.
 *
 * This module keeps private chat range logic outside the UI so the chat panel
 * can simply render the targets that the current player may message.
 */

import type { Player, RoomState } from '../api/client';

/** Return players that the current viewer may open a private chat with. */
export function privateChatTargets(room: RoomState | null, currentPlayer: Player | undefined, storyteller: Player | undefined) {
  if (!room || !currentPlayer) {
    return [];
  }
  if (currentPlayer.is_storyteller) {
    return room.players.filter((player) => !player.is_storyteller);
  }

  const targets = storyteller && storyteller.id !== currentPlayer.id ? [storyteller] : [];
  if (currentPlayer.seat_index === null) {
    return targets;
  }

  // Private player chat is intentionally seat-adjacent. Empty seats do not count
  // as pass-through neighbors, so table movement immediately changes range.
  const leftSeatIndex = (currentPlayer.seat_index - 1 + room.seat_count) % room.seat_count;
  const rightSeatIndex = (currentPlayer.seat_index + 1) % room.seat_count;
  const directNeighbors = room.players.filter(
    (player) =>
      !player.is_storyteller &&
      player.id !== currentPlayer.id &&
      (player.seat_index === leftSeatIndex || player.seat_index === rightSeatIndex),
  );

  return [...targets, ...directNeighbors];
}
