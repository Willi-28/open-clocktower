/**
 * Open Clocktower frontend root.
 *
 * App.tsx composes shared room state, realtime sockets, voice/chat hooks,
 * storyteller controls, table rendering, local settings, and confirmation UI.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';

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
import { playDeafenToggleTone, playMuteToggleTone, playTimerAlarm, setSoundEffectsVolume } from './audio/browserAudio';
import { ActiveVoteBar } from './game-ui/components/ActiveVoteBar';
import { ChatPanel } from './game-ui/components/ChatPanel';
import { ChatPopout } from './game-ui/components/ChatPopout';
import { ConfirmActionDialog } from './game-ui/components/ConfirmActionDialog';
import { DemonBluffBar } from './game-ui/components/DemonBluffBar';
import { FloatingCharacterSheet } from './game-ui/components/FloatingCharacterSheet';
import { GameTable } from './game-ui/components/GameTable';
import { GameTopBar } from './game-ui/components/GameTopBar';
import { MobileWorkspaceNav } from './game-ui/components/MobileWorkspaceNav';
import type { MobileWorkspaceView } from './game-ui/components/MobileWorkspaceNav';
import { NominationRequestPopup } from './game-ui/components/NominationRequestPopup';
import { RightControlStack } from './game-ui/components/RightControlStack';
import { SeatActionMenu } from './game-ui/components/SeatActionMenu';
import { SettingsPanelContainer } from './game-ui/components/SettingsPanelContainer';
import { ServerConnectScreen } from './game-ui/components/ServerConnectScreen';
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
import { voiceRoomLabel } from './game-ui/voiceRooms';
import { openRoomSocket } from './websocket/roomSocket';

const defaultVoiceRoom = voiceRooms[0];
const autoDismissErrorMessage = 'dead player has no vote remaining';
const appThemeBackgroundClasses: Record<ClientSettings['appTheme'], string> = {
  classic: 'background-classic',
  dark: '',
  light: '',
  universe: 'background-space',
  magic: 'background-magic',
  island: 'background-island',
  'retro-rpg': 'background-retro-rpg',
};

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
  // The desktop (Steam) build starts on a local shell that only asks for the
  // self-hosted server URL. After connecting, Electron keeps this bundled UI
  // loaded while its gateway routes API/WebSocket traffic to that server.
  const desktopBridge = (window as unknown as {
    desktop?: {
      changeServer: () => Promise<void>;
      connect: (options: { url: string }) => Promise<{ url: string }>;
      close: () => void;
      steamName?: string;
    };
  }).desktop;
  const isDesktop = Boolean(desktopBridge);
  const isShell = isDesktop && new URLSearchParams(window.location.search).has('shell');
  const [serverUrl, setServerUrl] = useState(isShell ? '' : window.location.origin);
  const [isConnectingServer, setIsConnectingServer] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [currentPlayerId, setCurrentPlayerId] = useState<string>('');
  const [characterPackFile, setCharacterPackFile] = useState<File | null>(null);
  const [clientSettings, setClientSettings] = useState<ClientSettings>(loadClientSettings);
  const rememberSelectedAudioInput = useCallback((deviceId: string) => {
    setClientSettings((current) =>
      current.selectedAudioInputId === deviceId ? current : { ...current, selectedAudioInputId: deviceId },
    );
  }, []);
  const rememberSelectedAudioOutput = useCallback((deviceId: string) => {
    setClientSettings((current) =>
      current.selectedAudioOutputId === deviceId ? current : { ...current, selectedAudioOutputId: deviceId },
    );
  }, []);
  const rememberRemoteVolumes = useCallback((remoteVolumes: Record<string, number>) => {
    setClientSettings((current) =>
      current.remoteVolumes === remoteVolumes ? current : { ...current, remoteVolumes },
    );
  }, []);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  // Deafen/undeafen and the mic test restore the mute state the player had
  // before, so a deliberate manual mute is never silently undone.
  const isMutedRef = useRef(false);
  const wasMutedBeforeDeafenRef = useRef(false);
  const wasMutedBeforeMicTestRef = useRef(false);
  const [raisedHandPlayerIds, setRaisedHandPlayerIds] = useState<string[]>([]);
  const [mutedPlayerIds, setMutedPlayerIds] = useState<string[]>([]);
  const [deafenedPlayerIds, setDeafenedPlayerIds] = useState<string[]>([]);
  // Viewport position of the seat the interaction menu should appear beside.
  const [seatMenuAnchor, setSeatMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [isTopBarOpen, setIsTopBarOpen] = useState(true);
  const [isDashboardMinimized, setIsDashboardMinimized] = useState(false);
  const [rightPanelWidth, setRightPanelWidth] = useState<number | null>(null);
  // Which character card the Characters dashboard should scroll to + flash.
  const [characterHighlight, setCharacterHighlight] = useState<{ id: string; nonce: number } | null>(null);
  // Optimistic seat count so the stepper is instant while the server sync is
  // debounced (rapid clicks coalesce into a single request instead of lagging).
  const [optimisticSeatCount, setOptimisticSeatCount] = useState<number | null>(null);
  const seatSyncTimerRef = useRef<number | null>(null);
  // Right-click token picker: table position (x/y %) + viewport anchor.
  const [tokenMenu, setTokenMenu] = useState<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
  // Floating character sheet position (null = docked in the right dashboard).
  const [floatingSheetPos, setFloatingSheetPos] = useState<{ x: number; y: number } | null>(null);
  // Kept across reattach so the next detach restores the last adjusted size.
  const [floatingSheetSize, setFloatingSheetSize] = useState<{ width: number; height: number } | null>(null);
  // Text chat pop-out window, toggled from the voice panel (closed by default).
  const [isChatPopoutOpen, setIsChatPopoutOpen] = useState(false);
  const [isChatPopoutMinimized, setIsChatPopoutMinimized] = useState(false);
  const [chatPopoutPos, setChatPopoutPos] = useState({ x: 24, y: 96 });
  const [chatPopoutSize, setChatPopoutSize] = useState({ width: 360, height: 460 });
  // The first open drops the window just below its toggle icon; later opens keep
  // wherever the user last dragged it.
  const chatPopoutPlacedRef = useRef(false);
  const appShellRef = useRef<HTMLElement | null>(null);
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
  // The table renders the optimistic seat count so the stepper feels instant;
  // the server sync stays debounced (no lag when adding seats quickly).
  const tableRoom = useMemo(() => {
    const base = displayedRoom ?? room;
    if (!base || optimisticSeatCount === null) {
      return base;
    }
    return { ...base, seat_count: optimisticSeatCount };
  }, [displayedRoom, room, optimisticSeatCount]);
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
    initialRemoteVolumes: clientSettings.remoteVolumes,
    isMuted,
    onRemoteVolumesChange: rememberRemoteVolumes,
    onSelectedAudioInputIdChange: rememberSelectedAudioInput,
    onSelectedAudioOutputIdChange: rememberSelectedAudioOutput,
    playerName,
    room,
    roomSocketRef,
    selectedAudioInputId: clientSettings.selectedAudioInputId,
    selectedAudioOutputId: clientSettings.selectedAudioOutputId,
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
      setMutedPlayerIds([]);
      setDeafenedPlayerIds([]);
    },
    room,
    roomId,
    roomName,
    restoreSavedSession: !isShell,
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

  // Envelope flights: everyone sees THAT two players exchanged a private
  // message (never its content); each notice glides an icon between the seats.
  const [chatFlights, setChatFlights] = useState<Array<{ id: string; fromPlayerId: string; toPlayerId: string }>>([]);
  // Per-pair throttle so a new flight can start while an old one is still in the
  // air, but at most once per second (avoids a swarm of envelopes when spammed).
  const chatFlightThrottleRef = useRef<Record<string, number>>({});

  /** Queue one envelope flight and drop it again once its animation is over. */
  function addChatFlight(fromPlayerId: string, toPlayerId: string) {
    const key = `${fromPlayerId}->${toPlayerId}`;
    const now = Date.now();
    if (now - (chatFlightThrottleRef.current[key] ?? 0) < 1000) {
      return;
    }
    chatFlightThrottleRef.current[key] = now;
    const id = crypto.randomUUID();
    setChatFlights((current) => [...current, { id, fromPlayerId, toPlayerId }]);
    window.setTimeout(() => {
      setChatFlights((current) => current.filter((flight) => flight.id !== id));
    }, 1700);
  }

  useRoomSocketEvents({
    addChatFlight,
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
    setMutedPlayerIds,
    setDeafenedPlayerIds,
    setRoom,
    setSelectedPlayerId: tableUi.setSelectedPlayerId,
    setVoteCountIndex: voting.setVoteCountIndex,
    setVoiceParticipants: voiceSession.setVoiceParticipants,
  });

  // Share the current mute state whenever this player (re)joins a voice room so
  // others see the right mic icon from the start, not only after a toggle.
  useEffect(() => {
    if (voiceSession.joinedVoiceRoom) {
      roomSocketRef.current?.setMuted(isMuted);
    }
  }, [voiceSession.joinedVoiceRoom, isMuted]);

  // Drop the optimistic seat count once the server state has caught up.
  useEffect(() => {
    if (optimisticSeatCount !== null && room?.seat_count === optimisticSeatCount && seatSyncTimerRef.current === null) {
      setOptimisticSeatCount(null);
    }
  }, [room?.seat_count, optimisticSeatCount]);

  // Close the open seat menu when clicking anywhere outside it (another seat
  // re-targets it, so seats are excluded from the outside-click check).
  useEffect(() => {
    if (!tableUi.selectedSeatActionPlayerId) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest('.seat-action-menu') && !target.closest('.seat')) {
        tableUi.setSelectedSeatActionPlayerId('');
        setSeatMenuAnchor(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [tableUi.selectedSeatActionPlayerId, tableUi.setSelectedSeatActionPlayerId]);

  // Close the right-click token menu on any outside click or Escape.
  useEffect(() => {
    if (!tokenMenu) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('.token-context-menu')) {
        setTokenMenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTokenMenu(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [tokenMenu]);

  // At night players must not see who is (or is not) in a voice room - that
  // would reveal who is privately calling. Only presence in their own current
  // voice room stays visible; the storyteller keeps full presence.
  const hideNightVoicePresence = Boolean(room && room.phase === 'night' && !isStoryteller);
  const publicVoiceRoomsLocked = Boolean(room && room.phase === 'night' && !isStoryteller && !room.allow_public_voice_during_night);
  const visibleVoiceParticipants = hideNightVoicePresence
    ? voiceSession.voiceParticipants.filter((participant) => participant.voiceRoom === voiceSession.joinedVoiceRoom)
    : voiceSession.voiceParticipants;
  // A private call is not one of the fixed public rooms, so while one is active
  // it is appended to the list. Without a block of its own the call has no
  // occupant rows at all - which is why nobody showed a speaking ring in it.
  const visibleVoiceRooms = useMemo(() => {
    const joined = voiceSession.joinedVoiceRoom;
    return joined && !voiceRooms.includes(joined) ? [...voiceRooms, joined] : voiceRooms;
  }, [voiceSession.joinedVoiceRoom]);
  const seatedPlayerCounter = seatedPlayerCount(room);
  const isPlayerNightView = Boolean(room?.phase === 'night' && currentPlayer && !isStoryteller);
  const showDesktopShellActions = isDesktop && (isShell || !room);
  const showDesktopChangeServerButton = isDesktop && !isShell && !room;
  const appThemeBackgroundClass = appThemeBackgroundClasses[clientSettings.appTheme];
  const appShellClassName = [
    'app-shell',
    room?.phase === 'night' ? 'room-night' : '',
    isPlayerNightView ? 'player-night' : '',
    appThemeBackgroundClass,
    `theme-${clientSettings.appTheme}`,
    `night-effect-${clientSettings.nightEffect}`,
    clientSettings.showTable ? '' : 'table-hidden',
    room ? (isTopBarOpen ? 'topbar-open' : 'topbar-collapsed') : '',
  ].filter(Boolean).join(' ');
  const appPortalTarget = appShellRef.current ?? document.body;
  const tokenMenuViewportWidth = clientSettings.appTheme === 'retro-rpg' ? 380 : 256;
  const tokenMenuViewportHeight = clientSettings.appTheme === 'retro-rpg' ? 480 : 308;

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

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // On normal app pages, auto-join from ?room=&name=. Skipped on the desktop
  // entry shell, where the user picks a server first.
  useEffect(() => {
    if (isShell) {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const linkedRoomId = params.get('room');
    if (!linkedRoomId) {
      return;
    }
    setRoomId(linkedRoomId);
    const linkedName = (params.get('name') ?? '').trim();
    if (linkedName) {
      setDisplayName(linkedName);
    }
    void lifecycle.openOrJoinRoom({ roomId: linkedRoomId, displayName: linkedName || undefined });
  }, []);

  /** Connect the desktop shell to the typed server; the bundled setup screen loads next. */
  async function connectDesktopServer() {
    if (isShell && desktopBridge) {
      setError('');
      setIsConnectingServer(true);
      try {
        await desktopBridge.connect({ url: serverUrl });
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not reach that server.');
        setIsConnectingServer(false);
      }
      return;
    }
  }

  /** Return the desktop client to the server-address entry screen. */
  async function changeDesktopServer() {
    if (!desktopBridge?.changeServer) {
      return;
    }
    setError('');
    setIsConnectingServer(false);
    try {
      await desktopBridge.changeServer();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not return to the server input.');
    }
  }

  /** Join an existing room on the currently loaded server. */
  async function handleJoinRoom() {
    void lifecycle.openOrJoinRoom();
  }

  // The chat counts as "read" only while its pop-out is open and not minimized.
  useEffect(() => {
    chat.setChatVisible(isChatPopoutOpen && !isChatPopoutMinimized);
  }, [chat.setChatVisible, isChatPopoutOpen, isChatPopoutMinimized]);

  /**
   * Toggle the chat pop-out. The very first time it opens, anchor it just below
   * the chat toggle icon (rather than the fixed top-left default) so it appears
   * where the user summoned it; it stays put on later opens.
   */
  function toggleChatPopout() {
    setIsChatPopoutOpen((open) => {
      const next = !open;
      if (next && !chatPopoutPlacedRef.current) {
        chatPopoutPlacedRef.current = true;
        const toggle = appShellRef.current?.querySelector('.chat-toggle');
        if (toggle instanceof HTMLElement) {
          const rect = toggle.getBoundingClientRect();
          const x = Math.max(8, Math.min(window.innerWidth - chatPopoutSize.width - 8, rect.left));
          // Anchor the top just under the icon; keep at least the titlebar
          // on-screen if the icon sits low, but never rise above the icon.
          const y = Math.min(rect.bottom + 10, window.innerHeight - 64);
          setChatPopoutPos({ x, y });
        }
      }
      return next;
    });
  }

  /** Toggle microphone mute state, play feedback, and share it with the room. */
  function toggleMuted() {
    setIsMuted((value) => {
      const nextValue = !value;
      playMuteToggleTone(nextValue);
      roomSocketRef.current?.setMuted(nextValue);
      return nextValue;
    });
  }

  /**
   * Toggle deafen (mute all incoming voice audio, Discord-style). Deafening
   * also mutes the own microphone; undeafening restores the mute state the
   * player had before deafening (a manual mute stays muted).
   */
  function toggleDeafened() {
    setIsDeafened((value) => {
      const nextValue = !value;
      playDeafenToggleTone(nextValue);
      voicePeers.setDeafened(nextValue);
      roomSocketRef.current?.setDeafened(nextValue);
      if (nextValue) {
        wasMutedBeforeDeafenRef.current = isMutedRef.current;
        setMicMuted(true);
      } else if (!wasMutedBeforeDeafenRef.current) {
        setMicMuted(false);
      }
      return nextValue;
    });
  }

  /** Set the microphone mute state directly (used by deafen and the mic test). */
  function setMicMuted(muted: boolean) {
    setIsMuted((current) => {
      if (current === muted) {
        return current;
      }
      roomSocketRef.current?.setMuted(muted);
      return muted;
    });
  }

  /** Mute the live microphone while the settings input test runs; restore after. */
  function handleMicTestActiveChange(isActive: boolean) {
    if (isActive) {
      wasMutedBeforeMicTestRef.current = isMutedRef.current;
      setMicMuted(true);
    } else if (!wasMutedBeforeMicTestRef.current) {
      setMicMuted(false);
    }
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

  /** Open the interaction menu for a player beside the seat that was clicked. */
  function openSeatMenu(playerId: string, clientX: number, clientY: number) {
    setSeatMenuAnchor({ x: clientX, y: clientY });
    tableUi.setSelectedSeatActionPlayerId(playerId);
  }

  /** Apply a seat-count change instantly (optimistic) and debounce the server sync. */
  function requestSeatCount(nextCount: number) {
    if (!room) {
      return;
    }
    const clamped = Math.max(5, Math.min(20, nextCount));
    setOptimisticSeatCount(clamped);
    if (seatSyncTimerRef.current !== null) {
      window.clearTimeout(seatSyncTimerRef.current);
    }
    seatSyncTimerRef.current = window.setTimeout(() => {
      seatSyncTimerRef.current = null;
      void lifecycle.run(() => updateRoom(room.id, currentPlayerId, { seat_count: clamped }));
    }, 280);
  }

  /** Scroll+flash the clicked player's role in the Characters dashboard (if visible). */
  function requestCharacterHighlight(playerId: string) {
    if (!room) {
      return;
    }
    const suspectedCharacterId = annotations.guesses[playerId];
    const canSeeRole =
      isStoryteller ||
      room.show_board ||
      room.shared_grimoire_player_ids.includes(currentPlayerId) ||
      playerId === currentPlayerId;
    const assignment = gameData.assignments.find((entry) => entry.player_id === playerId);
    const characterId = canSeeRole && assignment ? assignment.character_id : suspectedCharacterId;
    if (!characterId) {
      return;
    }
    setCharacterHighlight((previous) => ({ id: characterId, nonce: (previous?.nonce ?? 0) + 1 }));
  }

  /** Position the seat menu beside the clicked seat on desktop; the mobile
   * layout keeps the CSS bottom-sheet placement instead. */
  function seatMenuAnchorStyle(): CSSProperties | undefined {
    if (!seatMenuAnchor || window.innerWidth <= 980) {
      return undefined;
    }
    const menuWidth = 300;
    const menuHeight = 380;
    return {
      position: 'fixed',
      left: Math.min(Math.max(12, seatMenuAnchor.x + 16), window.innerWidth - menuWidth - 12),
      top: Math.min(Math.max(12, seatMenuAnchor.y - 24), window.innerHeight - menuHeight - 12),
      bottom: 'auto',
      transform: 'none',
    };
  }

  /** Let an unseated player (traveler) sit down on a free seat. */
  function trySitDown(seatIndex: number) {
    const maySit = canChangeSeats || currentPlayer?.seat_index === null;
    if (maySit && currentPlayer && !currentPlayer.is_storyteller) {
      seatMove.queueSeatMove(seatIndex);
    }
  }

  /** Click exactly on a seat's character/suspicion token: jump to that card
   * in the character sheet (no menu). */
  function handleSeatSelect(seatIndex: number) {
    if (!room) {
      return;
    }
    const clickedPlayer = seatedPlayers.get(seatIndex);
    if (!clickedPlayer) {
      trySitDown(seatIndex);
      return;
    }
    tableUi.setSelectedPlayerId(clickedPlayer.id);
    requestCharacterHighlight(clickedPlayer.id);
  }

  /** Left-click on the seat body: open the player interaction menu. */
  function handleSeatMenu(seatIndex: number, clientX: number, clientY: number) {
    if (!room) {
      return;
    }
    const clickedPlayer = seatedPlayers.get(seatIndex);
    if (!clickedPlayer) {
      trySitDown(seatIndex);
      return;
    }
    tableUi.setSelectedPlayerId(clickedPlayer.id);
    if (isStoryteller) {
      if (!clickedPlayer.is_storyteller) {
        openSeatMenu(clickedPlayer.id, clientX, clientY);
      }
      return;
    }
    if (clickedPlayer.id === currentPlayerId || clickedPlayer.is_storyteller) {
      return;
    }
    openSeatMenu(clickedPlayer.id, clientX, clientY);
  }

  /** Place reminders on the table surface and clear any open seat menu. */
  function handleTableClick(x: number, y: number) {
    tableUi.setSelectedSeatActionPlayerId('');
    annotations.placeReminder(x, y);
  }

  /** Select the storyteller when another player clicks the storyteller table token. */
  function handleStorytellerClick(clientX: number, clientY: number) {
    if (storyteller && storyteller.id !== currentPlayerId) {
      openSeatMenu(storyteller.id, clientX, clientY);
    }
  }

  /** Store a private suspicion marker for a player and close the seat menu. */
  function placeSuspicionOnPlayer(playerId: string) {
    const suspectedCharacterId = annotations.suspectedCharacterId;
    if (annotations.placeSuspicionOnPlayer(playerId)) {
      setCharacterHighlight((current) => ({ id: suspectedCharacterId, nonce: (current?.nonce ?? 0) + 1 }));
      tableUi.setSelectedSeatActionPlayerId('');
    }
  }

  /** Return current occupants (name + avatar) for one voice room. */
  function publicVoiceOccupants(voiceRoom: string) {
    // At night the panel must not reveal who is where - except for the room this
    // player is in themselves, whose occupants they can already hear anyway.
    if (hideNightVoicePresence && voiceRoom !== voiceSession.joinedVoiceRoom) {
      return [];
    }
    return visibleVoiceParticipants
      .filter((participant) => participant.voiceRoom === voiceRoom)
      .map((participant) => {
        const player = room?.players.find((candidate) => candidate.id === participant.playerId);
        return {
          id: participant.playerId,
          name: playerName(participant.playerId),
          avatarUrl: player?.avatar_url ?? null,
        };
      });
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
    <main className={appShellClassName} ref={appShellRef}>
      {showDesktopShellActions ? (
        <div className="desktop-shell-actions">
          {showDesktopChangeServerButton ? (
            <button
              className="desktop-change-server-button"
              onClick={() => void changeDesktopServer()}
              title="Change Server"
              aria-label="Change Server"
              type="button"
            >
              Change Server
            </button>
          ) : null}
          <button
            className="desktop-leave-game-button"
            onClick={() => desktopBridge?.close()}
            title="Leave Game"
            aria-label="Leave Game"
            type="button"
          >
            Leave Game
          </button>
        </div>
      ) : null}
      {isShell ? (
        <ServerConnectScreen
          isConnecting={isConnectingServer}
          onConnect={() => void connectDesktopServer()}
          onServerUrlChange={setServerUrl}
          serverUrl={serverUrl}
        />
      ) : !room ? (
        <SetupScreen
          characterPackFile={characterPackFile}
          displayName={displayName}
          onCharacterPackFileChange={setCharacterPackFile}
          onCreateRoom={() => void lifecycle.createNewRoom()}
          onDisplayNameChange={setDisplayName}
          onJoinRoom={() => void handleJoinRoom()}
          onRoomIdChange={setRoomId}
          onRoomNameChange={setRoomName}
          roomId={roomId}
          roomName={roomName}
        />
      ) : (
        <>
        <GameTopBar
          currentPlayer={displayedCurrentPlayer}
          isFullscreen={isFullscreen}
          isOpen={isTopBarOpen}
          isStoryteller={isStoryteller}
          onCopyRoomCode={() => void copyRoomCode()}
          onDeleteRoom={confirmDeleteRoom}
          onLeaveLobby={confirmLeaveLobby}
          onLeaveSeat={() => seatMove.queueSeatMove(null)}
          onOpenSettings={() => tableUi.setIsSettingsOpen(true)}
          onToggleFullscreen={() => void toggleFullscreen()}
          onToggleOpen={() => setIsTopBarOpen((open) => !open)}
          phaseLabel={room.show_board ? 'Game ended' : room.phase === 'lobby' ? 'Game not started yet' : phaseLabels[room.phase]}
          room={displayedRoom ?? room}
        />
        <section
          className="workspace"
          data-mobile-view={mobileWorkspaceView}
          style={{
            '--desktop-right-panel': isDashboardMinimized ? '0px' : rightPanelWidth ? `${rightPanelWidth}px` : undefined,
          } as CSSProperties}
        >
          <aside className="edge-panel left-edge">
            <VoiceRoomsPanel
              currentPlayerName={currentPlayer?.display_name ?? displayName ?? 'You'}
              currentPlayerAvatarUrl={currentPlayer?.avatar_url ?? null}
              hasUnreadChat={chat.hasUnreadChat}
              isChatOpen={isChatPopoutOpen}
              isDeafened={isDeafened}
              isMuted={isMuted}
              isStoryteller={isStoryteller}
              isVoiceSwitching={voiceSession.isVoiceSwitching}
              joinedVoiceRoom={voiceSession.joinedVoiceRoom}
              needsVoiceAudioUnlock={voicePeers.needsVoiceAudioUnlock}
              onEnableVoiceAudio={() => void voicePeers.enableVoiceAudio()}
              onJoinVoiceRoom={(voiceRoom) => void voiceSession.joinSelectedVoiceRoom(voiceRoom)}
              onLeaveVoiceRoom={(returnToDefault = true) => voiceSession.leaveVoiceRoom(returnToDefault)}
              mutedPlayerIds={mutedPlayerIds}
              deafenedPlayerIds={deafenedPlayerIds}
              onToggleChat={toggleChatPopout}
              onToggleDeafened={toggleDeafened}
              onToggleMuted={toggleMuted}
              publicVoiceRoomsLocked={publicVoiceRoomsLocked}
              publicVoiceOccupants={publicVoiceOccupants}
              roomPhase={room.phase}
              speakingPlayerIds={voiceActivity.speakingPlayerIds}
              voiceRoomLabel={(voiceRoom) => voiceRoomLabel(voiceRoom, playerName)}
              voiceRooms={visibleVoiceRooms}
            />
          </aside>

          {isChatPopoutOpen ? (
            <ChatPopout
              isMinimized={isChatPopoutMinimized}
              onClose={() => setIsChatPopoutOpen(false)}
              onMove={setChatPopoutPos}
              onResize={setChatPopoutSize}
              onToggleMinimized={() => setIsChatPopoutMinimized((minimized) => !minimized)}
              portalTarget={appPortalTarget}
              position={chatPopoutPos}
              size={chatPopoutSize}
            >
              <ChatPanel
                activeChatTab={chat.activeChatTab}
                attentionChatTabs={chat.attentionChatTabs}
                chatDraft={chat.chatDraft}
                closeChatTab={chat.closeChatTab}
                currentPlayerId={currentPlayerId}
                messages={chat.visibleChatMessages}
                onSendMessage={submitChatMessage}
                openChatTabs={chat.openChatTabs}
                playerAvatarUrl={(id) => room?.players.find((player) => player.id === id)?.avatar_url ?? null}
                playerName={playerName}
                setActiveChatTab={chat.setActiveChatTab}
                setChatDraft={chat.setChatDraft}
              />
            </ChatPopout>
          ) : null}

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
              chatFlights={chatFlights}
              currentPlayerId={currentPlayerId}
              isStoryteller={isStoryteller}
              isReminderMode={Boolean(tableUi.selectedReminderLabel)}
              highlightedPlayerId={voting.highlightedVotePlayerId}
              onSeatSelect={handleSeatSelect}
              onSeatMenu={handleSeatMenu}
              onTableClick={handleTableClick}
              onFieldContextMenu={(x, y, clientX, clientY) => {
                tableUi.setSelectedSeatActionPlayerId('');
                setTokenMenu({ x, y, clientX, clientY });
              }}
              onReminderClick={annotations.removeReminder}
              onReminderRemove={annotations.deleteReminder}
              onReminderMove={annotations.moveReminder}
              onStorytellerClick={handleStorytellerClick}
              mutedPlayerIds={mutedPlayerIds}
              raisedHandPlayerIds={voting.voteRaisedHandPlayerIds}
              reminders={visibleReminders}
              room={tableRoom ?? room}
              seatedPlayers={seatedPlayers}
              guesses={annotations.guesses}
              speakingPlayerIds={voiceActivity.speakingPlayerIds}
              voteCountIndex={voting.voteCountIndex}
              voteCounted={voting.runningVoteCount}
              voteOrderPlayerIds={voting.activeVoteOrder.map((player) => player.id)}
              voteScanTotal={voting.activeVoteOrder.length}
              joinedVoiceRoom={voiceSession.joinedVoiceRoom}
              voiceParticipants={visibleVoiceParticipants}
              showTable={clientSettings.showTable}
              storyteller={storyteller}
            />
            {selectedSeatActionPlayer && currentPlayer ? (
              createPortal(
              <SeatActionMenu
                activeNomination={voting.activeNomination}
                anchorStyle={seatMenuAnchorStyle()}
                characters={gameData.characters}
                chatTargets={chatTargets}
                currentPlayer={currentPlayer}
                hasExecutionVotes={voting.hasExecutionVotes}
                isStoryteller={isStoryteller}
                player={selectedSeatActionPlayer}
                playerVolume={voicePeers.remoteVolumes[selectedSeatActionPlayer.id] ?? 1}
                roomPhase={room.phase}
                suspectedCharacterId={annotations.suspectedCharacterId}
                onClose={() => {
                  tableUi.setSelectedSeatActionPlayerId('');
                  setSeatMenuAnchor(null);
                }}
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
                onSetPlayerVolume={(volume) =>
                  voicePeers.setRemoteVolumes((current) => ({ ...current, [selectedSeatActionPlayer.id]: volume }))
                }
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
              />,
              appPortalTarget,
              )
            ) : null}
            {tokenMenu
              ? createPortal(
                  <div
                    className="token-context-menu"
                    onContextMenu={(event) => event.preventDefault()}
                    style={{
                      position: 'fixed',
                      left: Math.max(12, Math.min(tokenMenu.clientX, window.innerWidth - tokenMenuViewportWidth - 12)),
                      top: Math.max(12, Math.min(tokenMenu.clientY, window.innerHeight - tokenMenuViewportHeight - 12)),
                    }}
                  >
                    <strong>Place reminder</strong>
                    <div className="token-context-grid">
                      {reminderTokenOptions.length === 0 ? (
                        <p className="helper-text">No reminder token PNGs loaded.</p>
                      ) : null}
                      {reminderTokenOptions.map((token) => (
                        <button
                          key={token.id}
                          onClick={() => {
                            annotations.placeReminderToken(token.id, tokenMenu.x, tokenMenu.y);
                            setTokenMenu(null);
                          }}
                          title={token.title}
                          type="button"
                        >
                          <img alt="" src={token.icon} />
                          <small>{token.label}</small>
                        </button>
                      ))}
                    </div>
                  </div>,
                  appPortalTarget,
                )
              : null}
            {isStoryteller ? (
              <DemonBluffBar
                characters={gameData.characters}
                demonBluffIds={gameData.demonBluffIds}
                onSetDemonBluffSlot={gameData.setDemonBluffSlot}
                portalTarget={appPortalTarget}
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
            assignments={gameData.assignments}
            characterHighlight={characterHighlight}
            characterSheetFloating={floatingSheetPos !== null}
            onDetachCharacterSheet={(clientX, clientY) =>
              setFloatingSheetPos({
                x: Math.max(8, Math.min(window.innerWidth - 336, clientX - 160)),
                y: Math.max(8, Math.min(window.innerHeight - 456, clientY - 16)),
              })
            }
            onReattachCharacterSheet={() => setFloatingSheetPos(null)}
            isMinimized={isDashboardMinimized}
            onToggleMinimized={() => setIsDashboardMinimized((value) => !value)}
            onResizeDashboard={setRightPanelWidth}
            characters={gameData.characters}
            currentPlayerId={currentPlayerId}
            displayedSeatCount={optimisticSeatCount ?? room.seat_count}
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
            onAssignCharacter={(playerId, characterId) => void gameData.assignCharacterToPlayer(playerId, characterId)}
            onAssignRandomCharacters={() => void gameData.assignSelectedCharactersRandomly()}
            onCancelVote={() => void voting.cancelVote()}
            onExecutePlayer={(playerId) => void voting.executePlayer(playerId)}
            onKickPlayer={(playerId) => void lifecycle.kickPlayer(playerId)}
            onResetTimer={timer.resetTimer}
            onResetVoteCount={voting.resetVoteCount}
            onRingBell={voting.ringRoomBell}
            onSelectPlayer={tableUi.setSelectedPlayerId}
            onSetDay={() => void lifecycle.run(() => setPhase(room.id, 'day', currentPlayerId))}
            onSetNight={() => void lifecycle.run(() => setPhase(room.id, 'night', currentPlayerId))}
            onSetNightOrderTab={tableUi.setActiveNightOrderTab}
            onSetSeatCount={requestSeatCount}
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
        {floatingSheetPos ? (
          <FloatingCharacterSheet
            characters={gameData.characters}
            highlight={characterHighlight}
            onMove={setFloatingSheetPos}
            onResize={setFloatingSheetSize}
            portalTarget={appPortalTarget}
            onReattach={() => setFloatingSheetPos(null)}
            position={floatingSheetPos}
            seatedPlayerCount={seatedPlayerCounter}
            size={floatingSheetSize}
          />
        ) : null}
        </>
      )}

      {tableUi.isSettingsOpen ? (
        <SettingsPanelContainer
          clientSettings={clientSettings}
          availableCharacterLanguages={availableCharacterLanguages}
          defaultCharacterLanguage={defaultCharacterLanguage}
          currentPlayerId={currentPlayerId}
          isMuted={isMuted}
          onClose={() => tableUi.setIsSettingsOpen(false)}
          onMicTestActiveChange={handleMicTestActiveChange}
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
