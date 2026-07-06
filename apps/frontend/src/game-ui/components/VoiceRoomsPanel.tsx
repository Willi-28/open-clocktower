/**
 * Voice room chooser.
 *
 * This panel shows public voice rooms, current occupants, and compact SVG
 * controls for joining or leaving the selected room.
 */

import type { GamePhase } from '../../api/client';

type VoiceRoomsPanelProps = {
  isStoryteller: boolean;
  isVoiceSwitching: boolean;
  needsVoiceAudioUnlock: boolean;
  joinedVoiceRoom: string | null;
  onEnableVoiceAudio: () => void;
  onJoinVoiceRoom: (voiceRoom: string) => void;
  onLeaveVoiceRoom: () => void;
  publicVoiceOccupants: (voiceRoom: string) => string[];
  roomPhase: GamePhase;
  voiceRoomLabel: (voiceRoom: string) => string;
  voiceRooms: string[];
};

/** Render public voice rooms and their join/leave controls. */
export function VoiceRoomsPanel({
  isStoryteller,
  isVoiceSwitching,
  needsVoiceAudioUnlock,
  joinedVoiceRoom,
  onEnableVoiceAudio,
  onJoinVoiceRoom,
  onLeaveVoiceRoom,
  publicVoiceOccupants,
  roomPhase,
  voiceRoomLabel,
  voiceRooms,
}: VoiceRoomsPanelProps) {
  // At night players stay where they are: no self-initiated switching at all.
  // Only a storyteller call can move them (handled via the incoming-call flow).
  const isNightLocked = roomPhase === 'night' && !isStoryteller;

  return (
    <details open>
      <summary>Voice Rooms</summary>
      <div className="voice-room-list">
        {voiceRooms.map((voiceRoom) => {
          const isJoined = joinedVoiceRoom === voiceRoom;
          const isDefaultRoom = voiceRoom === voiceRooms[0];
          return (
            <button
              className={isJoined ? 'voice-room active' : 'voice-room'}
              disabled={isVoiceSwitching || isNightLocked}
              key={voiceRoom}
              onClick={() => {
                if (!isJoined) {
                  onJoinVoiceRoom(voiceRoom);
                  return;
                }
                if (!isDefaultRoom) {
                  onLeaveVoiceRoom();
                }
              }}
              type="button"
            >
              <span>{voiceRoom}</span>
              <small>{publicVoiceOccupants(voiceRoom).join(', ')}</small>
              <span className="voice-room-action" aria-hidden="true">
                <VoiceRoomActionIcon state={isJoined ? (isDefaultRoom ? 'current' : 'leave') : 'join'} />
              </span>
            </button>
          );
        })}
      </div>
      {joinedVoiceRoom ? (
        <div className="voice-current-room">
          <p className="helper-text">You are in {voiceRoomLabel(joinedVoiceRoom)}</p>
          {joinedVoiceRoom.includes(':private:') ? (
            <button className="secondary icon-button" aria-label="Leave private call" onClick={onLeaveVoiceRoom} type="button">
              x
            </button>
          ) : null}
        </div>
      ) : null}
      {needsVoiceAudioUnlock ? (
        <div className="voice-audio-unlock" role="alert">
          <p className="helper-text">Your browser blocked incoming voice audio.</p>
          <button onClick={onEnableVoiceAudio} type="button">
            Enable voice audio
          </button>
        </div>
      ) : null}
      {isNightLocked ? (
        <p className="helper-text">Voice rooms are locked during night.</p>
      ) : null}
    </details>
  );
}

/** Draw the SVG action icon for current, join, and leave states. */
function VoiceRoomActionIcon({ state }: { state: 'current' | 'join' | 'leave' }) {
  if (state === 'current') {
    return (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M5 12.5 9.5 17 19 7.5" />
      </svg>
    );
  }
  if (state === 'leave') {
    return (
      <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <path d="M16 5h3v14h-3" />
        <path d="M12 8l-4 4 4 4" />
        <path d="M8 12h10" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <path d="M18 5v14" />
      <path d="M11 8l4 4-4 4" />
      <path d="M15 12H5" />
    </svg>
  );
}
