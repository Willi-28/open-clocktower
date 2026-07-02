# API & Events

## MVP 1 HTTP Routes

- `GET /api/health`
- `POST /api/rooms`
- `GET /api/rooms/{room_id}`
- `POST /api/rooms/{room_id}/players`
- `POST /api/rooms/{room_id}/storyteller`
- `PATCH /api/rooms/{room_id}/players/{player_id}`
- `POST /api/rooms/{room_id}/phase`
- `POST /api/rooms/{room_id}/nominations`
- `POST /api/rooms/{room_id}/votes`
- `POST /api/rooms/{room_id}/votes/close`
- `POST /api/rooms/{room_id}/reset`
- `DELETE /api/rooms/{room_id}`
- `POST /api/rooms/{room_id}/characters/upload`
- `GET /api/rooms/{room_id}/characters`
- `POST /api/rooms/{room_id}/character-assignments`
- `GET /api/rooms/{room_id}/character-assignments?viewer_player_id=...`

Players join by name and room code, without accounts. The lobby must select exactly one storyteller before switching from lobby to day/night. After that, joining and storyteller selection are locked until the storyteller resets the room to lobby.

## WebSocket

Clients connect to `WS /ws/rooms/{room_id}`.

The MVP broadcasts `game.updated` with the full room snapshot after relevant room changes. The event schema keeps the planned names from the Notion spec so later slices can split the broad snapshot event into smaller domain events.
