/**
 * Role distribution chart (visual only).
 *
 * Shows the standard Blood on the Clocktower role counts for the current
 * number of seated players, split by pack category (Townsfolk, Outsider,
 * Minion, Demon). Purely informational - it does not influence the random
 * character assignment.
 */

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

const categoryLabels: Array<{ key: keyof RoleCounts; label: string }> = [
  { key: 'townsfolk', label: 'Townsfolk' },
  { key: 'outsider', label: 'Outsider' },
  { key: 'minion', label: 'Minion' },
  { key: 'demon', label: 'Demon' },
];

type RoleDistributionProps = {
  playerCount: number;
};

/** Render the category pills, or a subtle note when the count is off-chart. */
function RoleDistributionBody({ playerCount }: { playerCount: number }) {
  const distribution = distributionByPlayerCount[playerCount];
  if (!distribution) {
    return (
      <p className="helper-text">
        {playerCount} seated player{playerCount === 1 ? '' : 's'} - the chart covers 5 to 15.
      </p>
    );
  }
  return (
    <div className="role-distribution-grid">
      {categoryLabels.map(({ key, label }) => (
        <span className="role-pill" key={key}>
          <small>{label}</small>
          <strong>{distribution[key]}</strong>
        </span>
      ))}
    </div>
  );
}

/** Show the role counts for the currently seated players. */
export function RoleDistribution({ playerCount }: RoleDistributionProps) {
  return (
    <div className="role-distribution">
      <span className="role-distribution-caption">
        Role Distribution
        <small>{playerCount} players</small>
      </span>
      <RoleDistributionBody playerCount={playerCount} />
    </div>
  );
}
