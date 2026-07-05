/**
 * Lobby dashboard header.
 *
 * The panel shows room identity, phase status, current player, mute control,
 * settings access, and the small leave-seat/leave-lobby actions.
 */

import type { CSSProperties } from 'react';

import fullscreenIconUrl from '../../assets/fullscreen.png';
import type { Player, RoomState } from '../../api/client';
import { VoiceMuteIcon } from './VoiceMuteIcon';

type LobbyInfoPanelProps = {
  canChangeSeats: boolean;
  currentPlayer: Player | undefined;
  isFullscreen: boolean;
  isMuted: boolean;
  isStoryteller: boolean;
  joinedVoiceRoom: string | null;
  onCopyRoomCode: () => void;
  onLeaveLobby: () => void;
  onLeaveSeat: () => void;
  onOpenSettings: () => void;
  onToggleFullscreen: () => void;
  onToggleMuted: () => void;
  phaseLabel: string;
  room: RoomState;
};

/** Render the top-left dashboard for the current room and player. */
export function LobbyInfoPanel({
  canChangeSeats,
  currentPlayer,
  isFullscreen,
  isMuted,
  isStoryteller,
  joinedVoiceRoom,
  onCopyRoomCode,
  onLeaveLobby,
  onLeaveSeat,
  onOpenSettings,
  onToggleFullscreen,
  onToggleMuted,
  phaseLabel,
  room,
}: LobbyInfoPanelProps) {
  return (
    <section className="lobby-info">
      <div className="lobby-header">
        <strong>{room.name}</strong>
        <div className="lobby-header-controls">
          <button className="code-pill" onClick={onCopyRoomCode} title="Copy room code" type="button">
            {room.id}
          </button>
          <button
            className="settings-button fullscreen-button"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            onClick={onToggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            type="button"
          >
            <span
              className="fullscreen-icon"
              aria-hidden="true"
              style={{ '--fullscreen-icon-url': `url(${fullscreenIconUrl})` } as CSSProperties}
            />
          </button>
          <button className="settings-button settings-menu-button" aria-label="Open settings" onClick={onOpenSettings} type="button">
            ⚙
          </button>
        </div>
      </div>
      <div className="lobby-meta-row">
        {room.show_board ? <span>{phaseLabel}</span> : null}
        {!room.show_board && room.phase === 'day' ? <span className="rotation-pill">Day {room.day_count}</span> : null}
        {!room.show_board && room.phase === 'night' ? <span className="rotation-pill">Night {room.night_count}</span> : null}
        {!room.show_board && room.phase === 'lobby' ? <span>{phaseLabel}</span> : null}
        {currentPlayer ? <small>{currentPlayer.display_name}</small> : null}
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
          <button className="secondary" onClick={onLeaveLobby} type="button">
            Leave Lobby
          </button>
        ) : null}
      </div>
    </section>
  );
}
