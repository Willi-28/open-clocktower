/**
 * Room socket event hook.
 *
 * The hook opens the WebSocket for the active room and translates realtime
 * events into React state updates, local sounds, and voice signaling callbacks.
 */

import { useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import { playMessageTone, playNominationKillSound, playVoiceTone, ringBell } from '../../audio/browserAudio';
import { setActivePlayerSecret } from '../../api/client';
import type { RoomState } from '../../api/client';
import { openRoomSocket } from '../../websocket/roomSocket';
import { lastSessionKey, secretKey, sessionKey } from '../sessionStorage';
import type { VoiceParticipant } from '../voiceRooms';

type RoomSocketRef = MutableRefObject<ReturnType<typeof openRoomSocket> | null>;

type ChatMessage = {
  id: string;
  fromPlayerId: string;
  toPlayerId: string | null;
  text: string;
};

type UseRoomSocketEventsOptions = {
  addChatFlight: (fromPlayerId: string, toPlayerId: string) => void;
  appendChatMessage: (message: ChatMessage, tabId?: string) => void;
  applyTimerState: (durationSeconds: number, remainingSeconds: number, isRunning: boolean, startedAt?: string | null) => void;
  applyVoiceParticipants: (participants: VoiceParticipant[]) => void;
  currentPlayerId: string;
  endVoiceSession: (options: { notifyServer: boolean; playTone?: boolean; returnToDefault?: boolean }) => boolean;
  handleVoiceSignal: (fromPlayerId: string, signal: unknown) => Promise<void>;
  joinSelectedVoiceRoom: (voiceRoom?: string) => Promise<void>;
  joinedVoiceRoom: string | null;
  playerName: (playerId: string | undefined) => string;
  room: RoomState | null;
  roomSocketRef: RoomSocketRef;
  setCurrentPlayerId: (playerId: string) => void;
  setError: Dispatch<SetStateAction<string>>;
  setIncomingVoiceCall: (call: { fromPlayerId: string; voiceRoom: string } | null) => void;
  setIsVoteCountRunning: (isRunning: boolean) => void;
  setRaisedHandPlayerIds: Dispatch<SetStateAction<string[]>>;
  setRoom: (room: RoomState | null) => void;
  setSelectedPlayerId: Dispatch<SetStateAction<string>>;
  setVoteCountIndex: (index: number) => void;
  setVoiceParticipants: Dispatch<SetStateAction<VoiceParticipant[]>>;
};

/**
 * Synchronizes room updates and realtime player events from the room socket.
 */
export function useRoomSocketEvents({
  addChatFlight,
  appendChatMessage,
  applyTimerState,
  applyVoiceParticipants,
  currentPlayerId,
  endVoiceSession,
  handleVoiceSignal,
  joinSelectedVoiceRoom,
  joinedVoiceRoom,
  playerName,
  room,
  roomSocketRef,
  setCurrentPlayerId,
  setError,
  setIncomingVoiceCall,
  setIsVoteCountRunning,
  setRaisedHandPlayerIds,
  setRoom,
  setSelectedPlayerId,
  setVoteCountIndex,
  setVoiceParticipants,
}: UseRoomSocketEventsOptions) {
  const latestHandlersRef = useRef({
    addChatFlight,
    appendChatMessage,
    applyTimerState,
    applyVoiceParticipants,
    endVoiceSession,
    handleVoiceSignal,
    joinSelectedVoiceRoom,
    joinedVoiceRoom,
    playerName,
    setCurrentPlayerId,
    setError,
    setIncomingVoiceCall,
    setIsVoteCountRunning,
    setRaisedHandPlayerIds,
    setRoom,
    setSelectedPlayerId,
    setVoteCountIndex,
    setVoiceParticipants,
  });

  useEffect(() => {
    latestHandlersRef.current = {
      addChatFlight,
      appendChatMessage,
      applyTimerState,
      applyVoiceParticipants,
      endVoiceSession,
      handleVoiceSignal,
      joinSelectedVoiceRoom,
      joinedVoiceRoom,
      playerName,
      setCurrentPlayerId,
      setError,
      setIncomingVoiceCall,
      setIsVoteCountRunning,
      setRaisedHandPlayerIds,
      setRoom,
      setSelectedPlayerId,
      setVoteCountIndex,
      setVoiceParticipants,
    };
  });

  useEffect(() => {
    if (!room || !currentPlayerId) {
      return;
    }

    const rememberedPlayerId = localStorage.getItem(sessionKey(room.id));
    if (rememberedPlayerId && room.players.some((player) => player.id === rememberedPlayerId)) {
      setCurrentPlayerId(rememberedPlayerId);
      setSelectedPlayerId((current) => current || rememberedPlayerId);
    }

    /** Route one parsed room socket event to the latest React handlers. */
    const socket = openRoomSocket(room.id, currentPlayerId, (event) => {
      const handlers = latestHandlersRef.current;
      if (event.type === 'connected' && handlers.joinedVoiceRoom) {
        roomSocketRef.current?.joinVoiceRoom(handlers.joinedVoiceRoom);
      }
      if (event.type === 'game.updated') {
        handlers.setRoom(event.payload);
      }
      if (event.type === 'chat.private.notice') {
        handlers.addChatFlight(event.payload.fromPlayerId, event.payload.toPlayerId);
      }
      if (event.type === 'chat.message') {
        const tabId = event.payload.toPlayerId === null ? 'public' : event.payload.fromPlayerId === currentPlayerId ? event.payload.toPlayerId : event.payload.fromPlayerId;
        if (event.payload.fromPlayerId !== currentPlayerId) {
          playMessageTone();
        }
        handlers.appendChatMessage(
          {
            id: crypto.randomUUID(),
            fromPlayerId: event.payload.fromPlayerId,
            toPlayerId: event.payload.toPlayerId,
            text: event.payload.text,
          },
          tabId,
        );
      }
      if (event.type === 'hand.state') {
        handlers.setRaisedHandPlayerIds(event.payload.playerIds);
      }
      if (event.type === 'voice.state') {
        handlers.applyVoiceParticipants(event.payload.participants);
      }
      if (event.type === 'voice.call.request') {
        handlers.setIncomingVoiceCall(event.payload);
        playVoiceTone('call');
      }
      if (event.type === 'voice.call.accept') {
        handlers.setError('');
        void handlers.joinSelectedVoiceRoom(event.payload.voiceRoom);
      }
      if (event.type === 'voice.call.reject') {
        const message = `${handlers.playerName(event.payload.fromPlayerId)} declined the call.`;
        handlers.setError(message);
        // The notice is informational; clear it after a moment unless a newer
        // message has replaced it in the meantime.
        window.setTimeout(() => {
          handlers.setError((current) => (current === message ? '' : current));
        }, 5000);
      }
      if (event.type === 'timer.state') {
        handlers.applyTimerState(
          event.payload.durationSeconds,
          event.payload.remainingSeconds,
          event.payload.isRunning,
          event.payload.startedAt,
        );
      }
      if (event.type === 'bell.ring') {
        ringBell();
      }
      if (event.type === 'nomination.executed') {
        playNominationKillSound();
      }
      if (event.type === 'vote_count.state') {
        handlers.setVoteCountIndex(event.payload.index);
        handlers.setIsVoteCountRunning(event.payload.isRunning);
      }
      if (event.type === 'voice.signal') {
        void handlers.handleVoiceSignal(event.payload.fromPlayerId, event.payload.signal);
      }
      if (event.type === 'room.deleted') {
        handlers.endVoiceSession({ notifyServer: false, playTone: true });
        localStorage.removeItem(sessionKey(event.payload.roomId));
        localStorage.removeItem(secretKey(event.payload.roomId));
        localStorage.removeItem(lastSessionKey());
        setActivePlayerSecret(null);
        handlers.setVoiceParticipants([]);
        handlers.setIncomingVoiceCall(null);
        handlers.setRaisedHandPlayerIds([]);
        handlers.setRoom(null);
        handlers.setError('The room was deleted.');
      }
      if (event.type === 'room.kicked') {
        handlers.endVoiceSession({ notifyServer: false, playTone: true });
        localStorage.removeItem(sessionKey(event.payload.roomId));
        localStorage.removeItem(secretKey(event.payload.roomId));
        localStorage.removeItem(lastSessionKey());
        setActivePlayerSecret(null);
        handlers.setVoiceParticipants([]);
        handlers.setIncomingVoiceCall(null);
        handlers.setRaisedHandPlayerIds([]);
        handlers.setCurrentPlayerId('');
        handlers.setSelectedPlayerId('');
        handlers.setRoom(null);
        handlers.setError(event.payload.reason || 'You were removed from the room.');
      }
    });
    roomSocketRef.current = socket;

    return () => {
      roomSocketRef.current = null;
      socket.close();
    };
  }, [room?.id, currentPlayerId]);
}
