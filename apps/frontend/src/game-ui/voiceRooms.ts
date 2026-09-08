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

/** Return only the two participants visible inside the viewer's storyteller call. */
export function privateStorytellerCallParticipants(
  participants: VoiceParticipant[],
  joinedVoiceRoom: string | null,
  currentPlayerId: string,
  storytellerId: string,
) {
  if (!currentPlayerId || !storytellerId || joinedVoiceRoom !== privateVoiceRoomFor(currentPlayerId, storytellerId)) {
    return [];
  }
  return participants.filter(
    (participant) =>
      participant.voiceRoom === joinedVoiceRoom &&
      (participant.playerId === currentPlayerId || participant.playerId === storytellerId),
  );
}

/** Expose only speakers from the viewer's own permitted room to the night table. */
export function nightVoiceParticipantsForTable(
  participants: VoiceParticipant[],
  joinedVoiceRoom: string | null,
  currentPlayerId: string,
  storytellerId: string,
  allowPublicVoice: boolean,
  publicVoiceRooms: readonly string[],
) {
  if (currentPlayerId && storytellerId && joinedVoiceRoom === privateVoiceRoomFor(currentPlayerId, storytellerId)) {
    return privateStorytellerCallParticipants(participants, joinedVoiceRoom, currentPlayerId, storytellerId);
  }
  return allowPublicVoice && joinedVoiceRoom && publicVoiceRooms.includes(joinedVoiceRoom)
    ? participants.filter((participant) => participant.voiceRoom === joinedVoiceRoom)
    : [];
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
