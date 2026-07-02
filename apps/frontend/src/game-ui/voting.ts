/**
 * Voting order and count helpers.
 *
 * The voting UI needs deterministic seated player ordering, vote totals, and
 * execution thresholds without duplicating that logic across components.
 */

import type { Player, RoomState } from '../api/client';

/** Return seated non-storyteller players in clockwise table order. */
export function seatedClockwisePlayers(room: RoomState | null): Player[] {
  return (
    room?.players
      .filter((player) => !player.is_storyteller && player.seat_index !== null)
      .sort((left, right) => Number(left.seat_index) - Number(right.seat_index)) ?? []
  );
}

/** Rotate seated players so the nominee is first in vote order. */
export function orderedVotePlayers(activeNomination: RoomState['active_nomination'] | undefined, players: Player[]) {
  if (!activeNomination) {
    return [];
  }
  const nomineeIndex = players.findIndex((player) => player.id === activeNomination.nominee_id);
  if (nomineeIndex === -1) {
    return players;
  }
  return [...players.slice(nomineeIndex), ...players.slice(0, nomineeIndex)];
}

/** Return the current yes/no value for a player. */
export function voteForPlayer(room: RoomState | null, playerId: string) {
  return room?.votes.find((vote) => vote.player_id === playerId)?.value ?? false;
}

/** Count yes votes through a specific clock-hand index. */
export function countedYesVotesThrough(room: RoomState | null, voteOrder: Player[], index: number) {
  if (index < 0) {
    return 0;
  }
  return voteOrder
    .slice(0, index + 1)
    .filter((player) => voteForPlayer(room, player.id))
    .length;
}

/** Calculate the number of yes votes required for execution. */
export function requiredExecutionVotes(room: RoomState | null) {
  const livingPlayerCount = room?.players.filter((player) => !player.is_storyteller && player.status === 'alive').length ?? 0;
  return Math.max(1, Math.ceil(livingPlayerCount / 2));
}

/** Count all current yes votes in the room snapshot. */
export function yesVoteCount(room: RoomState | null) {
  return room?.votes.filter((vote) => vote.value).length ?? 0;
}

/** Count seated non-storyteller players. */
export function seatedPlayerCount(room: RoomState | null) {
  return room?.players.filter((player) => !player.is_storyteller && player.seat_index !== null).length ?? 0;
}
