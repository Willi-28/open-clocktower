/**
 * Role distribution widget (visual only).
 *
 * Shows the standard Blood on the Clocktower role counts for a given number of
 * players, split into themed category cards (Townsfolk, Outsiders, Minions,
 * Demon). When a seat control is supplied (storyteller setup) it also renders
 * the −/+ seat-count stepper above the cards. Purely informational: it does not
 * influence the random character assignment.
 */

import type { CSSProperties } from 'react';

type RoleCounts = {
  townsfolk: number;
  outsider: number;
  minion: number;
  demon: number;
};

// Official chart: seated player count (storyteller and spectators excluded)
// mapped to how many of each category should be in play.
const distributionByPlayerCount: Record<number, RoleCounts> = {
  5: { townsfolk: 3, outsider: 0, minion: 1, demon: 1 },
  6: { townsfolk: 3, outsider: 1, minion: 1, demon: 1 },
  7: { townsfolk: 5, outsider: 0, minion: 1, demon: 1 },
  8: { townsfolk: 5, outsider: 1, minion: 1, demon: 1 },
  9: { townsfolk: 5, outsider: 2, minion: 1, demon: 1 },
  10: { townsfolk: 7, outsider: 0, minion: 2, demon: 1 },
  11: { townsfolk: 7, outsider: 1, minion: 2, demon: 1 },
  12: { townsfolk: 7, outsider: 2, minion: 2, demon: 1 },
  13: { townsfolk: 9, outsider: 0, minion: 3, demon: 1 },
  14: { townsfolk: 9, outsider: 1, minion: 3, demon: 1 },
  15: { townsfolk: 9, outsider: 2, minion: 3, demon: 1 },
};

// Category cards keep the classic team hues; the CSS blends them with the
// active theme's surfaces so they stay readable on every theme.
const categoryCards: Array<{ key: keyof RoleCounts; label: string; accent: string }> = [
  { key: 'townsfolk', label: 'Townsfolk', accent: '#5b90db' },
  { key: 'outsider', label: 'Outsiders', accent: '#3fae8c' },
  { key: 'minion', label: 'Minions', accent: '#dd9042' },
  { key: 'demon', label: 'Demon', accent: '#cf4d45' },
];

type SeatControl = {
  min: number;
  max: number;
  locked: boolean;
  onChange: (nextCount: number) => void;
};

type RoleDistributionProps = {
  /** Player/seat count the distribution is computed for. */
  count: number;
  /** When present, renders the interactive seat-count stepper in the header. */
  seatControl?: SeatControl;
};

/** Show the role counts (and optional seat stepper) for a player count. */
export function RoleDistribution({ count, seatControl }: RoleDistributionProps) {
  const distribution = distributionByPlayerCount[count];

  return (
    <div className="role-distribution">
      {seatControl ? (
        <div className="role-dist-stepper">
          {/* Steps fire on pointer-down for instant feedback; the click handler
            * only covers keyboard activation (event.detail === 0). */}
          <button
            aria-label="Remove one seat"
            className="secondary role-dist-step"
            disabled={seatControl.locked || count <= seatControl.min}
            onPointerDown={(event) => {
              if (event.button === 0) {
                seatControl.onChange(count - 1);
              }
            }}
            onClick={(event) => {
              if (event.detail === 0) {
                seatControl.onChange(count - 1);
              }
            }}
            type="button"
          >
            −
          </button>
          <strong className="role-dist-count">{count}</strong>
          <button
            aria-label="Add one seat"
            className="secondary role-dist-step"
            disabled={seatControl.locked || count >= seatControl.max}
            onPointerDown={(event) => {
              if (event.button === 0) {
                seatControl.onChange(count + 1);
              }
            }}
            onClick={(event) => {
              if (event.detail === 0) {
                seatControl.onChange(count + 1);
              }
            }}
            type="button"
          >
            +
          </button>
          <span className="role-dist-caption">
            players <small>({seatControl.min}–{seatControl.max})</small>
          </span>
        </div>
      ) : (
        <span className="role-distribution-caption">
          Role Distribution
          <small>{count} players</small>
        </span>
      )}

      {distribution ? (
        <div className="role-card-grid">
          {categoryCards.map((card) => (
            <span className="role-card" key={card.key} style={{ '--role-accent': card.accent } as CSSProperties}>
              <strong>{distribution[card.key]}</strong>
              <small>{card.label}</small>
            </span>
          ))}
        </div>
      ) : (
        <p className="helper-text">
          {count} seated player{count === 1 ? '' : 's'} — the chart covers 5 to 15.
        </p>
      )}
    </div>
  );
}
