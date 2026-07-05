/**
 * Optimistic seat movement hook.
 *
 * Fast seat clicks update the local UI immediately, then debounce backend
 * writes so players cannot flood the server with seat-change requests.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { RoomState, updatePlayer } from '../../api/client';

const seatMoveFlushDelayMs = 450;
const seatMoveRenderThrottleMs = 160;
const seatRateLimitMessage = 'seat changes are too frequent';

type PendingSeatMove = {
  playerId: string;
  roomId: string;
  seatIndex: number | null;
};

type UseOptimisticSeatMoveOptions = {
  currentPlayer: RoomState['players'][number] | undefined;
  currentPlayerId: string;
  canChangeSeats: boolean;
  room: RoomState | null;
  setError: (error: string) => void;
  setRoom: (room: RoomState) => void;
};

/** Queue and flush seat changes while displaying the latest local choice. */
export function useOptimisticSeatMove({
  canChangeSeats,
  currentPlayer,
  currentPlayerId,
  room,
  setError,
  setRoom,
}: UseOptimisticSeatMoveOptions) {
  const [optimisticSeatIndex, setOptimisticSeatIndex] = useState<number | null | undefined>(undefined);
  const seatMoveInFlightRef = useRef(false);
  const seatMoveTimeoutRef = useRef<number | null>(null);
  const optimisticSeatTimeoutRef = useRef<number | null>(null);
  const pendingOptimisticSeatIndexRef = useRef<number | null | undefined>(undefined);
  const nextOptimisticSeatUpdateAtRef = useRef(0);
  const pendingSeatMoveRef = useRef<PendingSeatMove | null>(null);
  const seatContextRef = useRef({ roomId: room?.id, playerId: currentPlayerId });
  seatContextRef.current = { roomId: room?.id, playerId: currentPlayerId };

  const displayedRoom = useMemo(() => {
    if (!room || !currentPlayerId || optimisticSeatIndex === undefined) {
      return room;
    }
    return {
      ...room,
      players: room.players.map((player) =>
        player.id === currentPlayerId ? { ...player, seat_index: optimisticSeatIndex } : player,
      ),
    };
  }, [currentPlayerId, optimisticSeatIndex, room]);

  useEffect(() => {
    if (seatMoveTimeoutRef.current !== null) {
      window.clearTimeout(seatMoveTimeoutRef.current);
      seatMoveTimeoutRef.current = null;
    }
    if (optimisticSeatTimeoutRef.current !== null) {
      window.clearTimeout(optimisticSeatTimeoutRef.current);
      optimisticSeatTimeoutRef.current = null;
    }
    pendingOptimisticSeatIndexRef.current = undefined;
    nextOptimisticSeatUpdateAtRef.current = 0;
    pendingSeatMoveRef.current = null;
    setOptimisticSeatIndex(undefined);
  }, [room?.id, currentPlayerId]);

  useEffect(() => {
    return () => {
      if (seatMoveTimeoutRef.current !== null) {
        window.clearTimeout(seatMoveTimeoutRef.current);
      }
      if (optimisticSeatTimeoutRef.current !== null) {
        window.clearTimeout(optimisticSeatTimeoutRef.current);
      }
    };
  }, []);

  /** Update the local seat preview at a capped rate during rapid clicks. */
  function scheduleOptimisticSeatUpdate(seatIndex: number | null) {
    const now = Date.now();
    const remaining = nextOptimisticSeatUpdateAtRef.current - now;
    pendingOptimisticSeatIndexRef.current = seatIndex;
    if (remaining <= 0) {
      if (optimisticSeatTimeoutRef.current !== null) {
        window.clearTimeout(optimisticSeatTimeoutRef.current);
        optimisticSeatTimeoutRef.current = null;
      }
      pendingOptimisticSeatIndexRef.current = undefined;
      nextOptimisticSeatUpdateAtRef.current = now + seatMoveRenderThrottleMs;
      setOptimisticSeatIndex(seatIndex);
      return;
    }
    if (optimisticSeatTimeoutRef.current !== null) {
      return;
    }
    optimisticSeatTimeoutRef.current = window.setTimeout(() => {
      optimisticSeatTimeoutRef.current = null;
      const pendingSeatIndex = pendingOptimisticSeatIndexRef.current;
      pendingOptimisticSeatIndexRef.current = undefined;
      if (pendingSeatIndex !== undefined) {
        nextOptimisticSeatUpdateAtRef.current = Date.now() + seatMoveRenderThrottleMs;
        setOptimisticSeatIndex(pendingSeatIndex);
      }
    }, remaining);
  }

  /** Schedule the latest pending seat move after the rapid-click debounce window. */
  function scheduleSeatMoveFlush() {
    if (seatMoveTimeoutRef.current !== null) {
      window.clearTimeout(seatMoveTimeoutRef.current);
    }
    seatMoveTimeoutRef.current = window.setTimeout(() => {
      seatMoveTimeoutRef.current = null;
      if (!seatMoveInFlightRef.current) {
        void flushSeatMoves();
      }
    }, seatMoveFlushDelayMs);
  }

  /** Persist queued seat moves one at a time and keep only the latest request. */
  async function flushSeatMoves() {
    seatMoveInFlightRef.current = true;
    try {
      while (pendingSeatMoveRef.current) {
        const move = pendingSeatMoveRef.current;
        pendingSeatMoveRef.current = null;
        try {
          const updatedRoom = await updatePlayer(move.roomId, move.playerId, {
            actor_player_id: move.playerId,
            seat_index: move.seatIndex,
          });
          if (seatContextRef.current.roomId === move.roomId && seatContextRef.current.playerId === move.playerId) {
            setRoom(updatedRoom);
          }
        } catch (caught) {
          if (!pendingSeatMoveRef.current) {
            const message = caught instanceof Error ? caught.message : 'Could not change seat';
            setOptimisticSeatIndex(undefined);
            pendingOptimisticSeatIndexRef.current = undefined;
            if (message !== seatRateLimitMessage) {
              setError(message);
            }
          }
        }
      }
      setOptimisticSeatIndex(undefined);
    } finally {
      seatMoveInFlightRef.current = false;
      if (pendingSeatMoveRef.current) {
        scheduleSeatMoveFlush();
      }
    }
  }

  /** Optimistically move to a seat or spectator state if seat changes are allowed. */
  function queueSeatMove(seatIndex: number | null) {
    if (!room || !currentPlayerId || !canChangeSeats || currentPlayer?.is_storyteller) {
      return;
    }
    const currentQueuedSeatIndex = pendingSeatMoveRef.current?.seatIndex ?? pendingOptimisticSeatIndexRef.current ?? optimisticSeatIndex ?? currentPlayer?.seat_index ?? null;
    if (currentQueuedSeatIndex === seatIndex) {
      return;
    }

    // Seat clicks can happen much faster than the API and WebSocket broadcast
    // path. Preview at a capped rate and persist only after a short pause so
    // rapid seat-scrubbing does not flood the browser, server, or other clients.
    setError('');
    pendingSeatMoveRef.current = { roomId: room.id, playerId: currentPlayerId, seatIndex };
    scheduleOptimisticSeatUpdate(seatIndex);
    scheduleSeatMoveFlush();
  }

  return {
    displayedRoom,
    queueSeatMove,
  };
}
