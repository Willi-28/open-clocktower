/**
 * Shared UI text helpers.
 *
 * Centralizing labels keeps game terms consistent across panels and makes it
 * easier to adjust copy without touching component logic.
 */

import type { Character, GamePhase, PlayerStatus } from '../api/client';

export const phaseLabels: Record<GamePhase, string> = {
  lobby: 'Lobby',
  day: 'Day',
  night: 'Night',
};

export const statusLabels: Record<PlayerStatus, string> = {
  alive: 'Alive',
  dead: 'Dead',
  absent: 'Absent',
};

/** Format a character's visible role name for selection lists. */
export function characterRole(character: Character) {
  return `${character.name} - ${character.category}`;
}
