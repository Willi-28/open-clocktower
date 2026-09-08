/**
 * Active vote controls for players.
 *
 * This component renders the compact nomination bar shown near the table when
 * a normal player can raise or lower their hand for the active vote.
 */

import type { Nomination } from '../../api/client';
import { useUiText } from '../../i18n';

type ActiveVoteBarProps = {
  activeNomination: Nomination;
  isVoteRaised: boolean;
  onToggleVote: () => void;
  playerName: (playerId: string | undefined) => string;
};

/**
 * Shows the active nomination vote controls for non-storyteller players.
 */
export function ActiveVoteBar({
  activeNomination,
  isVoteRaised,
  onToggleVote,
  playerName,
}: ActiveVoteBarProps) {
  const t = useUiText();
  return (
    <div className="table-vote-bar">
      <strong>{t('{nominator} versus {nominee}', {
        nominator: playerName(activeNomination.nominator_id),
        nominee: playerName(activeNomination.nominee_id),
      })}</strong>
      {activeNomination.is_open ? (
        <button
          className={isVoteRaised ? 'hand-button raised' : 'hand-button'}
          onClick={onToggleVote}
          type="button"
        >
          {t(isVoteRaised ? 'Lower Hand' : 'Raise Hand')}
        </button>
      ) : (
        <span>{t('Vote closed')}</span>
      )}
    </div>
  );
}
