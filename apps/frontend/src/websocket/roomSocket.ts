/**
 * Room WebSocket client.
 *
 * The socket carries live room updates, chat messages, timer events, vote
 * counting, and WebRTC signaling between the frontend and backend.
 */

import { getActivePlayerSecret } from '../api/client';
import type { RoomState } from '../api/client';

// Events the backend can currently send via WebSocket.
export type RoomSocketEvent =
  | { type: 'connected'; payload: { roomId: string } }
  | { type: 'chat.message'; payload: { fromPlayerId: string; toPlayerId: string | null; text: string } }
  | { type: 'chat.private.notice'; payload: { fromPlayerId: string; toPlayerId: string } }
  | { type: 'game.updated'; payload: RoomState }
  | { type: 'hand.state'; payload: { playerIds: string[] } }
  | { type: 'timer.state'; payload: { durationSeconds: number; remainingSeconds: number; isRunning: boolean; startedAt?: string | null } }
  | { type: 'bell.ring'; payload: { fromPlayerId: string } }
  | { type: 'nomination.executed'; payload: { roomId: string } }
  | { type: 'vote_count.state'; payload: { index: number; isRunning: boolean } }
  | { type: 'voice.call.request'; payload: { fromPlayerId: string; voiceRoom: string } }
  | { type: 'voice.call.accept'; payload: { fromPlayerId: string; voiceRoom: string } }
  | { type: 'voice.call.reject'; payload: { fromPlayerId: string } }
  | { type: 'voice.signal'; payload: { fromPlayerId: string; signal: unknown } }
  | { type: 'voice.state'; payload: { participants: Array<{ playerId: string; voiceRoom: string }> } }
  | { type: 'room.kicked'; payload: { roomId: string; reason: string } }
  | { type: 'room.deleted'; payload: { roomId: string } };

/** Open a room socket and expose typed send helpers for live room events. */
export function openRoomSocket(roomId: string, playerId: string, onEvent: (event: RoomSocketEvent) => void) {
  // Automatically choose the WebSocket protocol based on http/https.
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  // Browsers cannot set headers on a WebSocket, so the bearer secret rides in the
  // query string (encrypted under wss). The server downgrades to a spectator if
  // the id and secret do not match.
  const secret = getActivePlayerSecret();
  const params = playerId
    ? `?player_id=${encodeURIComponent(playerId)}${secret ? `&secret=${encodeURIComponent(secret)}` : ''}`
    : '';
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws/rooms/${roomId}${params}`);
  const pendingMessages: string[] = [];

  /** Send JSON immediately or queue it until the socket finishes connecting. */
  function sendJson(payload: unknown) {
    const message = JSON.stringify(payload);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message);
      return true;
    }
    if (socket.readyState === WebSocket.CONNECTING) {
      pendingMessages.push(message);
      return true;
    }
    return false;
  }

  socket.addEventListener('open', () => {
    while (pendingMessages.length > 0 && socket.readyState === WebSocket.OPEN) {
      const message = pendingMessages.shift();
      if (message) {
        socket.send(message);
      }
    }
  });

  socket.addEventListener('message', (message) => {
    // The backend sends JSON events. The app mostly reacts to game.updated.
    // A malformed frame must be ignored rather than throw inside the handler.
    let event: RoomSocketEvent;
    try {
      event = JSON.parse(message.data);
    } catch {
      return;
    }
    onEvent(event);
  });

  return {
    close: () => socket.close(),
    sendChat: (toPlayerId: string | null, text: string) => {
      return sendJson({ type: 'chat.send', payload: { toPlayerId, text } });
    },
    setHandRaised: (isRaised: boolean) => {
      return sendJson({ type: 'hand.set', payload: { isRaised } });
    },
    setTimer: (durationSeconds: number, remainingSeconds: number, isRunning: boolean) => {
      return sendJson({ type: 'timer.set', payload: { durationSeconds, remainingSeconds, isRunning } });
    },
    ringBell: () => {
      return sendJson({ type: 'bell.ring', payload: {} });
    },
    setVoteCount: (index: number, isRunning: boolean) => {
      return sendJson({ type: 'vote_count.set', payload: { index, isRunning } });
    },
    joinVoiceRoom: (voiceRoom: string) => {
      return sendJson({ type: 'voice.join', payload: { voiceRoom } });
    },
    leaveVoiceRoom: () => {
      return sendJson({ type: 'voice.leave', payload: {} });
    },
    requestVoiceCall: (toPlayerId: string, voiceRoom: string) => {
      return sendJson({ type: 'voice.call.request', payload: { toPlayerId, voiceRoom } });
    },
    respondVoiceCall: (toPlayerId: string, voiceRoom: string, accepted: boolean) => {
      return sendJson({ type: accepted ? 'voice.call.accept' : 'voice.call.reject', payload: { toPlayerId, voiceRoom } });
    },
    sendVoiceSignal: (toPlayerId: string, signal: unknown) => {
      return sendJson({ type: 'voice.signal', payload: { toPlayerId, signal } });
    },
  };
}
