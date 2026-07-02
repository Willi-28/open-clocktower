import { useEffect, useState } from 'react';
import type { MutableRefObject } from 'react';

import { closeVote, executeNominee, Player, requestNomination, RoomState } from '../../api/client';
import { playTickTone, ringBell } from '../../audio/browserAudio';
import type { openRoomSocket } from '../../websocket/roomSocket';
import {
  countedYesVotesThrough,
  orderedVotePlayers,
  requiredExecutionVotes,
  yesVoteCount,
} from '../voting';

type RoomSocketRef = MutableRefObject<ReturnType<typeof openRoomSocket> | null>;

type UseVotingControlsOptions = {
  currentPlayer: Player | undefined;
  currentPlayerId: string;
  isStoryteller: boolean;
  raisedHandPlayerIds: string[];
  room: RoomState | null;
  roomSocketRef: RoomSocketRef;
  run: (action: () => Promise<RoomState>) => Promise<void>;
  seatedClockwisePlayerList: Player[];
  setError: (message: string) => void;
  setRoom: (room: RoomState) => void;
  setSelectedSeatActionPlayerId: (playerId: string) => void;
};

/**
 * Owns nomination requests, vote counting, executions, hand state, and bell controls.
 */
export function useVotingControls({
  currentPlayer,
  currentPlayerId,
  isStoryteller,
  raisedHandPlayerIds,
  room,
  roomSocketRef,
  run,
  seatedClockwisePlayerList,
  setError,
  setRoom,
  setSelectedSeatActionPlayerId,
}: UseVotingControlsOptions) {
  const [voteCountIndex, setVoteCountIndex] = useState(-1);
  const [isVoteCountRunning, setIsVoteCountRunning] = useState(false);

  const activeNomination = room?.active_nomination;
  const voteCount = yesVoteCount(room);
  const requiredExecutionVoteCount = requiredExecutionVotes(room);
  const activeVoteOrder = orderedVotePlayers(activeNomination, seatedClockwisePlayerList);
  const highlightedVotePlayerId = voteCountIndex >= 0 ? activeVoteOrder[voteCountIndex]?.id : undefined;
  const hasExecutionVotes = voteCount >= requiredExecutionVoteCount;
  const runningVoteCount = countedYesVotesThrough(room, activeVoteOrder, voteCountIndex);
  const voteRaisedHandPlayerIds = activeNomination?.is_open
    ? room?.votes.filter((vote) => vote.value).map((vote) => vote.player_id) ?? []
    : raisedHandPlayerIds;

  useEffect(() => {
    setVoteCountIndex(-1);
    setIsVoteCountRunning(false);
    if (isStoryteller) {
      roomSocketRef.current?.setVoteCount(-1, false);
    }
  }, [room?.active_nomination?.id, isStoryteller]);

  useEffect(() => {
    if (!isStoryteller || !isVoteCountRunning || activeVoteOrder.length === 0) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setVoteCountIndex((current) => {
        if (current >= activeVoteOrder.length - 1) {
          window.clearInterval(intervalId);
          setIsVoteCountRunning(false);
          roomSocketRef.current?.setVoteCount(current, false);
          return current;
        }
        const nextIndex = current + 1;
        roomSocketRef.current?.setVoteCount(nextIndex, true);
        return nextIndex;
      });
    }, 900);
    return () => window.clearInterval(intervalId);
  }, [activeVoteOrder.length, isStoryteller, isVoteCountRunning]);

  useEffect(() => {
    if (voteCountIndex >= 0) {
      playTickTone();
    }
  }, [voteCountIndex]);

  /**
   * Submits a player nomination request for storyteller approval.
   */
  function nominatePlayer(playerId: string) {
    if (!room || !currentPlayer || currentPlayer.is_storyteller) {
      return;
    }
    if (room.phase !== 'day') {
      setError('Nominations can only happen during day.');
      return;
    }
    if (currentPlayer.status !== 'alive') {
      setError('Dead players cannot nominate.');
      return;
    }
    setSelectedSeatActionPlayerId('');
    void run(() => requestNomination(room.id, currentPlayer.id, playerId));
  }

  /**
   * Starts the storyteller's automatic clockwise vote scan.
   */
  function startAutomaticVoteCount() {
    if (activeVoteOrder.length === 0) {
      return;
    }
    setVoteCountIndex(0);
    setIsVoteCountRunning(true);
    roomSocketRef.current?.setVoteCount(0, true);
  }

  /**
   * Clears the current vote scan locally and over the room socket.
   */
  function resetVoteCount() {
    setIsVoteCountRunning(false);
    setVoteCountIndex(-1);
    roomSocketRef.current?.setVoteCount(-1, false);
  }

  /**
   * Closes the current vote without executing the nominee.
   */
  async function cancelVote() {
    if (!room || !isStoryteller) {
      return;
    }
    resetVoteCount();
    await run(() => closeVote(room.id, currentPlayerId));
  }

  /**
   * Executes the current nominee and resets vote-count UI state.
   */
  async function executePlayer(_playerId?: string) {
    if (!room || !isStoryteller) {
      return;
    }
    setError('');
    try {
      setRoom(await executeNominee(room.id, currentPlayerId));
      setSelectedSeatActionPlayerId('');
      setIsVoteCountRunning(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed');
    }
  }

  /**
   * Rings the shared room bell, falling back to a local sound if disconnected.
   */
  function ringRoomBell() {
    const wasSent = roomSocketRef.current?.ringBell() ?? false;
    if (!wasSent) {
      ringBell();
    }
  }

  return {
    activeNomination,
    activeVoteOrder,
    cancelVote,
    executePlayer,
    hasExecutionVotes,
    highlightedVotePlayerId,
    isVoteCountRunning,
    nominatePlayer,
    requiredExecutionVoteCount,
    resetVoteCount,
    ringRoomBell,
    runningVoteCount,
    setIsVoteCountRunning,
    setVoteCountIndex,
    startAutomaticVoteCount,
    voteCount,
    voteCountIndex,
    voteRaisedHandPlayerIds,
  };
}
