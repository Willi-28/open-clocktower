# API & Events

## HTTP Routes

General:

- `GET /api/health`
- `GET /api/client-config`

Rooms & players:

- `POST /api/rooms`
- `GET /api/rooms/{room_id}`
- `PATCH /api/rooms/{room_id}`
- `DELETE /api/rooms/{room_id}`
- `POST /api/rooms/{room_id}/players`
- `PATCH /api/rooms/{room_id}/players/{player_id}`
- `DELETE /api/rooms/{room_id}/players/{player_id}` (self-leave or storyteller kick)
- `POST /api/rooms/{room_id}/players/{player_id}/avatar` (multipart image upload)
- `POST /api/rooms/{room_id}/storyteller`

Phases, nominations & votes:

- `POST /api/rooms/{room_id}/phase`
- `POST /api/rooms/{room_id}/nominations`
- `POST /api/rooms/{room_id}/nomination-requests`
- `DELETE /api/rooms/{room_id}/nomination-requests/{request_id}`
- `POST /api/rooms/{room_id}/votes`
- `POST /api/rooms/{room_id}/votes/close`
- `POST /api/rooms/{room_id}/executions`
- `POST /api/rooms/{room_id}/reset`

Characters, reminders & bluffs:

- `POST /api/rooms/{room_id}/characters/upload` (multipart character pack)
- `GET /api/rooms/{room_id}/characters`
- `GET /api/rooms/{room_id}/reminder-tokens`
- `POST /api/rooms/{room_id}/character-assignments`
- `POST /api/rooms/{room_id}/character-assignments/random`
- `GET /api/rooms/{room_id}/character-assignments?viewer_player_id=...`
- `GET /api/rooms/{room_id}/demon-bluffs?viewer_player_id=...`
- `POST /api/rooms/{room_id}/demon-bluffs`

Players join by name and room code, without accounts. The lobby must select exactly one storyteller before switching from lobby to day/night. After that, joining and storyteller selection are locked until the storyteller resets the room to lobby.

## WebSocket

Clients connect to `WS /ws/rooms/{room_id}?player_id=...`.

`game.updated` carries the full room snapshot after any persisted change. Alongside it the server emits several smaller realtime events; the full set a client can receive is enumerated in `shared/schemas/events.schema.json` and mirrored by the `RoomSocketEvent` union in `apps/frontend/src/websocket/roomSocket.ts`: `connected`, `chat.message`, `hand.state`, `timer.state`, `vote_count.state`, `bell.ring`, `nomination.executed`, `voice.state`, `voice.call.request`, `voice.call.accept`, `voice.call.reject`, `voice.signal`, `room.kicked`, and `room.deleted`.

Clients send: `chat.send`, `hand.set`, `voice.join`, `voice.leave`, `voice.call.request`, `voice.call.accept`, `voice.call.reject`, `voice.signal`, `timer.set`, `bell.ring`, and `vote_count.set`.
