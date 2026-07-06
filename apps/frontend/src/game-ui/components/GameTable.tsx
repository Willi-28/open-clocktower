/**
 * Main circular game table.
 *
 * This component renders seats, reminders, character visibility, voice focus,
 * storyteller position, nominations, and the animated vote-counting hand.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent } from 'react';

import type { Character, CharacterAssignment, Player, RoomState } from '../../api/client';
import { voiceRooms } from '../gameConfig';
import { phaseLabels } from '../gameText';
import { calculateCircularSeats } from '../layout/circularSeats';
import type { ReminderToken } from '../types';

type GameTableProps = {
  assignments: CharacterAssignment[];
  characters: Character[];
  chatFlights: Array<{ id: string; fromPlayerId: string; toPlayerId: string }>;
  currentPlayerId: string;
  guesses: Record<string, string>;
  highlightedPlayerId?: string;
  isReminderMode: boolean;
  isStoryteller: boolean;
  onReminderClick: (reminderId: string) => void;
  onReminderMove: (reminderId: string, x: number, y: number) => void;
  onSeatClick: (seatIndex: number) => void;
  onStorytellerClick: () => void;
  onTableClick: (x: number, y: number) => void;
  raisedHandPlayerIds: string[];
  reminders: ReminderToken[];
  room: RoomState;
  seatedPlayers: Map<number, Player>;
  speakingPlayerIds: string[];
  voteCountIndex: number;
  voteCounted: number;
  voteOrderPlayerIds: string[];
  voteScanTotal: number;
  joinedVoiceRoom: string | null;
  voiceParticipants: Array<{ playerId: string; voiceRoom: string }>;
  showTable: boolean;
  storyteller?: Player;
  storytellerVoiceLabel?: string;
};

type TableSeatButtonProps = {
  avatarUrl: string | null;
  canSeeCharacter: boolean;
  characterIcon: string | null;
  characterName: string;
  className: string;
  guessedCharacterIcon: string | null;
  guessedCharacterName: string;
  hasDeadVote: boolean;
  hasRaisedHand: boolean;
  isNominee: boolean;
  isNominator: boolean;
  left: number;
  onSeatClick: (seatIndex: number) => void;
  playerName: string;
  playerStatus: Player['status'] | null;
  seatIndex: number;
  seatScale: number;
  top: number;
};

/** Render one seat and avoid re-rendering unchanged seats during rapid moves. */
const TableSeatButton = memo(function TableSeatButton({
  avatarUrl,
  canSeeCharacter,
  characterIcon,
  characterName,
  className,
  guessedCharacterIcon,
  guessedCharacterName,
  hasDeadVote,
  hasRaisedHand,
  isNominee,
  isNominator,
  left,
  onSeatClick,
  playerName,
  playerStatus,
  seatIndex,
  seatScale,
  top,
}: TableSeatButtonProps) {
  const seatStyle = useMemo(
    () =>
      ({
        // Offsets from table centre, consumed by the seat transform (in cqw
        // units) so position changes glide instead of jumping.
        '--seat-x': left - 50,
        '--seat-y': top - 50,
        '--seat-scale': seatScale,
      }) as CSSProperties,
    [left, seatScale, top],
  );
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      onSeatClick(seatIndex);
    },
    [onSeatClick, seatIndex],
  );

  return (
    <button className={className} onClick={handleClick} style={seatStyle} type="button">
      {isNominator ? <span className="nomination-role">Accuser</span> : null}
      {isNominee ? <span className="nomination-role accused">Accused</span> : null}
      {hasRaisedHand ? <span className="raised-hand-indicator">Hand</span> : null}
      {playerStatus === 'dead' ? (
        <span className={hasDeadVote ? 'dead-vote-token available' : 'dead-vote-token spent'}>
          {hasDeadVote ? 'Dead Vote' : 'Spent'}
        </span>
      ) : null}
      {avatarUrl ? <img className="seat-avatar" alt="" src={avatarUrl} /> : null}
      <strong>{playerName}</strong>
      {canSeeCharacter && characterName ? (
        <span className="seat-character-token">
          {characterIcon ? <img alt="" src={characterIcon} /> : <span className="character-fallback" />}
          <small>{characterName}</small>
        </span>
      ) : null}
      {guessedCharacterName ? (
        <span className="seat-suspicion-token">
          {guessedCharacterIcon ? <img alt="" src={guessedCharacterIcon} /> : <span className="character-fallback" />}
          <small>{guessedCharacterName}</small>
        </span>
      ) : null}
    </button>
  );
});

/** Render the central table and all seat-level interaction targets. */
export function GameTable({
  assignments,
  characters,
  chatFlights,
  currentPlayerId,
  guesses,
  highlightedPlayerId,
  isReminderMode,
  isStoryteller,
  onReminderClick,
  onReminderMove,
  onSeatClick,
  onStorytellerClick,
  onTableClick,
  raisedHandPlayerIds,
  reminders,
  room,
  seatedPlayers,
  speakingPlayerIds,
  voteCountIndex,
  voteCounted,
  voteOrderPlayerIds,
  voteScanTotal,
  joinedVoiceRoom,
  voiceParticipants,
  showTable,
  storyteller,
  storytellerVoiceLabel,
}: GameTableProps) {
  const onSeatClickRef = useRef(onSeatClick);
  onSeatClickRef.current = onSeatClick;
  const handleSeatButtonClick = useCallback((seatIndex: number) => {
    onSeatClickRef.current(seatIndex);
  }, []);

  // Reminder tokens are dragged with pointer capture: the token moves by the
  // pointer's delta from where it was grabbed, so it lands exactly where it
  // was dropped (HTML5 drag-and-drop reported unreliable end coordinates and
  // ignored the grab offset).
  const reminderDragRef = useRef<{
    id: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    hasMoved: boolean;
  } | null>(null);
  const suppressReminderClickRef = useRef(false);
  const [reminderDrag, setReminderDrag] = useState<{ id: string; x: number; y: number } | null>(null);

  /** Resolve the dragged token's live table position, or null when not dragging. */
  function draggedReminderPosition(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = reminderDragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return null;
    }
    const table = event.currentTarget.closest('.table-surface');
    if (!(table instanceof HTMLElement)) {
      return null;
    }
    // A small threshold keeps plain clicks from registering as micro-drags.
    if (!drag.hasMoved && Math.abs(event.clientX - drag.startClientX) < 3 && Math.abs(event.clientY - drag.startClientY) < 3) {
      return null;
    }
    drag.hasMoved = true;
    const bounds = table.getBoundingClientRect();
    return {
      id: drag.id,
      x: Math.min(100, Math.max(0, drag.originX + ((event.clientX - drag.startClientX) / bounds.width) * 100)),
      y: Math.min(100, Math.max(0, drag.originY + ((event.clientY - drag.startClientY) / bounds.height) * 100)),
    };
  }
  // Added seats spawn from the top seat slot and glide to their place; removed
  // seats glide back into it before unmounting. `spawnBoundary` pins every seat
  // with index >= boundary to the spawn slot, `lingerCount` keeps removed seats
  // mounted while they animate away.
  const targetSeatCount = room.seat_count;
  const [prevSeatCount, setPrevSeatCount] = useState(targetSeatCount);
  const [spawnBoundary, setSpawnBoundary] = useState(targetSeatCount);
  const [lingerCount, setLingerCount] = useState(targetSeatCount);
  if (targetSeatCount !== prevSeatCount) {
    // Adjust during render so newly added seats paint at the spawn slot first.
    setPrevSeatCount(targetSeatCount);
    setSpawnBoundary(
      targetSeatCount > prevSeatCount ? Math.min(spawnBoundary, prevSeatCount) : targetSeatCount,
    );
  }
  useEffect(() => {
    if (spawnBoundary >= targetSeatCount) {
      return;
    }
    // Release fresh seats one painted frame later so the transition can glide them out.
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => setSpawnBoundary(targetSeatCount));
    });
    return () => cancelAnimationFrame(frame);
  }, [spawnBoundary, targetSeatCount]);
  useEffect(() => {
    if (lingerCount === targetSeatCount) {
      return;
    }
    if (lingerCount < targetSeatCount) {
      setLingerCount(targetSeatCount);
      return;
    }
    const timer = window.setTimeout(() => setLingerCount(targetSeatCount), 240);
    return () => window.clearTimeout(timer);
  }, [lingerCount, targetSeatCount]);
  const renderedSeatCount = Math.max(targetSeatCount, lingerCount);
  const seats = useMemo(() => {
    const layout = calculateCircularSeats(targetSeatCount, 46.5);
    // Seats being removed linger at the spawn slot until their exit finishes.
    for (let index = targetSeatCount; index < renderedSeatCount; index += 1) {
      layout.push({ index, angle: -Math.PI / 2, x: 0, y: -46.5 });
    }
    return layout;
  }, [targetSeatCount, renderedSeatCount]);
  const seatScale = Math.max(0.58, Math.min(1.08, 1.1 - Math.max(0, room.seat_count - 5) * 0.035));
  const isFocusedVoiceRoom = Boolean(joinedVoiceRoom && joinedVoiceRoom !== voiceRooms[0]);
  const playerById = useMemo(() => new Map(room.players.map((player) => [player.id, player])), [room.players]);
  const playerCount = useMemo(() => room.players.filter((player) => !player.is_storyteller).length, [room.players]);
  const characterById = useMemo(
    () => new Map(characters.map((character) => [character.id, character])),
    [characters],
  );
  const assignmentByPlayerId = useMemo(
    () => new Map(assignments.map((assignment) => [assignment.player_id, assignment.character_id])),
    [assignments],
  );
  const raisedHandPlayerIdSet = useMemo(() => new Set(raisedHandPlayerIds), [raisedHandPlayerIds]);
  const speakingPlayerIdSet = useMemo(() => new Set(speakingPlayerIds), [speakingPlayerIds]);
  const voiceFocusPlayerIds = useMemo(
    () =>
      voiceParticipants
        .filter((participant) => isFocusedVoiceRoom && participant.voiceRoom === joinedVoiceRoom)
        .map((participant) => participant.playerId),
    [isFocusedVoiceRoom, joinedVoiceRoom, voiceParticipants],
  );
  const voiceFocusPlayerIdSet = useMemo(() => new Set(voiceFocusPlayerIds), [voiceFocusPlayerIds]);
  const townSquareDimmedPlayerIds = useMemo(
    () =>
      new Set(
        voiceParticipants
          .filter((participant) => joinedVoiceRoom === voiceRooms[0] && participant.voiceRoom !== voiceRooms[0])
          .map((participant) => participant.playerId),
      ),
    [joinedVoiceRoom, voiceParticipants],
  );
  const voiceFocusSeatScale = Math.max(0.6, Math.min(0.8, 0.82 - Math.max(0, voiceFocusPlayerIds.length - 2) * 0.035));

  /** Decide whether a player should be visually dimmed by the current voice focus. */
  function shouldDimForVoice(playerId: string | undefined) {
    if (!playerId) {
      return false;
    }
    if (isFocusedVoiceRoom) {
      return !voiceFocusPlayerIdSet.has(playerId);
    }
    return townSquareDimmedPlayerIds.has(playerId);
  }

  /** Place focused voice participants near the center without losing their fallback seat. */
  function voiceFocusPosition(playerId: string, fallbackX: number, fallbackY: number) {
    const focusIndex = voiceFocusPlayerIds.indexOf(playerId);
    if (focusIndex === -1) {
      return { x: fallbackX, y: fallbackY };
    }
    const count = voiceFocusPlayerIds.length;
    const presetPositions: Record<number, Array<{ x: number; y: number }>> = {
      1: [{ x: 50, y: 50 }],
      2: [{ x: 36, y: 50 }, { x: 64, y: 50 }],
      3: [{ x: 50, y: 34 }, { x: 36, y: 63 }, { x: 64, y: 63 }],
      4: [{ x: 50, y: 32 }, { x: 32, y: 50 }, { x: 68, y: 50 }, { x: 50, y: 68 }],
    };
    const preset = presetPositions[count]?.[focusIndex];
    if (preset) {
      return preset;
    }
    const angle = (Math.PI * 2 * focusIndex) / count - Math.PI / 2;
    const radius = Math.min(27, 16 + count * 1.6);
    return {
      x: 50 + Math.cos(angle) * radius,
      y: 50 + Math.sin(angle) * radius,
    };
  }

  /** Return a seated player's table position (in percent), if they are seated. */
  function seatPositionForPlayer(playerId: string) {
    const seat = seats.find((candidate) => seatedPlayers.get(candidate.index)?.id === playerId);
    return seat ? { x: 50 + seat.x, y: 50 + seat.y } : null;
  }

  const highlightedSeat = seats.find((seat) => seatedPlayers.get(seat.index)?.id === highlightedPlayerId);
  const highlightedSeatPlayer = highlightedSeat ? seatedPlayers.get(highlightedSeat.index) : undefined;
  const firstVoteSeat = seats.find((seat) => seatedPlayers.get(seat.index)?.id === voteOrderPlayerIds[0]);
  const voteHand =
    highlightedSeat && highlightedSeatPlayer && firstVoteSeat
      ? {
          angle: normalizedClockAngle(highlightedSeat.angle, firstVoteSeat.angle),
          length: 42,
        }
      : null;
  const activeNomination = room.active_nomination;
  const nominatorName = activeNomination ? playerById.get(activeNomination.nominator_id)?.display_name : undefined;
  const nomineeName = activeNomination ? playerById.get(activeNomination.nominee_id)?.display_name : undefined;

  /** Keep clock-hand rotation moving clockwise when angles wrap around the circle. */
  function normalizedClockAngle(angle: number, startAngle: number) {
    let nextAngle = angle;
    while (nextAngle < startAngle - 0.001) {
      nextAngle += Math.PI * 2;
    }
    return nextAngle;
  }

  return (
    <section className={`table-stage phase-${room.phase}`}>
      <div
        className={[
          isReminderMode ? 'table-surface placing-reminder' : 'table-surface',
          showTable ? '' : 'table-surface-hidden',
        ].join(' ')}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          onTableClick(
            ((event.clientX - bounds.left) / bounds.width) * 100,
            ((event.clientY - bounds.top) / bounds.height) * 100,
          );
        }}
      >
        <div className="table-center">
          <span>{phaseLabels[room.phase]}</span>
          <strong>{playerCount} players</strong>
          {isStoryteller ? <small>Random character setup</small> : null}
          {voteCountIndex >= 0 ? (
            <div className="table-vote-counter">
              <span>{Math.min(voteCountIndex + 1, voteScanTotal)}/{voteScanTotal}</span>
              <strong>{voteCounted}</strong>
              <small>votes</small>
            </div>
          ) : null}
        </div>

        {activeNomination ? (
          <div className="nomination-display">
            <span>{nominatorName}</span>
            <strong>accuses</strong>
            <span>{nomineeName}</span>
          </div>
        ) : null}

        <span className="table-inlay" aria-hidden="true" />

        {voteHand ? (
          <span
            className="vote-clock-hand"
            aria-hidden="true"
            style={{
              width: `${voteHand.length}%`,
              transform: `rotate(${voteHand.angle}rad)`,
            }}
          />
        ) : null}

        {chatFlights.map((flight) => {
          const from = seatPositionForPlayer(flight.fromPlayerId);
          const to = seatPositionForPlayer(flight.toPlayerId);
          if (!from || !to) {
            return null;
          }
          return (
            <span
              aria-hidden="true"
              className="chat-flight"
              key={flight.id}
              style={{
                '--flight-from-x': from.x - 50,
                '--flight-from-y': from.y - 50,
                '--flight-to-x': to.x - 50,
                '--flight-to-y': to.y - 50,
              } as CSSProperties}
            >
              <svg fill="none" focusable="false" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
                <rect x="2.5" y="5" width="19" height="14" rx="2.8" />
                <path d="m4 6.5 8 6.8 8-6.8" />
              </svg>
            </span>
          );
        })}

        {reminders.filter((reminder) => reminder.icon).map((reminder) => {
          const dragPosition = reminderDrag?.id === reminder.id ? reminderDrag : null;
          return (
            <button
              className={dragPosition ? 'reminder-token image-token reminder-dragging' : 'reminder-token image-token'}
              key={reminder.id}
              onPointerDown={(event) => {
                if (event.button !== 0) {
                  return;
                }
                event.currentTarget.setPointerCapture(event.pointerId);
                reminderDragRef.current = {
                  id: reminder.id,
                  pointerId: event.pointerId,
                  startClientX: event.clientX,
                  startClientY: event.clientY,
                  originX: reminder.x,
                  originY: reminder.y,
                  hasMoved: false,
                };
              }}
              onPointerMove={(event) => {
                const position = draggedReminderPosition(event);
                if (position) {
                  setReminderDrag({ id: position.id, x: position.x, y: position.y });
                }
              }}
              onPointerUp={(event) => {
                const drag = reminderDragRef.current;
                const position = draggedReminderPosition(event);
                reminderDragRef.current = null;
                setReminderDrag(null);
                if (drag && event.pointerId === drag.pointerId) {
                  suppressReminderClickRef.current = drag.hasMoved;
                }
                if (position) {
                  onReminderMove(position.id, position.x, position.y);
                }
              }}
              onPointerCancel={() => {
                reminderDragRef.current = null;
                setReminderDrag(null);
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (suppressReminderClickRef.current) {
                  suppressReminderClickRef.current = false;
                  return;
                }
                onReminderClick(reminder.id);
              }}
              style={{
                left: `${dragPosition ? dragPosition.x : reminder.x}%`,
                top: `${dragPosition ? dragPosition.y : reminder.y}%`,
              }}
              type="button"
            >
              <img alt="" draggable={false} src={reminder.icon ?? ''} />
              <span className="reminder-token-label">{reminder.label}</span>
            </button>
          );
        })}

        {storyteller ? (() => {
          const isInFocusedVoiceRoom = voiceFocusPlayerIdSet.has(storyteller.id);
          const isSpeaking = speakingPlayerIdSet.has(storyteller.id);
          const storytellerHomePosition = room.seat_count >= 12 ? { x: 2, y: 99 } : { x: -8, y: 104 };
          const seatPosition = voiceFocusPosition(
            storyteller.id,
            storytellerHomePosition.x,
            storytellerHomePosition.y,
          );

          return (
            <button
              className={[
                'seat occupied alive storyteller-table-seat',
                isInFocusedVoiceRoom ? 'voice-focused-seat' : '',
                shouldDimForVoice(storyteller.id) ? 'voice-unfocused' : '',
                isSpeaking ? 'speaking-seat' : '',
              ].join(' ')}
              disabled={storyteller.id === currentPlayerId}
              onClick={(event) => {
                event.stopPropagation();
                onStorytellerClick();
              }}
              style={{
                '--seat-x': seatPosition.x - 50,
                '--seat-y': seatPosition.y - 50,
                '--seat-scale': isInFocusedVoiceRoom ? voiceFocusSeatScale : seatScale,
              } as CSSProperties}
              type="button"
            >
              {storyteller.avatar_url ? <img className="seat-avatar" alt="" src={storyteller.avatar_url} /> : null}
              <strong>{storyteller.display_name}</strong>
              <span className="storyteller-role-label">Storyteller</span>
              <small className="storyteller-voice-label">{storytellerVoiceLabel}</small>
            </button>
          );
        })() : null}

        {seats.map((seat) => {
          const player = seatedPlayers.get(seat.index);
          const character = characterById.get(assignmentByPlayerId.get(player?.id ?? '') ?? '');
          const guessedCharacter = characterById.get(guesses[player?.id ?? '']);
          const canSeeCharacter = Boolean(
            character &&
            player &&
            (isStoryteller || room.show_board || room.shared_grimoire_player_ids.includes(currentPlayerId) || player.id === currentPlayerId),
          );
          const hasRaisedHand = Boolean(player && raisedHandPlayerIdSet.has(player.id));
          const isNominator = Boolean(player && player.id === room.active_nomination?.nominator_id);
          const isNominee = Boolean(player && player.id === room.active_nomination?.nominee_id);
          const isInFocusedVoiceRoom = Boolean(player && voiceFocusPlayerIdSet.has(player.id));
          const isSpeaking = Boolean(player && speakingPlayerIdSet.has(player.id));
          // Staged seats (entering or leaving) sit faded in the top seat slot.
          const isStaged = seat.index >= spawnBoundary;
          const seatPosition = isStaged
            ? { x: 50, y: 3.5 }
            : player
              ? voiceFocusPosition(player.id, 50 + seat.x, 50 + seat.y)
              : { x: 50 + seat.x, y: 50 + seat.y };

          return (
            <TableSeatButton
              className={[
                player ? `seat occupied ${player.status}` : 'seat',
                isStaged ? 'seat-staged' : '',
                canSeeCharacter ? 'has-character' : '',
                hasRaisedHand ? 'hand-raised' : '',
                isNominator ? 'nominator-seat' : '',
                isNominee ? 'nominee-seat' : '',
                isInFocusedVoiceRoom ? 'voice-focused-seat' : '',
                shouldDimForVoice(player?.id) ? 'voice-unfocused' : '',
                isSpeaking ? 'speaking-seat' : '',
                player?.id === highlightedPlayerId ? 'vote-highlight' : '',
              ].join(' ')}
              avatarUrl={player?.avatar_url ?? null}
              canSeeCharacter={canSeeCharacter}
              characterIcon={character?.icon ?? null}
              characterName={character?.name ?? ''}
              guessedCharacterIcon={guessedCharacter?.icon ?? null}
              guessedCharacterName={guessedCharacter?.name ?? ''}
              hasDeadVote={Boolean(player?.has_dead_vote)}
              hasRaisedHand={hasRaisedHand}
              isNominee={isNominee}
              isNominator={isNominator}
              key={seat.index}
              left={seatPosition.x}
              onSeatClick={handleSeatButtonClick}
              playerName={player?.display_name ?? 'Open'}
              playerStatus={player?.status ?? null}
              seatIndex={seat.index}
              seatScale={isInFocusedVoiceRoom ? voiceFocusSeatScale : seatScale}
              top={seatPosition.y}
            />
          );
        })}
      </div>
    </section>
  );
}
