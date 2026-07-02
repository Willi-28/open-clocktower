import type { NominationRequestState } from '../../api/client';

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
  if (nominationRequests.length === 0) {
    return null;
  }

  return (
    <div className="nomination-request-popup">
      <h2>Nomination Request</h2>
      {nominationRequests.map((request) => (
        <div className="nomination-request-card" key={request.id}>
          <strong>
            {playerName(request.nominator_id)} nominates {playerName(request.nominee_id)}
          </strong>
          <div className="button-row">
            <button onClick={() => onStartNomination(request.nominator_id, request.nominee_id)} type="button">
              Start Nomination
            </button>
            <button className="secondary" onClick={() => onReject(request.id)} type="button">
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
