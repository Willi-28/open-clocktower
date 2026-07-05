/**
 * Storyteller tools dashboard.
 *
 * This component groups pre-game setup, live timer/vote/grimoire tools, and
 * post-game room actions while keeping each subsection collapsible.
 */

import { useEffect, useMemo, useState } from 'react';

import type { Character, Player, RoomState } from '../../api/client';
import { characterRole } from '../gameText';
import { formatTimer } from '../timer';
import { RoleDistribution } from './RoleDistribution';

export type StorytellerToolsPanelProps = {
  activeNomination: RoomState['active_nomination'] | undefined;
  activeVoteOrderLength: number;
  characters: Character[];
  currentPlayerId: string;
  hasExecutionVotes: boolean;
  isLobby: boolean;
  isTimerRunning: boolean;
  isVoteCountRunning: boolean;
  randomCharacterIds: string[];
  requiredExecutionVotes: number;
  room: RoomState;
  runningVoteCount: number;
  seatedPlayerCount: number;
  selectedPlayer: Player | undefined;
  selectedPlayerId: string;
  timerRemaining: number;
  voteCount: number;
  voteCountIndex: number;
  onAssignRandomCharacters: () => void;
  onCancelVote: () => void;
  onExecutePlayer: (playerId: string) => void;
  onKickPlayer: (playerId: string) => void;
  onResetTimer: (seconds?: number) => void;
  onResetVoteCount: () => void;
  onRingBell: () => void;
  onSelectPlayer: (playerId: string) => void;
  onDeleteRoom: () => void;
  onSetDay: () => void;
  onSetNight: () => void;
  onSetSeatCount: (seatCount: number) => void;
  onShowBoard: () => void;
  onTogglePublicVoiceDuringNight: (isAllowed: boolean) => void;
  onStartGame: () => void;
  onStartVoteCount: () => void;
  onToggleRandomCharacter: (characterId: string) => void;
  onSelectSharedGrimoirePlayer: (playerId: string, isShared: boolean) => void;
  onToggleTimer: () => void;
  onTransferStoryteller: (playerId: string) => void;
};

/** Render the collapsible storyteller-only controls. */
export function StorytellerToolsPanel({
  activeNomination,
  activeVoteOrderLength,
  characters,
  currentPlayerId,
  hasExecutionVotes,
  isLobby,
  isTimerRunning,
  isVoteCountRunning,
  randomCharacterIds,
  requiredExecutionVotes,
  room,
  runningVoteCount,
  seatedPlayerCount,
  selectedPlayer,
  selectedPlayerId,
  timerRemaining,
  voteCount,
  voteCountIndex,
  onAssignRandomCharacters,
  onCancelVote,
  onExecutePlayer,
  onKickPlayer,
  onResetTimer,
  onResetVoteCount,
  onRingBell,
  onSelectPlayer,
  onDeleteRoom,
  onSetDay,
  onSetNight,
  onSetSeatCount,
  onShowBoard,
  onTogglePublicVoiceDuringNight,
  onStartGame,
  onStartVoteCount,
  onToggleRandomCharacter,
  onSelectSharedGrimoirePlayer,
  onToggleTimer,
  onTransferStoryteller,
}: StorytellerToolsPanelProps) {
  const shareablePlayers = useMemo(() => room.players.filter((player) => !player.is_storyteller), [room.players]);
  const [selectedGrimoirePlayerId, setSelectedGrimoirePlayerId] = useState('');
  const [isEditingTimer, setIsEditingTimer] = useState(false);
  const [timerDraft, setTimerDraft] = useState(formatTimer(timerRemaining));
  const selectedGrimoirePlayer = shareablePlayers.find((player) => player.id === selectedGrimoirePlayerId);
  const isSelectedGrimoirePlayerShared = Boolean(
    selectedGrimoirePlayer && room.shared_grimoire_player_ids.includes(selectedGrimoirePlayer.id),
  );
  const canTransferStoryteller = isLobby || room.show_board;

  useEffect(() => {
    if (!isEditingTimer) {
      setTimerDraft(formatTimer(timerRemaining));
    }
  }, [isEditingTimer, timerRemaining]);

  useEffect(() => {
    if (selectedGrimoirePlayerId && !shareablePlayers.some((player) => player.id === selectedGrimoirePlayerId)) {
      setSelectedGrimoirePlayerId('');
    }
  }, [selectedGrimoirePlayerId, shareablePlayers]);

  /** Validate the editable MM:SS timer input and apply it to the shared timer. */
  function commitTimerDraft() {
    const seconds = parseTimerDraft(timerDraft);
    if (seconds === null) {
      setTimerDraft(formatTimer(timerRemaining));
      setIsEditingTimer(false);
      return;
    }
    setIsEditingTimer(false);
    onResetTimer(seconds);
  }

  return (
    <div className="storyteller-tools">
      <div className="button-row">
        <button disabled={!isLobby && !room.show_board} onClick={onStartGame} type="button">
          Start Game
        </button>
        <button disabled={isLobby || room.phase === 'day'} onClick={onSetDay} type="button">
          Day
        </button>
        <button disabled={isLobby || room.phase === 'night'} onClick={onSetNight} type="button">
          Night
        </button>
      </div>

      <details>
        <summary>Pre-Game</summary>
        <h3 className="tool-section-heading">Room Rules</h3>
        <label>
          Seats
          <input
            disabled={!isLobby && !room.show_board}
            min="5"
            max="20"
            type="number"
            value={room.seat_count}
            onChange={(event) => onSetSeatCount(Number(event.target.value))}
          />
        </label>
        {!isLobby && !room.show_board ? <p className="helper-text">Seat count is locked while the game is running.</p> : null}
        <label className="checkbox-row">
          <input
            checked={room.allow_public_voice_during_night}
            type="checkbox"
            onChange={(event) => onTogglePublicVoiceDuringNight(event.target.checked)}
          />
          Allow public voice chat during night
        </label>

        <h3 className="tool-section-heading">Character Setup</h3>
        <RoleDistribution playerCount={seatedPlayerCount} />
        {characters.length === 0 ? <p className="helper-text">No character pack is loaded. Choose a pack before creating the next room.</p> : null}
        <p className="helper-text">Select the in-play characters, then assign them randomly to seated players.</p>
        <div className="character-pool">
          {characters.map((character) => (
            <label className="checkbox-row" key={character.id}>
              <input
                checked={randomCharacterIds.includes(character.id)}
                type="checkbox"
                onChange={() => onToggleRandomCharacter(character.id)}
              />
              {characterRole(character)}
            </label>
          ))}
        </div>
        <button disabled={randomCharacterIds.length !== seatedPlayerCount} onClick={onAssignRandomCharacters} type="button">
          Randomly Assign {randomCharacterIds.length}/{seatedPlayerCount}
        </button>

        <h3 className="tool-section-heading">{isLobby ? 'Lobby Players' : 'Room Players'}</h3>
        <div className="player-list">
          {room.players.map((player) => (
            <button
              className={selectedPlayerId === player.id ? 'player-row selected' : 'player-row'}
              key={player.id}
              onClick={() => onSelectPlayer(player.id)}
              type="button"
            >
              <span>{player.display_name}</span>
              <small>
                {player.is_storyteller ? 'Storyteller' : 'Player'} - {player.is_connected ? 'Online' : 'Offline'}
              </small>
            </button>
          ))}
        </div>
        <button disabled={!canTransferStoryteller || !selectedPlayerId || selectedPlayerId === currentPlayerId} onClick={() => onTransferStoryteller(selectedPlayerId)} type="button">
          Transfer Storyteller Role
        </button>
        <button
          className="secondary danger-button"
          disabled={!canTransferStoryteller || !selectedPlayerId || selectedPlayerId === currentPlayerId || Boolean(selectedPlayer?.is_storyteller)}
          onClick={() => onKickPlayer(selectedPlayerId)}
          type="button"
        >
          Kick Player
        </button>
        {!canTransferStoryteller ? <p className="helper-text">Storyteller transfer is available before the game starts or after Show Board.</p> : null}
        {selectedPlayer?.is_storyteller ? <p className="helper-text">The storyteller stays in the room without a seat.</p> : null}
      </details>

      <details>
        <summary>Live Game</summary>
        <details className="live-game-section timer-tool">
          <summary>Timer</summary>
          <div className="timer-tool-grid">
            <div className="timer-display">
              <input
                aria-label="Timer duration"
                inputMode="numeric"
                value={isEditingTimer ? timerDraft : formatTimer(timerRemaining)}
                onBlur={commitTimerDraft}
                onChange={(event) => {
                  setIsEditingTimer(true);
                  setTimerDraft(event.target.value);
                }}
                onFocus={() => {
                  setIsEditingTimer(true);
                  setTimerDraft(formatTimer(timerRemaining));
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur();
                  }
                  if (event.key === 'Escape') {
                    setTimerDraft(formatTimer(timerRemaining));
                    setIsEditingTimer(false);
                    event.currentTarget.blur();
                  }
                }}
              />
              <span>{isTimerRunning ? 'Running' : 'Paused'}</span>
            </div>
            <div className="timer-tool-actions">
              <button onClick={onToggleTimer} type="button">
                {isTimerRunning ? 'Pause' : 'Start'}
              </button>
              <button className="secondary" onClick={() => onResetTimer()} type="button">
                Reset
              </button>
              <button className="secondary" onClick={onRingBell} type="button">
                Ring Bell
              </button>
            </div>
          </div>
        </details>

        {activeNomination ? (
          <div className="live-game-section vote-panel">
            <div className="vote-count-headline">
              <span className={hasExecutionVotes ? 'vote-threshold reached' : 'vote-threshold'}>
                <strong>{voteCount}</strong> of {requiredExecutionVotes} votes
              </span>
            </div>
            <div className="vote-counter-meter">
              <span>Clockwise count</span>
              <strong>{Math.max(0, voteCountIndex + 1)}/{activeVoteOrderLength}</strong>
              <span>Votes counted</span>
              <strong>{runningVoteCount}</strong>
            </div>
            <div className="vote-count-tools">
              <div className="button-row">
                <button disabled={activeVoteOrderLength === 0 || isVoteCountRunning} onClick={onStartVoteCount} type="button">
                  {isVoteCountRunning ? 'Counting...' : 'Count Vote'}
                </button>
                <button className="secondary" onClick={onResetVoteCount} type="button">
                  Reset Count
                </button>
                <button disabled={!hasExecutionVotes} onClick={() => onExecutePlayer(activeNomination.nominee_id)} type="button">
                  Execute
                </button>
                <button className="secondary" onClick={onCancelVote} type="button">
                  Cancel Vote
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <details className="live-game-section">
          <summary>Share Grimoire</summary>
          <p className="helper-text">Temporarily share roles and reminder tokens with selected players.</p>
          <label>
            Player
            <select value={selectedGrimoirePlayerId} onChange={(event) => setSelectedGrimoirePlayerId(event.target.value)}>
              <option value="">Choose player</option>
              {shareablePlayers.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.display_name}
                  {room.shared_grimoire_player_ids.includes(player.id) ? ' - shared' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!selectedGrimoirePlayer}
            onClick={() => {
              if (selectedGrimoirePlayer) {
                onSelectSharedGrimoirePlayer(selectedGrimoirePlayer.id, isSelectedGrimoirePlayerShared);
              }
            }}
            type="button"
          >
            {isSelectedGrimoirePlayerShared ? 'Stop Sharing With Player' : 'Share With Player'}
          </button>
        </details>
      </details>

      <details>
        <summary>Post-Game</summary>
        <div className="post-game-actions">
          <button disabled={room.show_board} onClick={onShowBoard} type="button">
            {room.show_board ? 'Board Shown' : 'Show Board'}
          </button>
          <button className="secondary danger-button" onClick={onDeleteRoom} type="button">
            Delete Room
          </button>
        </div>
      </details>
    </div>
  );
}

/** Parse a MM:SS or minute-only timer draft into clamped seconds. */
function parseTimerDraft(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parts = trimmed.split(':');
  if (parts.length > 2 || parts.some((part) => part.trim() === '')) {
    return null;
  }
  const minutes = Number(parts[0]);
  const seconds = parts.length === 2 ? Number(parts[1]) : 0;
  if (!Number.isInteger(minutes) || !Number.isInteger(seconds) || minutes < 0 || seconds < 0 || seconds > 59) {
    return null;
  }
  return Math.max(1, Math.min(60 * 60, minutes * 60 + seconds));
}
