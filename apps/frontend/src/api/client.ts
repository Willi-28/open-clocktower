/**
 * Browser-side HTTP API client.
 *
 * The types mirror the backend Pydantic models, and the exported helpers keep
 * fetch details out of React components and hooks.
 */

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

/** Room snapshot plus the private per-player credentials returned at create/join. */
export type PlayerSession = {
  room: RoomState;
  player_id: string;
  player_secret: string;
};

// The browser only ever holds one active player identity at a time. The secret
// is kept here and attached to every request, so individual call sites never
// have to thread it through. It is set at create/join and on session restore.
let activePlayerSecret: string | null = null;

/** Set (or clear) the bearer secret attached to authenticated requests. */
export function setActivePlayerSecret(secret: string | null) {
  activePlayerSecret = secret;
}

/** Return the active bearer secret, used by the WebSocket client for its handshake. */
export function getActivePlayerSecret(): string | null {
  return activePlayerSecret;
}

/** Send a JSON request to the backend and raise readable errors for failed responses. */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (activePlayerSecret) {
    headers['X-Player-Secret'] = activePlayerSecret;
  }
  const response = await fetch(path, { ...options, headers });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail ?? 'Request failed');
  }

  return response.json();
}

/** Build the auth header for multipart uploads, which bypass the JSON request helper. */
function uploadHeaders(): Record<string, string> {
  return activePlayerSecret ? { 'X-Player-Secret': activePlayerSecret } : {};
}

/** Load runtime browser config such as WebRTC ICE servers. */
export function getClientConfig() {
  return request<ClientConfig>('/api/client-config');
}

/** Create a room and make the creator the first storyteller. */
export function createRoom(name: string, creatorName: string, seatCount: number) {
  return request<PlayerSession>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ name, creator_name: creatorName, seat_count: seatCount }),
  });
}

/** Fetch the latest room snapshot. */
export function getRoom(roomId: string) {
  return request<RoomState>(`/api/rooms/${roomId}`);
}

/** Update storyteller-owned room settings. */
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

/** Join an existing room as player or spectator. */
export function joinRoom(roomId: string, displayName: string, seatIndex: number | null) {
  return request<PlayerSession>(`/api/rooms/${roomId}/players`, {
    method: 'POST',
    body: JSON.stringify({ display_name: displayName, seat_index: seatIndex }),
  });
}

/** Transfer storyteller rights to another player when the backend allows it. */
export function setStoryteller(roomId: string, actorPlayerId: string, playerId: string) {
  return request<RoomState>(`/api/rooms/${roomId}/storyteller`, {
    method: 'POST',
    body: JSON.stringify({ actor_player_id: actorPlayerId, player_id: playerId }),
  });
}

/** Update one player's seat, public status, or dead-vote state. */
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

/** Leave a room or remove another player as storyteller. */
export function leaveRoom(roomId: string, playerId: string, actorPlayerId: string) {
  return request<RoomState>(`/api/rooms/${roomId}/players/${playerId}`, {
    method: 'DELETE',
    body: JSON.stringify({ actor_player_id: actorPlayerId }),
  });
}

/** Upload and store one player's profile image. */
export async function uploadProfileImage(roomId: string, playerId: string, actorPlayerId: string, file: File) {
  const formData = new FormData();
  formData.append('actor_player_id', actorPlayerId);
  formData.append('file', file);

  const response = await fetch(`/api/rooms/${roomId}/players/${playerId}/avatar`, {
    method: 'POST',
    body: formData,
    headers: uploadHeaders(),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail ?? 'Upload failed');
  }
  return response.json() as Promise<RoomState>;
}

/** Change the current phase to lobby, day, or night. */
export function setPhase(roomId: string, phase: GamePhase, actorPlayerId: string) {
  return request<RoomState>(`/api/rooms/${roomId}/phase`, {
    method: 'POST',
    body: JSON.stringify({ phase, actor_player_id: actorPlayerId }),
  });
}

/** Start a storyteller-approved nomination. */
export function startNomination(roomId: string, actorPlayerId: string, nominatorId: string, nomineeId: string) {
  return request<RoomState>(`/api/rooms/${roomId}/nominations`, {
    method: 'POST',
    body: JSON.stringify({ actor_player_id: actorPlayerId, nominator_id: nominatorId, nominee_id: nomineeId }),
  });
}

/** Request a nomination from a normal player. */
export function requestNomination(roomId: string, nominatorId: string, nomineeId: string) {
  return request<RoomState>(`/api/rooms/${roomId}/nomination-requests`, {
    method: 'POST',
    body: JSON.stringify({ nominator_id: nominatorId, nominee_id: nomineeId }),
  });
}

/** Reject a pending player nomination request. */
export function rejectNominationRequest(roomId: string, requestId: string, actorPlayerId: string) {
  return request<RoomState>(`/api/rooms/${roomId}/nomination-requests/${requestId}`, {
    method: 'DELETE',
    body: JSON.stringify({ actor_player_id: actorPlayerId }),
  });
}

/** Cast or replace a vote for the current nomination. */
export function castVote(roomId: string, playerId: string, value: boolean) {
  return request<RoomState>(`/api/rooms/${roomId}/votes`, {
    method: 'POST',
    body: JSON.stringify({ player_id: playerId, value }),
  });
}

/** Close the active vote without executing anyone. */
export function closeVote(roomId: string, actorPlayerId: string) {
  return request<RoomState>(`/api/rooms/${roomId}/votes/close`, {
    method: 'POST',
    body: JSON.stringify({ actor_player_id: actorPlayerId }),
  });
}

/** Execute the active nominee after backend vote validation. */
export function executeNominee(roomId: string, actorPlayerId: string) {
  return request<RoomState>(`/api/rooms/${roomId}/executions`, {
    method: 'POST',
    body: JSON.stringify({ actor_player_id: actorPlayerId }),
  });
}

/** Reset match state while keeping the room available. */
export function resetGame(roomId: string, actorPlayerId: string) {
  return request<RoomState>(`/api/rooms/${roomId}/reset`, {
    method: 'POST',
    body: JSON.stringify({ actor_player_id: actorPlayerId }),
  });
}

/** Delete a room after storyteller authorization. */
export function deleteRoom(roomId: string, actorPlayerId: string) {
  return request<{ status: string }>(`/api/rooms/${roomId}`, {
    method: 'DELETE',
    body: JSON.stringify({ actor_player_id: actorPlayerId }),
  });
}

/** Upload and parse a room-local character pack ZIP. */
export async function uploadCharacterPack(roomId: string, actorPlayerId: string, file: File) {
  const formData = new FormData();
  formData.append('actor_player_id', actorPlayerId);
  formData.append('file', file);

  const response = await fetch(`/api/rooms/${roomId}/characters/upload`, {
    method: 'POST',
    body: formData,
    headers: uploadHeaders(),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail ?? 'Upload failed');
  }
  return response.json() as Promise<{ characters: number; reminder_tokens: number }>;
}

/** List characters, optionally translated into a selected pack language. */
export function listCharacters(roomId: string, language = '') {
  const query = language ? `?language=${encodeURIComponent(language)}` : '';
  return request<Character[]>(`/api/rooms/${roomId}/characters${query}`);
}

/** List reminder token definitions, optionally translated into a selected language. */
export function listReminderTokens(roomId: string, language = '') {
  const query = language ? `?language=${encodeURIComponent(language)}` : '';
  return request<ReminderTokenDefinition[]>(`/api/rooms/${roomId}/reminder-tokens${query}`);
}

/** Assign one character to one player without touching other assignments. */
export function assignCharacter(roomId: string, actorPlayerId: string, playerId: string, characterId: string) {
  return request<CharacterAssignment[]>(`/api/rooms/${roomId}/character-assignments`, {
    method: 'POST',
    body: JSON.stringify({ actor_player_id: actorPlayerId, player_id: playerId, character_id: characterId }),
  });
}

/** Shuffle selected characters across seated players. */
export function assignRandomCharacters(roomId: string, actorPlayerId: string, characterIds: string[]) {
  return request<CharacterAssignment[]>(`/api/rooms/${roomId}/character-assignments/random`, {
    method: 'POST',
    body: JSON.stringify({ actor_player_id: actorPlayerId, character_ids: characterIds }),
  });
}

/** Load character assignments visible to the current viewer. */
export function listCharacterAssignments(roomId: string, viewerPlayerId: string) {
  return request<CharacterAssignment[]>(`/api/rooms/${roomId}/character-assignments?viewer_player_id=${viewerPlayerId}`);
}

/** Load storyteller-only demon bluff ids. */
export function listDemonBluffs(roomId: string, viewerPlayerId: string) {
  return request<string[]>(`/api/rooms/${roomId}/demon-bluffs?viewer_player_id=${viewerPlayerId}`);
}

/** Replace the storyteller's selected demon bluff ids. */
export function setDemonBluffs(roomId: string, actorPlayerId: string, characterIds: string[]) {
  return request<string[]>(`/api/rooms/${roomId}/demon-bluffs`, {
    method: 'POST',
    body: JSON.stringify({ actor_player_id: actorPlayerId, character_ids: characterIds }),
  });
}
