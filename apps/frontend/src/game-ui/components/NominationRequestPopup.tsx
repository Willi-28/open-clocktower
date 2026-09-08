/**
 * Nomination request popup.
 *
 * Players can request nominations; this component lets the storyteller approve
 * or reject each pending request without opening a larger tools panel.
 */

import type { NominationRequestState } from '../../api/client';
import { useUiText } from '../../i18n';

type NominationRequestPopupProps = {
  nominationRequests: NominationRequestState[];
  onReject: (requestId: string) => void;
  onStartNomination: (nominatorId: string, nomineeId: string) => void;
  playerName: (playerId: string | undefined) => string;
};

/**
 * Presents pending player nomination requests for storyteller approval.
 */
export function NominationRequestPopup({
  nominationRequests,
  onReject,
  onStartNomination,
  playerName,
}: NominationRequestPopupProps) {
  const t = useUiText();
  if (nominationRequests.length === 0) {
    return null;
  }

  return (
    <div className="nomination-request-popup">
      <h2>{t('Nomination Request')}</h2>
      {nominationRequests.map((request) => (
        <div className="nomination-request-card" key={request.id}>
          <strong>
            {t('{nominator} nominates {nominee}', {
              nominator: playerName(request.nominator_id),
              nominee: playerName(request.nominee_id),
            })}
          </strong>
          <div className="button-row">
            <button onClick={() => onStartNomination(request.nominator_id, request.nominee_id)} type="button">{t('Start Nomination')}</button>
            <button className="secondary" onClick={() => onReject(request.id)} type="button">{t('Reject')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
