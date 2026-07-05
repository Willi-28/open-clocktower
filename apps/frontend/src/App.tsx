/**
 * Open Clocktower frontend root.
 *
 * App.tsx composes shared room state, realtime sockets, voice/chat hooks,
 * storyteller controls, table rendering, local settings, and confirmation UI.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import {
  castVote,
  rejectNominationRequest,
  resetGame,
  RoomState,
  setPhase,
  setStoryteller,
  startNomination,
  updatePlayer,
  updateRoom,
} from './api/client';
import { playMuteToggleTone, playTimerAlarm, setSoundEffectsVolume } from './audio/browserAudio';
import { ActiveVoteBar } from './game-ui/components/ActiveVoteBar';
import { ChatPanel } from './game-ui/components/ChatPanel';
import { ConfirmActionDialog } from './game-ui/components/ConfirmActionDialog';
import { DemonBluffBar } from './game-ui/components/DemonBluffBar';
import { GameTable } from './game-ui/components/GameTable';
import { LobbyInfoPanel } from './game-ui/components/LobbyInfoPanel';
import { MobileWorkspaceNav } from './game-ui/components/MobileWorkspaceNav';
import type { MobileWorkspaceView } from './game-ui/components/MobileWorkspaceNav';
import { NominationRequestPopup } from './game-ui/components/NominationRequestPopup';
import { RightControlStack } from './game-ui/components/RightControlStack';
import { SeatActionMenu } from './game-ui/components/SeatActionMenu';
import { SettingsPanelContainer } from './game-ui/components/SettingsPanelContainer';
import { SetupScreen } from './game-ui/components/SetupScreen';
import { VoiceRoomsPanel } from './game-ui/components/VoiceRoomsPanel';
import { ClientSettings, clientSettingsKey, loadClientSettings } from './game-ui/clientSettings';
import { privateChatTargets } from './game-ui/chatRules';
import { voiceRooms } from './game-ui/gameConfig';
import { phaseLabels } from './game-ui/gameText';
import { useGameData } from './game-ui/hooks/useGameData';
import { useLocalGameAnnotations } from './game-ui/hooks/useLocalGameAnnotations';
import { useOptimisticSeatMove } from './game-ui/hooks/useOptimisticSeatMove';
import { useRoomLifecycle } from './game-ui/hooks/useRoomLifecycle';
import { useRoomSocketEvents } from './game-ui/hooks/useRoomSocketEvents';
import { useTableUiState } from './game-ui/hooks/useTableUiState';
import { useVoiceController } from './game-ui/hooks/useVoiceController';
import { useVotingControls } from './game-ui/hooks/useVotingControls';
import { buildPackNightOrder } from './game-ui/nightOrder';
import { buildReminderTokenOptions, renderReminders } from './game-ui/reminderTokens';
import { formatTimer } from './game-ui/timer';
import { useChatState } from './game-ui/useChatState';
import { useDiscussionTimer } from './game-ui/useDiscussionTimer';
import { seatedPlayersBySeat, playerNameInRoom } from './game-ui/utils/playerHelpers';
import {
  seatedClockwisePlayers,
  seatedPlayerCount,
  voteForPlayer as getVoteForPlayer,
} from './game-ui/voting';
import {
  publicVoiceOccupantNames,
  storytellerVoiceLabel,
  voiceRoomLabel,
} from './game-ui/voiceRooms';
import { openRoomSocket } from './websocket/roomSocket';

const defaultVoiceRoom = voiceRooms[0];
const autoDismissErrorMessage = 'dead player has no vote remaining';

type PendingConfirmation = {
  confirmLabel: string;
  message: string;
  onConfirm: () => void;
  title: string;
  variant?: 'default' | 'danger';
};

/** Compose the full single-page game application. */
export function App() {
  const roomSocketRef = useRef<ReturnType<typeof openRoomSocket> | null>(null);

  const [room, setRoom] = useState<RoomState | null>(null);
  const [roomName, setRoomName] = useState('Clocktower');
  const [roomId, setRoomId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [currentPlayerId, setCurrentPlayerId] = useState<string>('');
  const [characterPackFile, setCharacterPackFile] = useState<File | null>(null);
  const [clientSettings, setClientSettings] = useState<ClientSettings>(loadClientSettings);
  const [isMuted, setIsMuted] = useState(false);
  const [raisedHandPlayerIds, setRaisedHandPlayerIds] = useState<string[]>([]);
  const [error, setError] = useState<string>('');
  const [mobileWorkspaceView, setMobileWorkspaceView] = useState<MobileWorkspaceView>('table');
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const tableUi = useTableUiState();
  const storyteller = room?.players.find((player) => player.is_storyteller);
  const currentPlayer = room?.players.find((player) => player.id === currentPlayerId);
  const isLobby = room?.phase === 'lobby';
  const canChangeSeats = Boolean(isLobby || room?.show_board);
  const isStoryteller = Boolean(currentPlayer?.is_storyteller);
  const seatMove = useOptimisticSeatMove({
    canChangeSeats,
    currentPlayer,
    currentPlayerId,
    room,
    setError,
    setRoom,
  });
  const displayedRoom = seatMove.displayedRoom;
  const displayedCurrentPlayer = displayedRoom?.players.find((player) => player.id === currentPlayerId);
  const selectedPlayer = room?.players.find((player) => player.id === tableUi.selectedPlayerId);
  const selectedSeatActionPlayer = room?.players.find((player) => player.id === tableUi.selectedSeatActionPlayerId);
  const canUseDefaultVoiceRoom = Boolean(
    room && currentPlayer && (room.phase !== 'night' || isStoryteller || room.allow_public_voice_during_night),
  );

  useEffect(() => {
    localStorage.setItem(clientSettingsKey, JSON.stringify(clientSettings));
  }, [clientSettings]);

  useEffect(() => {
    setSoundEffectsVolume(clientSettings.soundVolume);
  }, [clientSettings.soundVolume]);

  useEffect(() => {
    if (error !== autoDismissErrorMessage) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setError((current) => (current === error ? '' : current));
    }, 3200);
    return () => window.clearTimeout(timeoutId);
  }, [error]);

  useEffect(() => {
    /** Keep the dashboard icon in sync with browser fullscreen changes. */
    function handleFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    handleFullscreenChange();
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  /** Resolve a player id into the display name from the latest room snapshot. */
  const playerName = (playerId: string | undefined) => playerNameInRoom(room, playerId);

  const voice = useVoiceController({
    canUseDefaultVoiceRoom,
    currentPlayer,
    currentPlayerId,
    defaultVoiceRoom,
    isMuted,
    playerName,
    room,
    roomSocketRef,
    setError,
    soundFiltersEnabled: clientSettings.soundFiltersEnabled,
    storyteller,
  });
  const voiceActivity = voice.activity;
  const voicePeers = voice.peers;
  const voiceSession = voice.session;

  const lifecycle = useRoomLifecycle({
    characterPackFile,
    currentPlayerId,
    displayName,
    endVoiceSession: voiceSession.endVoiceSession,
    isStoryteller,
    resetRealtimeUi: () => {
      voiceSession.setIncomingVoiceCall(null);
      setRaisedHandPlayerIds([]);
    },
    room,
    roomId,
    roomName,
    setCurrentPlayerId,
    setError,
    setRoom,
    setSelectedPlayerId: tableUi.setSelectedPlayerId,
    setSelectedSeatActionPlayerId: tableUi.setSelectedSeatActionPlayerId,
    setVoiceParticipants: voiceSession.setVoiceParticipants,
  });

  const gameData = useGameData({
    characterLanguage: clientSettings.characterLanguage,
    currentPlayerId,
    isStoryteller,
    room,
    setError,
    setRoom,
  });

  const reminderTokenOptions = useMemo(
    () => buildReminderTokenOptions(gameData.reminderTokenDefinitions),
    [gameData.reminderTokenDefinitions],
  );
  const annotations = useLocalGameAnnotations({
    currentPlayerId,
    reminderTokenOptions,
    room,
    selectedReminderLabel: tableUi.selectedReminderLabel,
    setError,
    setSelectedReminderLabel: tableUi.setSelectedReminderLabel,
  });

  const renderedReminders = useMemo(
    () => renderReminders(annotations.reminders, reminderTokenOptions),
    [annotations.reminders, reminderTokenOptions],
  );
  const sharedGrimoireReminders = useMemo(
    () => annotations.reminders.map(({ id, tokenId, label, x, y }) => ({ id, tokenId, label, x, y })),
    [annotations.reminders],
  );
  const sharedGrimoirePlayerKey = room?.shared_grimoire_player_ids.join('|') ?? '';
  const visibleReminders = useMemo(() => {
    if (isStoryteller || !room?.shared_grimoire_player_ids.includes(currentPlayerId)) {
      return renderedReminders;
    }
    return renderReminders(
      room.shared_grimoire_reminders.map(({ tokenId, ...reminder }) => ({ ...reminder, tokenId: tokenId ?? undefined })),
      reminderTokenOptions,
    );
  }, [currentPlayerId, isStoryteller, reminderTokenOptions, renderedReminders, room?.shared_grimoire_reminders, sharedGrimoirePlayerKey]);
  const packNightOrder = useMemo(() => buildPackNightOrder(gameData.characters), [gameData.characters]);
  const availableCharacterLanguages = useMemo(
    () => Array.from(new Set(gameData.characters.flatMap((character) => character.available_languages))).sort(),
    [gameData.characters],
  );
  const defaultCharacterLanguage = gameData.characters[0]?.default_language ?? 'en';
  const seatedPlayers = useMemo(() => seatedPlayersBySeat(displayedRoom), [displayedRoom]);
  const seatedClockwisePlayerList = useMemo(() => seatedClockwisePlayers(room), [room]);
  const chatTargets = useMemo(() => privateChatTargets(room, currentPlayer, storyteller), [currentPlayer, room, storyteller]);
  const allowedPrivateChatIds = useMemo(() => new Set(chatTargets.map((player) => player.id)), [chatTargets]);
  const allowedPrivateChatKey = useMemo(() => chatTargets.map((player) => player.id).sort().join('|'), [chatTargets]);

  const chat = useChatState({ allowedPrivateChatIds, allowedPrivateChatKey, currentPlayerId, roomId: room?.id ?? '' });
  const timer = useDiscussionTimer({
    isStoryteller,
    onRingBell: () => playTimerAlarm(),
    onSyncTimer: (durationSeconds, remainingSeconds, isRunning) => {
      roomSocketRef.current?.setTimer(durationSeconds, remainingSeconds, isRunning);
    },
  });

  const voting = useVotingControls({
    currentPlayer,
    currentPlayerId,
    isStoryteller,
    raisedHandPlayerIds,
    room,
    roomSocketRef,
    run: lifecycle.run,
    seatedClockwisePlayerList,
    setError,
    setRoom,
    setSelectedSeatActionPlayerId: tableUi.setSelectedSeatActionPlayerId,
  });

  useEffect(() => {
    if (!room || !isStoryteller || room.shared_grimoire_player_ids.length === 0) {
      return;
    }
    void updateRoom(room.id, currentPlayerId, { shared_grimoire_reminders: sharedGrimoireReminders }).catch(() => undefined);
  }, [currentPlayerId, isStoryteller, room?.id, sharedGrimoirePlayerKey, sharedGrimoireReminders]);

  useRoomSocketEvents({
    appendChatMessage: chat.appendChatMessage,
    applyTimerState: timer.applyTimerState,
    applyVoiceParticipants: voiceSession.applyVoiceParticipants,
    currentPlayerId,
    endVoiceSession: voiceSession.endVoiceSession,
    handleVoiceSignal: voicePeers.handleVoiceSignal,
    joinSelectedVoiceRoom: voiceSession.joinSelectedVoiceRoom,
    joinedVoiceRoom: voiceSession.joinedVoiceRoom,
    playerName,
    room,
    roomSocketRef,
    setCurrentPlayerId,
    setError,
    setIncomingVoiceCall: voiceSession.setIncomingVoiceCall,
    setIsVoteCountRunning: voting.setIsVoteCountRunning,
    setRaisedHandPlayerIds,
    setRoom,
    setSelectedPlayerId: tableUi.setSelectedPlayerId,
    setVoteCountIndex: voting.setVoteCountIndex,
    setVoiceParticipants: voiceSession.setVoiceParticipants,
  });

  const storytellerVoiceRoom = voiceSession.voiceParticipants.find((participant) => participant.playerId === storyteller?.id)?.voiceRoom;
  const seatedPlayerCounter = seatedPlayerCount(room);
  const isPlayerNightView = Boolean(room?.phase === 'night' && currentPlayer && !isStoryteller);
  const appShellClassName = [
    'app-shell',
    isPlayerNightView ? 'player-night' : '',
    `background-${clientSettings.appTheme === 'universe' ? 'space' : clientSettings.appTheme === 'magic' ? 'magic' : clientSettings.appTheme === 'island' ? 'island' : 'classic'}`,
    `theme-${clientSettings.appTheme}`,
    `night-effect-${clientSettings.nightEffect}`,
    clientSettings.showTable ? '' : 'table-hidden',
  ].filter(Boolean).join(' ');

  /** Send the current chat draft over the socket or append it locally if offline. */
  function submitChatMessage() {
    const text = chat.chatDraft.trim();
    if (!text || !currentPlayer) {
      return;
    }
    const toPlayerId = chat.activeChatTab === 'public' ? null : chat.activeChatTab;
    if (toPlayerId !== null && !allowedPrivateChatIds.has(toPlayerId)) {
      setError('You can only message neighbors or the storyteller.');
      chat.closeChatTab(toPlayerId);
      return;
    }
    const wasSent = roomSocketRef.current?.sendChat(toPlayerId, text) ?? false;
    if (!wasSent) {
      chat.appendChatMessage({ id: crypto.randomUUID(), fromPlayerId: currentPlayer.id, toPlayerId, text });
    }
    chat.setChatDraft('');
  }

  /** Toggle microphone mute state and play the matching local feedback sound. */
  function toggleMuted() {
    setIsMuted((value) => {
      const nextValue = !value;
      playMuteToggleTone(nextValue);
      return nextValue;
    });
  }

  /** Open a private chat tab after checking current chat permissions. */
  function openPrivateChat(playerId: string) {
    if (!chat.openPrivateChat(playerId)) {
      setError('You can only message neighbors or the storyteller.');
    }
  }

  /** Copy the room code to the clipboard and show a short status message. */
  async function copyRoomCode() {
    if (!room) {
      return;
    }
    try {
      await navigator.clipboard.writeText(room.id);
      setError('Room code copied.');
      window.setTimeout(() => {
        setError((current) => (current === 'Room code copied.' ? '' : current));
      }, 1000);
    } catch {
      setError('Could not copy the room code.');
    }
  }

  /** Enter or leave browser fullscreen from an explicit dashboard button click. */
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      // navigationUI: 'hide' asks for the most immersive fullscreen the browser
      // allows. The browser's own "press Esc to exit" overlay is enforced by the
      // browser for security and cannot be suppressed from a web page.
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      // Fullscreen is a non-critical convenience. If the browser blocks it there
      // is nothing for the player to fix, so fail silently rather than showing a
      // notification banner.
    }
  }

  /** Handle clicks on seats, including open-seat movement and player selection. */
  function handleSeatClick(seatIndex: number) {
    if (!room) {
      return;
    }
    const clickedPlayer = seatedPlayers.get(seatIndex);
    if (!clickedPlayer) {
      tableUi.setSelectedSeatActionPlayerId('');
      if (canChangeSeats && currentPlayer && !currentPlayer.is_storyteller) {
        seatMove.queueSeatMove(seatIndex);
      }
      return;
    }
    tableUi.setSelectedPlayerId(clickedPlayer.id);
    if (isStoryteller) {
      tableUi.setSelectedSeatActionPlayerId(clickedPlayer.is_storyteller ? '' : clickedPlayer.id);
      return;
    }
    if (clickedPlayer.id === currentPlayerId || clickedPlayer.is_storyteller) {
      tableUi.setSelectedSeatActionPlayerId('');
      return;
    }
    tableUi.setSelectedSeatActionPlayerId(clickedPlayer.id);
  }

  /** Place reminders on the table surface and clear any open seat menu. */
  function handleTableClick(x: number, y: number) {
    tableUi.setSelectedSeatActionPlayerId('');
    annotations.placeReminder(x, y);
  }

  /** Select the storyteller when another player clicks the storyteller table token. */
  function handleStorytellerClick() {
    if (storyteller && storyteller.id !== currentPlayerId) {
      tableUi.setSelectedSeatActionPlayerId(storyteller.id);
    }
  }

  /** Store a private suspicion marker for a player and close the seat menu. */
  function placeSuspicionOnPlayer(playerId: string) {
    if (annotations.placeSuspicionOnPlayer(playerId)) {
      tableUi.setSelectedSeatActionPlayerId('');
    }
  }

  /** Return current occupant display names for one public voice room. */
  function publicVoiceOccupants(voiceRoom: string) {
    return publicVoiceOccupantNames(voiceSession.voiceParticipants, voiceRoom, playerName);
  }

  /** Approve a pending nomination request and start that nomination. */
  function startRequestedNomination(nominatorId: string, nomineeId: string) {
    if (!room) {
      return;
    }
    void lifecycle.run(() => startNomination(room.id, currentPlayerId, nominatorId, nomineeId));
  }

  /** Reject one pending nomination request. */
  function rejectRequestedNomination(requestId: string) {
    if (!room) {
      return;
    }
    void lifecycle.run(() => rejectNominationRequest(room.id, requestId, currentPlayerId));
  }

  /** Raise or lower the current player's vote for the active nomination. */
  function toggleCurrentVote() {
    if (!room) {
      return;
    }
    void lifecycle.run(() => castVote(room.id, currentPlayerId, !getVoteForPlayer(room, currentPlayerId)));
  }

  /** Ask for confirmation before revealing all roles to every player. */
  function confirmShowBoard() {
    if (!room) {
      return;
    }
    setPendingConfirmation({
      confirmLabel: 'Show Board',
      message: 'This reveals every character role to all players. Use it only once the game is over.',
      onConfirm: () => {
        setPendingConfirmation(null);
        void lifecycle.run(() => updateRoom(room.id, currentPlayerId, { show_board: true }));
      },
      title: 'Reveal the board?',
    });
  }

  /** Ask for confirmation before deleting the current room. */
  function confirmDeleteRoom() {
    setPendingConfirmation({
      confirmLabel: 'Delete Room',
      message: 'This removes the room for everyone and cannot be undone.',
      onConfirm: () => {
        setPendingConfirmation(null);
        void lifecycle.deleteCurrentRoom();
      },
      title: 'Delete this room?',
      variant: 'danger',
    });
  }

  /** Ask for confirmation before the current player leaves this room. */
  function confirmLeaveLobby() {
    if (!currentPlayer || currentPlayer.is_storyteller) {
      return;
    }
    setPendingConfirmation({
      confirmLabel: 'Leave Lobby',
      message: 'Leave this room and return to the setup screen? Your voice connection will be closed.',
      onConfirm: () => {
        setPendingConfirmation(null);
        void lifecycle.leaveCurrentLobby();
      },
      title: 'Leave lobby?',
    });
  }

  /** Ask for confirmation before removing a player from the room. */
  function confirmKickPlayer(playerToKick: RoomState['players'][number]) {
    setPendingConfirmation({
      confirmLabel: 'Kick Player',
      message: `Remove ${playerToKick.display_name} from this room? They will be disconnected from the current session.`,
      onConfirm: () => {
        setPendingConfirmation(null);
        tableUi.setSelectedSeatActionPlayerId('');
        void lifecycle.kickPlayer(playerToKick.id);
      },
      title: 'Kick this player?',
      variant: 'danger',
    });
  }

  /** Persist whether one player can see the shared grimoire view. */
  function setSharedGrimoirePlayer(playerId: string, isShared: boolean) {
    if (!room) {
      return;
    }
    const nextPlayerIds = isShared
      ? [...room.shared_grimoire_player_ids.filter((id) => id !== playerId), playerId]
      : room.shared_grimoire_player_ids.filter((id) => id !== playerId);
    void lifecycle.run(() =>
      updateRoom(room.id, currentPlayerId, {
        shared_grimoire_player_ids: nextPlayerIds,
        shared_grimoire_reminders: nextPlayerIds.length > 0 ? sharedGrimoireReminders : [],
      }),
    );
  }

  /** Toggle grimoire sharing, confirming before hidden information is exposed. */
  function selectSharedGrimoirePlayer(playerId: string, isShared: boolean) {
    if (isShared) {
      setSharedGrimoirePlayer(playerId, false);
      return;
    }
    setPendingConfirmation({
      confirmLabel: 'Share Grimoire',
      message: `Share roles and storyteller reminder tokens with ${playerName(playerId)}? This exposes hidden information during the game.`,
      onConfirm: () => {
        setPendingConfirmation(null);
        setSharedGrimoirePlayer(playerId, true);
      },
      title: 'Share grimoire view?',
    });
  }

  /** Start a match, resetting post-game state first when the board had been shown. */
  function startGame() {
    if (!room) {
      return;
    }
    void lifecycle.run(async () => {
      if (room.show_board) {
        await resetGame(room.id, currentPlayerId);
      }
      return setPhase(room.id, 'day', currentPlayerId);
    });
  }

  return (
    <main className={appShellClassName}>
      {!room ? (
        <SetupScreen
          characterPackFile={characterPackFile}
          displayName={displayName}
          onCharacterPackFileChange={setCharacterPackFile}
          onCreateRoom={() => void lifecycle.createNewRoom()}
          onDisplayNameChange={setDisplayName}
          onJoinRoom={() => void lifecycle.openOrJoinRoom()}
          onRoomIdChange={setRoomId}
          onRoomNameChange={setRoomName}
          roomId={roomId}
          roomName={roomName}
        />
      ) : (
        <section className="workspace" data-mobile-view={mobileWorkspaceView}>
          <aside className="edge-panel left-edge">
            <LobbyInfoPanel
              currentPlayer={displayedCurrentPlayer}
              canChangeSeats={canChangeSeats}
              isFullscreen={isFullscreen}
              isMuted={isMuted}
              isStoryteller={isStoryteller}
              joinedVoiceRoom={voiceSession.joinedVoiceRoom}
              onCopyRoomCode={() => void copyRoomCode()}
              onLeaveLobby={confirmLeaveLobby}
              onLeaveSeat={() => seatMove.queueSeatMove(null)}
              onOpenSettings={() => tableUi.setIsSettingsOpen(true)}
              onToggleFullscreen={() => void toggleFullscreen()}
              onToggleMuted={toggleMuted}
              phaseLabel={room.show_board ? 'Game ended' : room.phase === 'lobby' ? 'Game not started yet' : phaseLabels[room.phase]}
              room={displayedRoom ?? room}
            />

            <ChatPanel
              activeChatTab={chat.activeChatTab}
              attentionChatTabs={chat.attentionChatTabs}
              chatDraft={chat.chatDraft}
              closeChatTab={chat.closeChatTab}
              currentPlayerId={currentPlayerId}
              messages={chat.visibleChatMessages}
              onSendMessage={submitChatMessage}
              openChatTabs={chat.openChatTabs}
              playerName={playerName}
              setActiveChatTab={chat.setActiveChatTab}
              setChatDraft={chat.setChatDraft}
            />

            <VoiceRoomsPanel
              isStoryteller={isStoryteller}
              isVoiceSwitching={voiceSession.isVoiceSwitching}
              joinedVoiceRoom={voiceSession.joinedVoiceRoom}
              needsVoiceAudioUnlock={voicePeers.needsVoiceAudioUnlock}
              onEnableVoiceAudio={() => void voicePeers.enableVoiceAudio()}
              onJoinVoiceRoom={(voiceRoom) => void voiceSession.joinSelectedVoiceRoom(voiceRoom)}
              onLeaveVoiceRoom={() => voiceSession.leaveVoiceRoom(true)}
              publicVoiceOccupants={publicVoiceOccupants}
              publicVoiceDuringNight={room.allow_public_voice_during_night}
              roomPhase={room.phase}
              voiceRoomLabel={(voiceRoom) => voiceRoomLabel(voiceRoom, playerName)}
              voiceRooms={voiceRooms}
            />
          </aside>

          <div className="table-wrap" style={{ '--table-zoom': tableUi.tableZoom } as CSSProperties}>
            <div className={timer.timerRemaining <= 10 && timer.isTimerRunning ? 'table-timer urgent' : 'table-timer'}>
              <span>Discussion</span>
              <strong>{formatTimer(timer.timerRemaining)}</strong>
            </div>
            {timer.showTimerDone ? <div className="timer-done-toast">Time is up</div> : null}
            {voiceSession.incomingVoiceCall ? (
              <div className="incoming-call-toast">
                <div>
                  <strong>{playerName(voiceSession.incomingVoiceCall.fromPlayerId)}</strong>
                  <span>Private voice call</span>
                </div>
                <button onClick={() => void voiceSession.acceptPrivateCall()} type="button">
                  Accept
                </button>
                <button className="secondary" onClick={voiceSession.rejectPrivateCall} type="button">
                  Decline
                </button>
              </div>
            ) : null}
            {isStoryteller ? (
              <NominationRequestPopup
                nominationRequests={room.nomination_requests}
                onReject={rejectRequestedNomination}
                onStartNomination={startRequestedNomination}
                playerName={playerName}
              />
            ) : null}
            <GameTable
              assignments={gameData.assignments}
              characters={gameData.characters}
              currentPlayerId={currentPlayerId}
              isStoryteller={isStoryteller}
              isReminderMode={Boolean(tableUi.selectedReminderLabel)}
              highlightedPlayerId={voting.highlightedVotePlayerId}
              onSeatClick={handleSeatClick}
              onTableClick={handleTableClick}
              onReminderClick={annotations.removeReminder}
              onReminderMove={annotations.moveReminder}
              onStorytellerClick={handleStorytellerClick}
              raisedHandPlayerIds={voting.voteRaisedHandPlayerIds}
              reminders={visibleReminders}
              room={displayedRoom ?? room}
              seatedPlayers={seatedPlayers}
              guesses={annotations.guesses}
              speakingPlayerIds={voiceActivity.speakingPlayerIds}
              voteCountIndex={voting.voteCountIndex}
              voteCounted={voting.runningVoteCount}
              voteOrderPlayerIds={voting.activeVoteOrder.map((player) => player.id)}
              voteScanTotal={voting.activeVoteOrder.length}
              joinedVoiceRoom={voiceSession.joinedVoiceRoom}
              voiceParticipants={voiceSession.voiceParticipants}
              showTable={clientSettings.showTable}
              storyteller={storyteller}
              storytellerVoiceLabel={storytellerVoiceLabel(storytellerVoiceRoom)}
            />
            {selectedSeatActionPlayer && currentPlayer ? (
              <SeatActionMenu
                activeNomination={voting.activeNomination}
                characters={gameData.characters}
                chatTargets={chatTargets}
                currentPlayer={currentPlayer}
                hasExecutionVotes={voting.hasExecutionVotes}
                isStoryteller={isStoryteller}
                player={selectedSeatActionPlayer}
                roomPhase={room.phase}
                suspectedCharacterId={annotations.suspectedCharacterId}
                onClose={() => tableUi.setSelectedSeatActionPlayerId('')}
                onExecute={(playerId) => void voting.executePlayer(playerId)}
                onRequestKick={confirmKickPlayer}
                onMarkAlive={(playerId) =>
                  void lifecycle.run(() => updatePlayer(room.id, playerId, { actor_player_id: currentPlayerId, status: 'alive' }))
                }
                onMarkDead={(playerId) =>
                  void lifecycle.run(() => updatePlayer(room.id, playerId, { actor_player_id: currentPlayerId, status: 'dead' }))
                }
                onNominate={voting.nominatePlayer}
                onOpenChat={(playerId) => {
                  openPrivateChat(playerId);
                  tableUi.setSelectedSeatActionPlayerId('');
                }}
                onPlaceSuspicion={placeSuspicionOnPlayer}
                onStartPrivateCall={(playerId) => {
                  tableUi.setSelectedSeatActionPlayerId('');
                  void voiceSession.startPrivateCall(playerId);
                }}
                onSuspectedCharacterChange={annotations.setSuspectedCharacterId}
                onToggleDeadVote={(player) =>
                  void lifecycle.run(() =>
                    updatePlayer(room.id, player.id, {
                      actor_player_id: currentPlayerId,
                      has_dead_vote: !player.has_dead_vote,
                    }),
                  )
                }
              />
            ) : null}
            {isStoryteller ? (
              <DemonBluffBar
                characters={gameData.characters}
                demonBluffIds={gameData.demonBluffIds}
                onSelectSlot={tableUi.setSelectedBluffSlot}
                onSetDemonBluffSlot={gameData.setDemonBluffSlot}
                selectedBluffSlot={tableUi.selectedBluffSlot}
              />
            ) : null}
            {voting.activeNomination && currentPlayer && currentPlayer.seat_index !== null && !isStoryteller ? (
              <ActiveVoteBar
                activeNomination={voting.activeNomination}
                isVoteRaised={Boolean(getVoteForPlayer(room, currentPlayerId))}
                onToggleVote={toggleCurrentVote}
                playerName={playerName}
              />
            ) : null}
          </div>

          <RightControlStack
            activeNightOrderTab={tableUi.activeNightOrderTab}
            activeNomination={voting.activeNomination}
            activeVoteOrderLength={voting.activeVoteOrder.length}
            characters={gameData.characters}
            currentPlayerId={currentPlayerId}
            hasExecutionVotes={voting.hasExecutionVotes}
            isLobby={Boolean(isLobby)}
            isStoryteller={isStoryteller}
            isTimerRunning={timer.isTimerRunning}
            isVoteCountRunning={voting.isVoteCountRunning}
            packNightOrder={packNightOrder}
            randomCharacterIds={gameData.randomCharacterIds}
            reminderTokenOptions={reminderTokenOptions}
            requiredExecutionVotes={voting.requiredExecutionVoteCount}
            room={room}
            runningVoteCount={voting.runningVoteCount}
            seatedPlayerCount={seatedPlayerCounter}
            selectedPlayer={selectedPlayer}
            selectedPlayerId={tableUi.selectedPlayerId}
            selectedReminderLabel={tableUi.selectedReminderLabel}
            timerRemaining={timer.timerRemaining}
            voteCount={voting.voteCount}
            voteCountIndex={voting.voteCountIndex}
            onAssignRandomCharacters={() => void gameData.assignSelectedCharactersRandomly()}
            onCancelVote={() => void voting.cancelVote()}
            onDeleteRoom={confirmDeleteRoom}
            onExecutePlayer={(playerId) => void voting.executePlayer(playerId)}
            onKickPlayer={(playerId) => void lifecycle.kickPlayer(playerId)}
            onResetTimer={timer.resetTimer}
            onResetVoteCount={voting.resetVoteCount}
            onRingBell={voting.ringRoomBell}
            onSelectPlayer={tableUi.setSelectedPlayerId}
            onSetDay={() => void lifecycle.run(() => setPhase(room.id, 'day', currentPlayerId))}
            onSetNight={() => void lifecycle.run(() => setPhase(room.id, 'night', currentPlayerId))}
            onSetNightOrderTab={tableUi.setActiveNightOrderTab}
            onSetSeatCount={(seatCount) => void lifecycle.run(() => updateRoom(room.id, currentPlayerId, { seat_count: seatCount }))}
            onShowBoard={confirmShowBoard}
            onTogglePublicVoiceDuringNight={(isAllowed) =>
              void lifecycle.run(() => updateRoom(room.id, currentPlayerId, { allow_public_voice_during_night: isAllowed }))
            }
            onStartGame={startGame}
            onStartVoteCount={voting.startAutomaticVoteCount}
            onSelectSharedGrimoirePlayer={selectSharedGrimoirePlayer}
            onToggleRandomCharacter={gameData.toggleRandomCharacter}
            onToggleReminderToken={(tokenId) => tableUi.setSelectedReminderLabel(tableUi.selectedReminderLabel === tokenId ? '' : tokenId)}
            onToggleTimer={timer.toggleTimer}
            onTransferStoryteller={(playerId) => void lifecycle.run(() => setStoryteller(room.id, currentPlayerId, playerId))}
          />

          <MobileWorkspaceNav activeView={mobileWorkspaceView} onSelectView={setMobileWorkspaceView} />
        </section>
      )}

      {tableUi.isSettingsOpen ? (
        <SettingsPanelContainer
          clientSettings={clientSettings}
          availableCharacterLanguages={availableCharacterLanguages}
          defaultCharacterLanguage={defaultCharacterLanguage}
          currentPlayerId={currentPlayerId}
          isMuted={isMuted}
          onClose={() => tableUi.setIsSettingsOpen(false)}
          onToggleMuted={toggleMuted}
          onUpdateClientSettings={setClientSettings}
          playerName={playerName}
          room={room}
          setRoom={setRoom}
          voice={voice}
        />
      ) : null}

      {pendingConfirmation ? (
        <ConfirmActionDialog
          confirmLabel={pendingConfirmation.confirmLabel}
          message={pendingConfirmation.message}
          onCancel={() => setPendingConfirmation(null)}
          onConfirm={pendingConfirmation.onConfirm}
          title={pendingConfirmation.title}
          variant={pendingConfirmation.variant}
        />
      ) : null}

      {error ? <p className="error-banner">{error}</p> : null}
    </main>
  );
}
