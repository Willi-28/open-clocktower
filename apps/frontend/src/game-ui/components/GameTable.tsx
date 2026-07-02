/**
 * Main circular game table.
 *
 * This component renders seats, reminders, character visibility, voice focus,
 * storyteller position, nominations, and the animated vote-counting hand.
 */

import { useMemo } from 'react';
import type { CSSProperties } from 'react';

import type { Character, CharacterAssignment, Player, RoomState } from '../../api/client';
import { voiceRooms } from '../gameConfig';
import { phaseLabels } from '../gameText';
import { calculateCircularSeats } from '../layout/circularSeats';
import type { ReminderToken } from '../types';

type GameTableProps = {
  assignments: CharacterAssignment[];
  characters: Character[];
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

/** Render the central table and all seat-level interaction targets. */
export function GameTable({
  assignments,
  characters,
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
  const seats = useMemo(() => calculateCircularSeats(room.seat_count, 46.5), [room.seat_count]);
  const seatScale = Math.max(0.58, Math.min(1.08, 1.1 - Math.max(0, room.seat_count - 5) * 0.035));
  const isFocusedVoiceRoom = Boolean(joinedVoiceRoom && joinedVoiceRoom !== voiceRooms[0]);
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
          <strong>{room.players.filter((player) => !player.is_storyteller).length} players</strong>
          {isStoryteller ? <small>Random character setup</small> : null}
          {voteCountIndex >= 0 ? (
            <div className="table-vote-counter">
              <span>{Math.min(voteCountIndex + 1, voteScanTotal)}/{voteScanTotal}</span>
              <strong>{voteCounted}</strong>
              <small>votes</small>
            </div>
          ) : null}
        </div>

        {room.active_nomination ? (
          <div className="nomination-display">
            <span>{room.players.find((player) => player.id === room.active_nomination?.nominator_id)?.display_name}</span>
            <strong>accuses</strong>
            <span>{room.players.find((player) => player.id === room.active_nomination?.nominee_id)?.display_name}</span>
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

        {reminders.filter((reminder) => reminder.icon).map((reminder) => (
          <button
            className="reminder-token image-token"
            draggable
            key={reminder.id}
            onDragStart={(event) => {
              event.stopPropagation();
            }}
            onDragEnd={(event) => {
              event.stopPropagation();
              const table = event.currentTarget.closest('.table-surface');
              if (!(table instanceof HTMLElement)) {
                return;
              }
              const bounds = table.getBoundingClientRect();
              onReminderMove(
                reminder.id,
                Math.min(100, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100)),
                Math.min(100, Math.max(0, ((event.clientY - bounds.top) / bounds.height) * 100)),
              );
            }}
            onClick={(event) => {
              event.stopPropagation();
              onReminderClick(reminder.id);
            }}
            style={{
              left: `${reminder.x}%`,
              top: `${reminder.y}%`,
            }}
            type="button"
          >
            <img alt="" src={reminder.icon ?? ''} />
            <span className="reminder-token-label">{reminder.label}</span>
          </button>
        ))}

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
                left: `${seatPosition.x}%`,
                top: `${seatPosition.y}%`,
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
          const seatPosition = player
            ? voiceFocusPosition(player.id, 50 + seat.x, 50 + seat.y)
            : { x: 50 + seat.x, y: 50 + seat.y };

          return (
            <button
              className={[
                player ? `seat occupied ${player.status}` : 'seat',
                canSeeCharacter ? 'has-character' : '',
                hasRaisedHand ? 'hand-raised' : '',
                isNominator ? 'nominator-seat' : '',
                isNominee ? 'nominee-seat' : '',
                isInFocusedVoiceRoom ? 'voice-focused-seat' : '',
                shouldDimForVoice(player?.id) ? 'voice-unfocused' : '',
                isSpeaking ? 'speaking-seat' : '',
                player?.id === highlightedPlayerId ? 'vote-highlight' : '',
              ].join(' ')}
              key={seat.index}
              onClick={(event) => {
                event.stopPropagation();
                onSeatClick(seat.index);
              }}
              style={{
                left: `${seatPosition.x}%`,
                top: `${seatPosition.y}%`,
                '--seat-scale': isInFocusedVoiceRoom ? voiceFocusSeatScale : seatScale,
              } as CSSProperties}
              type="button"
            >
              {isNominator ? <span className="nomination-role">Accuser</span> : null}
              {isNominee ? <span className="nomination-role accused">Accused</span> : null}
              {hasRaisedHand ? <span className="raised-hand-indicator">Hand</span> : null}
              {player?.status === 'dead' ? (
                <span className={player.has_dead_vote ? 'dead-vote-token available' : 'dead-vote-token spent'}>
                  {player.has_dead_vote ? 'Dead Vote' : 'Spent'}
                </span>
              ) : null}
              {player?.avatar_url ? <img className="seat-avatar" alt="" src={player.avatar_url} /> : null}
              <strong>{player?.display_name ?? 'Open'}</strong>
              {canSeeCharacter && character ? (
                <span className="seat-character-token">
                  {character.icon ? <img alt="" src={character.icon} /> : <span className="character-fallback" />}
                  <small>{character.name}</small>
                </span>
              ) : null}
              {guessedCharacter ? (
                <span className="seat-suspicion-token">
                  {guessedCharacter.icon ? <img alt="" src={guessedCharacter.icon} /> : <span className="character-fallback" />}
                  <small>{guessedCharacter.name}</small>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}
