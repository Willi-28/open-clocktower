/**
 * Collapsible top options bar.
 *
 * Groups the one-time / session controls (room identity, room code, player
 * name, phase, mute, leave seat, leave lobby, settings, fullscreen) into one
 * bar across the top so the side panels stay focused on live play. Collapsing
 * it shrinks the bar to a slim strip to give the table more room.
 */

import type { CSSProperties } from 'react';

import fullscreenIconUrl from '../../assets/fullscreen.png';
import type { Player, RoomState } from '../../api/client';

type GameTopBarProps = {
  currentPlayer: Player | undefined;
  isFullscreen: boolean;
  isOpen: boolean;
  isStoryteller: boolean;
  onCopyRoomCode: () => void;
  onDeleteRoom: () => void;
  onLeaveLobby: () => void;
  onLeaveSeat: () => void;
  onOpenSettings: () => void;
  onToggleFullscreen: () => void;
  onToggleOpen: () => void;
  phaseLabel: string;
  room: RoomState;
};

/** Render the collapsible top bar with room identity and one-time controls. */
export function GameTopBar({
  currentPlayer,
  isFullscreen,
  isOpen,
  isStoryteller,
  onCopyRoomCode,
  onDeleteRoom,
  onLeaveLobby,
  onLeaveSeat,
  onOpenSettings,
  onToggleFullscreen,
  onToggleOpen,
  phaseLabel,
  room,
}: GameTopBarProps) {
  const rotationLabel =
    !room.show_board && room.phase === 'day'
      ? `Day ${room.day_count}`
      : !room.show_board && room.phase === 'night'
        ? `Night ${room.night_count}`
        : phaseLabel;

  // Fully collapsed: only a slim handle remains so the table gets the space.
  if (!isOpen) {
    return (
      <header className="game-top-bar collapsed">
        <button className="top-bar-reopen" onClick={onToggleOpen} aria-label="Show top bar" title="Show top bar" type="button">
          <span className="top-bar-reopen-label">{room.name}</span>
          <span aria-hidden="true">▾</span>
        </button>
      </header>
    );
  }

  return (
    <header
      className="game-top-bar"
      title="Click an empty area to collapse"
      onClick={(event) => {
        // Clicking an empty (non-interactive) area collapses the bar.
        if (event.target instanceof Element && !event.target.closest('button, a, input, select')) {
          onToggleOpen();
        }
      }}
    >
      <div className="top-bar-identity">
        <strong className="top-bar-room">{room.name}</strong>
        <button className="code-pill top-bar-code" onClick={onCopyRoomCode} title="Copy room code" type="button">
          {room.id}
        </button>
        <span className="rotation-pill top-bar-phase">{rotationLabel}</span>
        {currentPlayer ? <span className="top-bar-player">{currentPlayer.display_name}</span> : null}
      </div>

      <div className="top-bar-actions">
        {currentPlayer && !isStoryteller ? (
          <button
            className="top-bar-button top-bar-optional"
            disabled={currentPlayer.seat_index === null}
            onClick={onLeaveSeat}
            type="button"
          >
            Leave Seat
          </button>
        ) : null}
        {currentPlayer && !isStoryteller ? (
          <button className="top-bar-button top-bar-optional" onClick={onLeaveLobby} type="button">
            Leave Lobby
          </button>
        ) : null}
        {isStoryteller ? (
          <button className="top-bar-button top-bar-optional secondary danger-button" onClick={onDeleteRoom} type="button">
            Delete Room
          </button>
        ) : null}
        <button
          className="top-bar-button top-bar-icon fullscreen-button"
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
        <button className="top-bar-button top-bar-icon" aria-label="Open settings" onClick={onOpenSettings} title="Settings" type="button">
          ⚙
        </button>
      </div>
    </header>
  );
}
