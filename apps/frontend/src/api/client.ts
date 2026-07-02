export type GamePhase = 'lobby' | 'day' | 'night';
export type PlayerStatus = 'alive' | 'dead' | 'absent';

// These types mirror the Pydantic models in the backend.
// This lets TypeScript know which fields the API returns.
export type Player = {
  id: string;
  display_name: string;
  seat_index: number | null;
  status: PlayerStatus;
  has_dead_vote: boolean;
  is_connected: boolean;
  is_storyteller: boolean;
  avatar_url: string | null;
};

export type Nomination = {
  id: string;
  nominator_id: string;
  nominee_id: string;
  is_open: boolean;
  created_at: string;
};

export type NominationRequestState = {
  id: string;
  nominator_id: string;
  nominee_id: string;
  created_at: string;
};

export type Vote = {
  player_id: string;
  value: boolean;
};

export type RoomState = {
  id: string;
  name: string;
  seat_count: number;
  phase: GamePhase;
  day_count: number;
  night_count: number;
  allow_public_voice_during_night: boolean;
  show_board: boolean;
  shared_grimoire_player_ids: string[];
  shared_grimoire_reminders: SharedReminderToken[];
  players: Player[];
  active_nomination: Nomination | null;
  nomination_requests: NominationRequestState[];
  votes: Vote[];
  created_at: string;
  updated_at: string;
};

export type Character = {
  id: string;
  name: string;
  team: string;
  category: string;
  ability: string;
  icon: string | null;
  first_night: number;
  first_night_reminder: string;
  other_night: number;
  other_night_reminder: string;
  translations: Record<string, Record<string, string>>;
  default_language: string;
  available_languages: string[];
};

export type ReminderTokenDefinition = {
  id: string;
  label: string;
  character: string | null;
  icon: string | null;
  translations: Record<string, Record<string, string>>;
  default_language: string;
  available_languages: string[];
};

export type CharacterAssignment = {
  player_id: string;
  character_id: string;
};

export type SharedReminderToken = {
  id: string;
  tokenId?: string | null;
  label: string;
  x: number;
  y: number;
};

export type ClientConfig = {
  iceServers: RTCIceServer[];
};

// Generic helper for all HTTP requests to the backend.
// It throws an Error when FastAPI responds with 4xx/5xx.
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail ?? 'Request failed');
  }

  return response.json();
}

export function getClientConfig() {
  // Runtime browser config, especially WebRTC STUN/TURN servers.
  return request<ClientConfig>('/api/client-config');
}

export function createRoom(name: string, creatorName: string, seatCount: number) {
  return request<RoomState>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ name, creator_name: creatorName, seat_count: seatCount }),
  });
}

export function getRoom(roomId: string) {
  return request<RoomState>(`/api/rooms/${roomId}`);
}

export function updateRoom(
  roomId: string,
  actorPlayerId: string,
  update: {
    seat_count?: number;
    allow_public_voice_during_night?: boolean;
    show_board?: boolean;
    shared_grimoire_player_ids?: string[];
    shared_grimoire_reminders?: SharedReminderToken[];
  },
) {
  return request<RoomState>(`/api/rooms/${roomId}`, {
    method: 'PATCH',
    body: JSON.stringify({ actor_player_id: actorPlayerId, ...update }),
  });
}

export function joinRoom(roomId: string, displayName: string, seatIndex: number | null) {
  return request<RoomState>(`/api/rooms/${roomId}/players`, {
    method: 'POST',
    body: JSON.stringify({ display_name: displayName, seat_index: seatIndex }),
  });
}

export function setStoryteller(roomId: string, actorPlayerId: string, playerId: string) {
  return request<RoomState>(`/api/rooms/${roomId}/storyteller`, {
    method: 'POST',
    body: JSON.stringify({ actor_player_id: actorPlayerId, player_id: playerId }),
  });
}

export function updatePlayer(
  roomId: string,
  playerId: string,
  update: { actor_player_id?: string; seat_index?: number | null; status?: PlayerStatus; has_dead_vote?: boolean },
) {
  return request<RoomState>(`/api/rooms/${roomId}/players/${playerId}`, {
    method: 'PATCH',
    body: JSON.stringify(update),
  });
}

export function leaveRoom(roomId: string, playerId: string, actorPlayerId: string) {
  return request<RoomState>(`/api/rooms/${roomId}/players/${playerId}`, {
    method: 'DELETE',
    body: JSON.stringify({ actor_player_id: actorPlayerId }),
  });
}

export async function uploadProfileImage(roomId: string, playerId: string, actorPlayerId: string, file: File) {
  const formData = new FormData();
  formData.append('actor_player_id', actorPlayerId);
  formData.append('file', file);

  const response = await fetch(`/api/rooms/${roomId}/players/${playerId}/avatar`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail ?? 'Upload failed');
  }
  return response.json() as Promise<RoomState>;
}

export function setPhase(roomId: string, phase: GamePhase, actorPlayerId: string) {
  return request<RoomState>(`/api/rooms/${roomId}/phase`, {
    method: 'POST',
    body: JSON.stringify({ phase, actor_player_id: actorPlayerId }),
  });
}

export function startNomination(roomId: string, actorPlayerId: string, nominatorId: string, nomineeId: string) {
  return request<RoomState>(`/api/rooms/${roomId}/nominations`, {
    method: 'POST',
    body: JSON.stringify({ actor_player_id: actorPlayerId, nominator_id: nominatorId, nominee_id: nomineeId }),
  });
}

export function requestNomination(roomId: string, nominatorId: string, nomineeId: string) {
  return request<RoomState>(`/api/rooms/${roomId}/nomination-requests`, {
    method: 'POST',
    body: JSON.stringify({ nominator_id: nominatorId, nominee_id: nomineeId }),
  });
}

export function rejectNominationRequest(roomId: string, requestId: string, actorPlayerId: string) {
  return request<RoomState>(`/api/rooms/${roomId}/nomination-requests/${requestId}`, {
    method: 'DELETE',
    body: JSON.stringify({ actor_player_id: actorPlayerId }),
  });
}

export function castVote(roomId: string, playerId: string, value: boolean) {
  return request<RoomState>(`/api/rooms/${roomId}/votes`, {
    method: 'POST',
    body: JSON.stringify({ player_id: playerId, value }),
  });
}

export function closeVote(roomId: string, actorPlayerId: string) {
  return request<RoomState>(`/api/rooms/${roomId}/votes/close`, {
    method: 'POST',
    body: JSON.stringify({ actor_player_id: actorPlayerId }),
  });
}

export function executeNominee(roomId: string, actorPlayerId: string) {
  return request<RoomState>(`/api/rooms/${roomId}/executions`, {
    method: 'POST',
    body: JSON.stringify({ actor_player_id: actorPlayerId }),
  });
}

export function resetGame(roomId: string, actorPlayerId: string) {
  return request<RoomState>(`/api/rooms/${roomId}/reset`, {
    method: 'POST',
    body: JSON.stringify({ actor_player_id: actorPlayerId }),
  });
}

export function deleteRoom(roomId: string, actorPlayerId: string) {
  return request<{ status: string }>(`/api/rooms/${roomId}`, {
    method: 'DELETE',
    body: JSON.stringify({ actor_player_id: actorPlayerId }),
  });
}

export async function uploadCharacterPack(roomId: string, actorPlayerId: string, file: File) {
  const formData = new FormData();
  formData.append('actor_player_id', actorPlayerId);
  formData.append('file', file);

  const response = await fetch(`/api/rooms/${roomId}/characters/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail ?? 'Upload failed');
  }
  return response.json() as Promise<{ characters: number; reminder_tokens: number }>;
}

export function listCharacters(roomId: string, language = '') {
  const query = language ? `?language=${encodeURIComponent(language)}` : '';
  return request<Character[]>(`/api/rooms/${roomId}/characters${query}`);
}

export function listReminderTokens(roomId: string, language = '') {
  const query = language ? `?language=${encodeURIComponent(language)}` : '';
  return request<ReminderTokenDefinition[]>(`/api/rooms/${roomId}/reminder-tokens${query}`);
}

export function assignRandomCharacters(roomId: string, actorPlayerId: string, characterIds: string[]) {
  return request<CharacterAssignment[]>(`/api/rooms/${roomId}/character-assignments/random`, {
    method: 'POST',
    body: JSON.stringify({ actor_player_id: actorPlayerId, character_ids: characterIds }),
  });
}

export function listCharacterAssignments(roomId: string, viewerPlayerId: string) {
  return request<CharacterAssignment[]>(`/api/rooms/${roomId}/character-assignments?viewer_player_id=${viewerPlayerId}`);
}

export function listDemonBluffs(roomId: string, viewerPlayerId: string) {
  return request<string[]>(`/api/rooms/${roomId}/demon-bluffs?viewer_player_id=${viewerPlayerId}`);
}

export function setDemonBluffs(roomId: string, actorPlayerId: string, characterIds: string[]) {
  return request<string[]>(`/api/rooms/${roomId}/demon-bluffs`, {
    method: 'POST',
    body: JSON.stringify({ actor_player_id: actorPlayerId, character_ids: characterIds }),
  });
}
