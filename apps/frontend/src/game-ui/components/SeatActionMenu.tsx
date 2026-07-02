import type { Character, Nomination, Player, RoomState } from '../../api/client';
import { characterRole } from '../gameText';

type SeatActionMenuProps = {
  activeNomination: Nomination | null | undefined;
  characters: Character[];
  chatTargets: Player[];
  currentPlayer: Player;
  hasExecutionVotes: boolean;
  isStoryteller: boolean;
  player: Player;
  roomPhase: RoomState['phase'];
  suspectedCharacterId: string;
  onClose: () => void;
  onExecute: (playerId: string) => void;
  onRequestKick: (player: Player) => void;
  onMarkAlive: (playerId: string) => void;
  onMarkDead: (playerId: string) => void;
  onNominate: (playerId: string) => void;
  onOpenChat: (playerId: string) => void;
  onPlaceSuspicion: (playerId: string) => void;
  onStartPrivateCall: (playerId: string) => void;
  onSuspectedCharacterChange: (characterId: string) => void;
  onToggleDeadVote: (player: Player) => void;
};

export function SeatActionMenu({
  activeNomination,
  characters,
  chatTargets,
  currentPlayer,
  hasExecutionVotes,
  isStoryteller,
  player,
  roomPhase,
  suspectedCharacterId,
  onClose,
  onExecute,
  onRequestKick,
  onMarkAlive,
  onMarkDead,
  onNominate,
  onOpenChat,
  onPlaceSuspicion,
  onStartPrivateCall,
  onSuspectedCharacterChange,
  onToggleDeadVote,
}: SeatActionMenuProps) {
  const canChatWithPlayer = chatTargets.some((target) => target.id === player.id);
  const canNominatePlayer = roomPhase === 'day' && currentPlayer.status === 'alive' && player.status === 'alive';

  return (
    <div className="seat-action-menu">
      <div className="seat-action-header">
        <strong>{player.display_name}</strong>
        <button className="secondary" onClick={onClose} type="button">
          Close
        </button>
      </div>
      {isStoryteller ? (
        <>
          <button className="secondary" onClick={() => onOpenChat(player.id)} type="button">
            Chat
          </button>
          <button className="secondary" onClick={() => onStartPrivateCall(player.id)} type="button">
            Call
          </button>
          <div className="segmented-control seat-status-control">
            <button
              className={player.status === 'alive' ? 'active' : ''}
              onClick={() => onMarkAlive(player.id)}
              type="button"
            >
              Alive
            </button>
            <button
              className={player.status === 'dead' ? 'active' : ''}
              onClick={() => onMarkDead(player.id)}
              type="button"
            >
              Dead
            </button>
          </div>
          <label className={player.status === 'dead' ? 'checkbox-row seat-dead-vote' : 'checkbox-row seat-dead-vote disabled'}>
            <input
              checked={player.has_dead_vote}
              disabled={player.status !== 'dead'}
              type="checkbox"
              onChange={() => onToggleDeadVote(player)}
            />
            Dead Vote
          </label>
          {activeNomination?.nominee_id === player.id ? (
            <button disabled={!hasExecutionVotes} onClick={() => onExecute(player.id)} type="button">
              Execute
            </button>
          ) : null}
          {!player.is_storyteller ? (
            <button className="secondary danger-button seat-action-kick" onClick={() => onRequestKick(player)} type="button">
              Kick
            </button>
          ) : null}
        </>
      ) : (
        <>
          {canChatWithPlayer ? (
            <button className="secondary" onClick={() => onOpenChat(player.id)} type="button">
              Chat
            </button>
          ) : null}
          <button className="secondary" disabled={roomPhase === 'night'} onClick={() => onStartPrivateCall(player.id)} type="button">
            Call
          </button>
          {!player.is_storyteller ? (
            <>
              <button disabled={!canNominatePlayer} onClick={() => onNominate(player.id)} type="button">
                Nominate
              </button>
              <label>
                Private Suspicion
                <select value={suspectedCharacterId} onChange={(event) => onSuspectedCharacterChange(event.target.value)}>
                  <option value="">Choose character</option>
                  {characters.map((character) => (
                    <option key={character.id} value={character.id}>
                      {characterRole(character)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="secondary"
                disabled={!suspectedCharacterId}
                onClick={() => onPlaceSuspicion(player.id)}
                type="button"
              >
                Place Suspicion
              </button>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
