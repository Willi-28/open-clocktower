import type { Character, GamePhase, PlayerStatus } from '../api/client';

// Shared labels keep display text out of the main app flow.
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

export function characterRole(character: Character) {
  return `${character.name} - ${character.category}`;
}
