/**
 * Lobby dashboard header.
 *
 * The panel shows room identity, phase status, current player, mute control,
 * settings access, and the small leave-seat/leave-lobby actions.
 */

import type { Player, RoomState } from '../../api/client';
import { VoiceMuteIcon } from './VoiceMuteIcon';

type LobbyInfoPanelProps = {
  canChangeSeats: boolean;
  currentPlayer: Player | undefined;
  isLobby: boolean;
  isMuted: boolean;
  isStoryteller: boolean;
  joinedVoiceRoom: string | null;
  onCopyRoomCode: () => void;
  onLeaveLobby: () => void;
  onLeaveSeat: () => void;
  onOpenSettings: () => void;
  onToggleMuted: () => void;
  phaseLabel: string;
  room: RoomState;
};

/** Render the top-left dashboard for the current room and player. */
export function LobbyInfoPanel({
  canChangeSeats,
  currentPlayer,
  isLobby,
  isMuted,
  isStoryteller,
  joinedVoiceRoom,
  onCopyRoomCode,
  onLeaveLobby,
  onLeaveSeat,
  onOpenSettings,
  onToggleMuted,
  phaseLabel,
  room,
}: LobbyInfoPanelProps) {
  return (
    <section className="lobby-info">
      <div>
        <strong>{room.name}</strong>
        <span className="lobby-meta-row">
          {room.show_board ? <span>{phaseLabel}</span> : null}
          {!room.show_board && room.phase === 'day' ? <span className="rotation-pill">Day {room.day_count}</span> : null}
          {!room.show_board && room.phase === 'night' ? <span className="rotation-pill">Night {room.night_count}</span> : null}
          {!room.show_board && room.phase === 'lobby' ? <span>{phaseLabel}</span> : null}
          {currentPlayer ? <small>{currentPlayer.display_name}</small> : null}
        </span>
        <button className="code-pill" onClick={onCopyRoomCode} title="Copy room code" type="button">
          {room.id}
        </button>
        <button className="settings-button" aria-label="Open settings" onClick={onOpenSettings} type="button">
          ⚙
        </button>
      </div>
      <div className="lobby-actions">
        {currentPlayer ? (
          <button className={isMuted ? 'voice-toggle-button hand-button raised' : 'voice-toggle-button hand-button'} disabled={!joinedVoiceRoom} onClick={onToggleMuted} type="button">
            <VoiceMuteIcon isMuted={isMuted} />
            <span>{isMuted ? 'Muted' : 'Unmuted'}</span>
          </button>
        ) : null}
        {currentPlayer && !isStoryteller ? (
          <button
            className="secondary"
            disabled={!canChangeSeats || currentPlayer.seat_index === null}
            onClick={onLeaveSeat}
            type="button"
          >
            Leave Seat
          </button>
        ) : null}
        {currentPlayer && !isStoryteller ? (
          <button className="secondary" disabled={!isLobby} onClick={onLeaveLobby} type="button">
            Leave Lobby
          </button>
        ) : null}
      </div>
    </section>
  );
}
