/**
 * Voice room chooser.
 *
 * Blood-on-the-Clocktower styled list of public voice rooms. Only the joined
 * room expands with occupants (avatar + name, no role); the bottom user strip
 * carries mic, deafen, and leave controls.
 */

import type { GamePhase } from '../../api/client';
import { VoiceMuteIcon } from './VoiceMuteIcon';

export type VoiceOccupant = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

type VoiceRoomsPanelProps = {
  currentPlayerName: string;
  currentPlayerAvatarUrl: string | null;
  hasUnreadChat: boolean;
  isChatOpen: boolean;
  isDeafened: boolean;
  isMuted: boolean;
  isStoryteller: boolean;
  isVoiceSwitching: boolean;
  needsVoiceAudioUnlock: boolean;
  joinedVoiceRoom: string | null;
  onEnableVoiceAudio: () => void;
  onJoinVoiceRoom: (voiceRoom: string) => void;
  onLeaveVoiceRoom: (returnToDefault?: boolean) => void;
  mutedPlayerIds: string[];
  deafenedPlayerIds: string[];
  onToggleChat: () => void;
  onToggleDeafened: () => void;
  onToggleMuted: () => void;
  publicVoiceRoomsLocked: boolean;
  publicVoiceOccupants: (voiceRoom: string) => VoiceOccupant[];
  roomPhase: GamePhase;
  speakingPlayerIds: string[];
  voiceRoomLabel: (voiceRoom: string) => string;
  voiceRooms: string[];
};

/** First two initials of a display name, for an avatar-less chip. */
function occupantInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Animated speaking bars shown beside a talking occupant. */
function SpeakingBars() {
  return (
    <span className="voice-speaking-bars" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/** Render public voice rooms and their join/leave controls. */
export function VoiceRoomsPanel({
  currentPlayerName,
  currentPlayerAvatarUrl,
  hasUnreadChat,
  isChatOpen,
  isDeafened,
  isMuted,
  isStoryteller,
  isVoiceSwitching,
  needsVoiceAudioUnlock,
  joinedVoiceRoom,
  onEnableVoiceAudio,
  onJoinVoiceRoom,
  onLeaveVoiceRoom,
  mutedPlayerIds,
  deafenedPlayerIds,
  onToggleChat,
  onToggleDeafened,
  onToggleMuted,
  publicVoiceRoomsLocked,
  publicVoiceOccupants,
  roomPhase,
  speakingPlayerIds,
  voiceRoomLabel,
  voiceRooms,
}: VoiceRoomsPanelProps) {
  // Night can lock public rooms, but a private storyteller call must never trap
  // the player; leaving it quietly is always allowed.
  const isPrivateCall = Boolean(joinedVoiceRoom?.includes(':private:'));
  const speakingSet = new Set(speakingPlayerIds);
  const mutedSet = new Set(mutedPlayerIds);
  const deafenedSet = new Set(deafenedPlayerIds);

  return (
    <section className="voice-panel" aria-labelledby="voice-panel-heading">
      <div className="voice-panel-title" id="voice-panel-heading">
        <span className="voice-panel-heading">
          <strong>Voice Rooms</strong>
        </span>
      </div>

      <div className="voice-panel-shell">
        <OrnamentDivider />

        <div className="voice-room-list">
          {voiceRooms.map((voiceRoom) => {
            const isJoined = joinedVoiceRoom === voiceRoom;
            const isDefaultRoom = voiceRoom === voiceRooms[0];
            const occupants = publicVoiceOccupants(voiceRoom);
            return (
              <div className={isJoined ? 'voice-room-block active' : 'voice-room-block'} key={voiceRoom}>
                <button
                  className={isJoined ? 'voice-room active' : 'voice-room'}
                  disabled={isVoiceSwitching || publicVoiceRoomsLocked}
                  onClick={() => {
                    if (!isJoined) {
                      onJoinVoiceRoom(voiceRoom);
                      return;
                    }
                    if (!isDefaultRoom) {
                      onLeaveVoiceRoom(true);
                    }
                  }}
                  type="button"
                >
                  <span className="voice-room-body">
                    {/* Public rooms render as their own name; a private call
                        becomes "Private Call: A + B" instead of its raw id. */}
                    <span className="voice-room-name">{voiceRoomLabel(voiceRoom)}</span>
                    {occupants.length === 0 ? <span className="voice-room-sub">silence reigns…</span> : null}
                  </span>
                  {isJoined ? <span className="voice-room-marker" aria-hidden="true">◆</span> : null}
                </button>
                {occupants.length > 0 ? (
                  <div className="voice-room-occupants">
                    {occupants.map((occupant) => {
                      const isSpeaking = speakingSet.has(occupant.id);
                      return (
                        <div className={isSpeaking ? 'voice-occupant speaking' : 'voice-occupant'} key={occupant.id}>
                          {occupant.avatarUrl ? (
                            <img className="voice-occupant-avatar" alt="" src={occupant.avatarUrl} />
                          ) : (
                            <span className="voice-occupant-avatar voice-occupant-fallback" aria-hidden="true">
                              {occupantInitials(occupant.name)}
                            </span>
                          )}
                          <span className="voice-occupant-name">{occupant.name}</span>
                          {mutedSet.has(occupant.id) || deafenedSet.has(occupant.id) ? (
                            <span className="voice-occupant-status" aria-hidden="true">
                              <span
                                className="voice-occupant-muted"
                                title={deafenedSet.has(occupant.id) ? 'Muted & deafened' : 'Microphone muted'}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.7" />
                                  <path d="M17 11a5 5 0 0 1-.6 2.4M5 11a7 7 0 0 0 10.8 5.9M12 19v3" />
                                  <path d="m3 3 18 18" />
                                </svg>
                              </span>
                              {deafenedSet.has(occupant.id) ? (
                                <span className="voice-occupant-muted deafened" title="Deafened (hears nobody)">
                                  <HeadphoneIcon deafened />
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                          {isSpeaking ? <SpeakingBars /> : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="voice-panel-footer">
          {needsVoiceAudioUnlock ? (
            <div className="voice-audio-unlock" role="alert">
              <p className="helper-text">Your browser blocked incoming voice audio.</p>
              <button onClick={onEnableVoiceAudio} type="button">
                Enable voice audio
              </button>
            </div>
          ) : null}
          {publicVoiceRoomsLocked ? <p className="helper-text">Public voice rooms are locked during night. Private calls can still be left quietly.</p> : null}

          <OrnamentDivider />

          {/* User panel: identity + mic, deafen, and leave controls. */}
          <div className="voice-user-panel">
            <span className="voice-user-identity">
              {currentPlayerAvatarUrl ? (
                <img className="voice-user-avatar" alt="" src={currentPlayerAvatarUrl} />
              ) : (
                <span className="voice-user-avatar voice-user-avatar-fallback" aria-hidden="true">
                  {occupantInitials(currentPlayerName)}
                </span>
              )}
              <span className="voice-user-text">
                <strong>{currentPlayerName}</strong>
                <small>{joinedVoiceRoom ? voiceRoomLabel(joinedVoiceRoom) : 'Not in voice'}</small>
              </span>
            </span>
            <span className="voice-user-controls">
              <button
                className={[
                  'voice-user-button chat-toggle',
                  isChatOpen ? 'open' : '',
                  hasUnreadChat ? 'unread' : '',
                ].filter(Boolean).join(' ')}
                onClick={onToggleChat}
                aria-label={
                  hasUnreadChat
                    ? 'Open text chat window (unread messages)'
                    : isChatOpen
                      ? 'Close text chat window'
                      : 'Open text chat window'
                }
                aria-pressed={isChatOpen}
                title={hasUnreadChat ? 'Text chat - unread messages' : isChatOpen ? 'Close text chat' : 'Open text chat'}
                type="button"
              >
                <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.3a7.6 7.6 0 0 1-8.2 7.5 8.6 8.6 0 0 1-3.5-.7L4 19.5l1.5-4.1a7.2 7.2 0 0 1-1-3.8A7.6 7.6 0 0 1 12.7 4 7.6 7.6 0 0 1 21 11.3Z" />
                </svg>
              </button>
              <button
                className={isMuted ? 'voice-user-button active' : 'voice-user-button'}
                disabled={!joinedVoiceRoom || isDeafened}
                onClick={onToggleMuted}
                aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                title={isDeafened ? 'Microphone stays muted while deafened' : isMuted ? 'Unmute microphone' : 'Mute microphone'}
                type="button"
              >
                <VoiceMuteIcon isMuted={isMuted} />
              </button>
              <button
                className={isDeafened ? 'voice-user-button active' : 'voice-user-button'}
                onClick={onToggleDeafened}
                aria-label={isDeafened ? 'Undeafen' : 'Deafen (mute everyone)'}
                title={isDeafened ? 'Undeafen' : 'Deafen (mute everyone)'}
                type="button"
              >
                <HeadphoneIcon deafened={isDeafened} />
              </button>
              <button
                className="voice-user-button voice-user-leave"
                disabled={!joinedVoiceRoom || joinedVoiceRoom === voiceRooms[0] || isVoiceSwitching}
                onClick={() => onLeaveVoiceRoom(!(roomPhase === 'night' && !isStoryteller && isPrivateCall))}
                aria-label="Leave voice room"
                title={isPrivateCall ? 'Leave private call' : 'Leave voice room'}
                type="button"
              >
                <LeaveIcon />
              </button>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Headphone icon, with a slash overlay when deafened. */
function HeadphoneIcon({ deafened }: { deafened: boolean }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
      <path d="M4 14a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2 1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Z" />
      <path d="M20 14a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2 1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1Z" />
      {deafened ? <path d="m3 3 18 18" /> : null}
    </svg>
  );
}

/** Leave-voice icon: an arrow stepping out through a doorway. */
function LeaveIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8" />
      <path d="M14 12h7" />
      <path d="m18 9 3 3-3 3" />
    </svg>
  );
}

/** A slim engraved flourish (line — diamond bowtie — line) between panel sections. */
function OrnamentDivider() {
  return (
    <div className="voice-ornament" aria-hidden="true">
      <span className="voice-ornament-line" />
      <svg className="voice-ornament-mark" viewBox="0 0 46 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 6 19 2v8z" fill="currentColor" />
        <path d="M33 6 27 2v8z" fill="currentColor" />
        <path d="M23 2.5 26.5 6 23 9.5 19.5 6z" fill="currentColor" />
      </svg>
      <span className="voice-ornament-line" />
    </div>
  );
}
