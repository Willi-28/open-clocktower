/**
 * Voice room labeling and grouping helpers.
 *
 * Voice state is stored as player/room pairs; these utilities create private
 * room ids, readable labels, and grouped presence rows for the UI.
 */

export type VoiceParticipant = {
  playerId: string;
  voiceRoom: string;
};

export type VoicePresenceRow = {
  id: string;
  label: string;
  players: string;
};

/** Build a stable private voice room id for two players. */
export function privateVoiceRoomFor(currentPlayerId: string, targetPlayerId: string) {
  return [currentPlayerId, targetPlayerId].sort().join(':private:');
}

/** Render a public or private voice room name for display. */
export function voiceRoomLabel(voiceRoom: string, playerName: (playerId: string | undefined) => string) {
  if (!voiceRoom.includes(':private:')) {
    return voiceRoom;
  }
  const names = voiceRoom.split(':private:').map(playerName);
  return `Private Call: ${names.join(' + ')}`;
}

/** Render the storyteller's compact voice room status label. */
export function storytellerVoiceLabel(voiceRoom: string | undefined) {
  if (!voiceRoom) {
    return 'Watching the circle';
  }
  return voiceRoom.includes(':private:') ? 'In a private call' : voiceRoom;
}

/** Return display names for players currently in one public voice room. */
export function publicVoiceOccupantNames(
  participants: VoiceParticipant[],
  voiceRoom: string,
  playerName: (playerId: string | undefined) => string,
) {
  return participants
    .filter((participant) => participant.voiceRoom === voiceRoom)
    .map((participant) => playerName(participant.playerId));
}

/** Group all voice participants into rows for the voice rooms panel. */
export function voicePresenceRows(
  participants: VoiceParticipant[],
  playerName: (playerId: string | undefined) => string,
) {
  const grouped = new Map<string, VoiceParticipant[]>();
  participants.forEach((participant) => {
    grouped.set(participant.voiceRoom, [...(grouped.get(participant.voiceRoom) ?? []), participant]);
  });
  return Array.from(grouped.entries()).map(([voiceRoom, roomParticipants]) => ({
    id: voiceRoom,
    label: voiceRoomLabel(voiceRoom, playerName),
    players: roomParticipants.map((participant) => playerName(participant.playerId)).join(' + '),
  }));
}
