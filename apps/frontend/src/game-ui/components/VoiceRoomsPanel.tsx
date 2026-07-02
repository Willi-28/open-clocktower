import type { GamePhase } from '../../api/client';

type VoiceRoomsPanelProps = {
  isStoryteller: boolean;
  isVoiceSwitching: boolean;
  joinedVoiceRoom: string | null;
  onJoinVoiceRoom: (voiceRoom: string) => void;
  onLeaveVoiceRoom: () => void;
  publicVoiceOccupants: (voiceRoom: string) => string[];
  publicVoiceDuringNight: boolean;
  roomPhase: GamePhase;
  voiceRoomLabel: (voiceRoom: string) => string;
  voiceRooms: string[];
};

export function VoiceRoomsPanel({
  isStoryteller,
  isVoiceSwitching,
  joinedVoiceRoom,
  onJoinVoiceRoom,
  onLeaveVoiceRoom,
  publicVoiceOccupants,
  publicVoiceDuringNight,
  roomPhase,
  voiceRoomLabel,
  voiceRooms,
}: VoiceRoomsPanelProps) {
  const isPublicVoiceClosed = roomPhase === 'night' && !isStoryteller && !publicVoiceDuringNight;

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
              disabled={isVoiceSwitching || isPublicVoiceClosed}
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
      {isPublicVoiceClosed && !joinedVoiceRoom ? (
        <p className="helper-text">Public voice is closed during night.</p>
      ) : null}
    </details>
  );
}

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
