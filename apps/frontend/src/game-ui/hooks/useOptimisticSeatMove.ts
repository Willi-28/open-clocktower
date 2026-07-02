import { useEffect, useMemo, useRef, useState } from 'react';

import { RoomState, updatePlayer } from '../../api/client';

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
    pendingSeatMoveRef.current = null;
    setOptimisticSeatIndex(undefined);
  }, [room?.id, currentPlayerId]);

  useEffect(() => {
    return () => {
      if (seatMoveTimeoutRef.current !== null) {
        window.clearTimeout(seatMoveTimeoutRef.current);
      }
    };
  }, []);

  function scheduleSeatMoveFlush() {
    if (seatMoveTimeoutRef.current !== null) {
      window.clearTimeout(seatMoveTimeoutRef.current);
    }
    seatMoveTimeoutRef.current = window.setTimeout(() => {
      seatMoveTimeoutRef.current = null;
      if (!seatMoveInFlightRef.current) {
        void flushSeatMoves();
      }
    }, 450);
  }

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
            setOptimisticSeatIndex(undefined);
            setError(caught instanceof Error ? caught.message : 'Could not change seat');
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

  function queueSeatMove(seatIndex: number | null) {
    if (!room || !currentPlayerId || !canChangeSeats || currentPlayer?.is_storyteller) {
      return;
    }
    if ((optimisticSeatIndex ?? currentPlayer?.seat_index ?? null) === seatIndex) {
      return;
    }

    // Seat clicks can happen much faster than the API and WebSocket broadcast
    // path. Show the latest choice immediately, but persist only after a short
    // pause so rapid seat-scrubbing does not flood the server or connected browsers.
    setError('');
    setOptimisticSeatIndex(seatIndex);
    pendingSeatMoveRef.current = { roomId: room.id, playerId: currentPlayerId, seatIndex };
    scheduleSeatMoveFlush();
  }

  return {
    displayedRoom,
    queueSeatMove,
  };
}
