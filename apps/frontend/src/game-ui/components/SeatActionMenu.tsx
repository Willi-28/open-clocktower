/**
 * Per-seat action menu.
 *
 * The menu adapts to storyteller and player permissions, exposing chat, calls,
 * nominations, status changes, execution, suspicion, and kick controls.
 */

import type { CSSProperties } from 'react';

import type { Character, Nomination, Player, RoomState } from '../../api/client';
import { characterRole } from '../gameText';

type SeatActionMenuProps = {
  activeNomination: Nomination | null | undefined;
  anchorStyle?: CSSProperties;
  characters: Character[];
  chatTargets: Player[];
  currentPlayer: Player;
  hasExecutionVotes: boolean;
  isStoryteller: boolean;
  player: Player;
  playerVolume: number;
  roomPhase: RoomState['phase'];
  suspectedCharacterId: string;
  onClose: () => void;
  onSetPlayerVolume: (volume: number) => void;
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

/** Render contextual actions for the selected seat/player. */
export function SeatActionMenu({
  activeNomination,
  anchorStyle,
  characters,
  chatTargets,
  currentPlayer,
  hasExecutionVotes,
  isStoryteller,
  player,
  playerVolume,
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
  onSetPlayerVolume,
  onStartPrivateCall,
  onSuspectedCharacterChange,
  onToggleDeadVote,
}: SeatActionMenuProps) {
  const canChatWithPlayer = chatTargets.some((target) => target.id === player.id);
  const canNominatePlayer = roomPhase === 'day' && currentPlayer.status === 'alive' && player.status === 'alive';

  return (
    <div className="seat-action-menu" style={anchorStyle}>
      <div className="seat-action-header">
        <strong>{player.display_name}</strong>
        <button className="secondary" onClick={onClose} type="button">
          Close
        </button>
      </div>
      {isStoryteller ? (
        <>
          <div className="seat-action-comm-row">
            <button className="secondary" onClick={() => onOpenChat(player.id)} type="button">
              Chat
            </button>
            <button className="secondary" onClick={() => onStartPrivateCall(player.id)} type="button">
              Call
            </button>
          </div>
          <label className="seat-action-volume">
            <span>Volume</span>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={playerVolume}
              onChange={(event) => onSetPlayerVolume(Number(event.target.value))}
            />
            <small>{Math.round(playerVolume * 100)}%</small>
          </label>
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
          <div className="seat-action-comm-row">
            {canChatWithPlayer ? (
              <button className="secondary" onClick={() => onOpenChat(player.id)} type="button">
                Chat
              </button>
            ) : null}
            <button className="secondary" disabled={roomPhase === 'night'} onClick={() => onStartPrivateCall(player.id)} type="button">
              Call
            </button>
          </div>
          <label className="seat-action-volume">
            <span>Volume</span>
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={playerVolume}
              onChange={(event) => onSetPlayerVolume(Number(event.target.value))}
            />
            <small>{Math.round(playerVolume * 100)}%</small>
          </label>
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
