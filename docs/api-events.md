# API & Events

The backend exposes HTTP routes for persisted actions and a WebSocket route for realtime room updates, chat, timers, voting, and voice signaling.

## Authentication Model

Players do not have accounts. Creating or joining a room returns:

- the current room snapshot
- `player_id`
- `player_secret`

Clients must keep `player_secret` private. Mutating HTTP requests that act as a player or storyteller send it as:

```http
X-Player-Secret: <player_secret>
```

WebSocket clients connect with both values:

```text
/ws/rooms/{room_id}?player_id=<player_id>&secret=<player_secret>
```

If WebSocket credentials are missing or invalid, the connection is treated as read-only and cannot act as that player.

## HTTP Routes

General:

- `GET /api/health`
- `GET /api/client-config`

Rooms and players:

- `POST /api/rooms`
- `GET /api/rooms/{room_id}`
- `PATCH /api/rooms/{room_id}`
- `DELETE /api/rooms/{room_id}`
- `POST /api/rooms/{room_id}/players`
- `PATCH /api/rooms/{room_id}/players/{player_id}`
- `DELETE /api/rooms/{room_id}/players/{player_id}`
- `POST /api/rooms/{room_id}/players/{player_id}/avatar`
- `POST /api/rooms/{room_id}/storyteller`

Phases, nominations, and votes:

- `POST /api/rooms/{room_id}/phase`
- `POST /api/rooms/{room_id}/nominations`
- `POST /api/rooms/{room_id}/nomination-requests`
- `DELETE /api/rooms/{room_id}/nomination-requests/{request_id}`
- `POST /api/rooms/{room_id}/votes`
- `POST /api/rooms/{room_id}/votes/close`
- `POST /api/rooms/{room_id}/executions`
- `POST /api/rooms/{room_id}/reset`

Characters, reminders, and bluffs:

- `POST /api/rooms/{room_id}/characters/upload`
- `GET /api/rooms/{room_id}/characters`
- `GET /api/rooms/{room_id}/reminder-tokens`
- `POST /api/rooms/{room_id}/character-assignments`
- `POST /api/rooms/{room_id}/character-assignments/random`
- `GET /api/rooms/{room_id}/character-assignments?viewer_player_id=...`
- `GET /api/rooms/{room_id}/demon-bluffs?viewer_player_id=...`
- `POST /api/rooms/{room_id}/demon-bluffs`

## Room And Seat Rules

- Rooms are created by an initial storyteller.
- Players can join by name and room code.
- Players can always join a room, but taking seats is only allowed before the game starts or after the board is shown.
- During an active game, new joiners remain spectators until seats reopen.
- Storyteller-only actions require storyteller credentials.
- Seat changes are throttled and serialized to reduce spam and race conditions.
- Seat count changes keep occupied seats and remove free seats first.

## Uploads

Character pack uploads:

- ZIP only
- capped upload size
- capped uncompressed archive size
- capped file count
- safe relative paths only
- PNG/JPG/JPEG/WEBP icons only
- SVG icons rejected

Profile image uploads:

- PNG/JPG/JPEG/GIF only
- capped file size
- extension, MIME type, magic bytes, and dimensions checked

## WebSocket Events

Clients receive an event envelope:

```json
{
  "type": "event.name",
  "payload": {}
}
```

The event names are documented in:

```text
shared/schemas/events.schema.json
```

Current event types include:

- `connected`
- `game.updated`
- `chat.message`
- `chat.private.notice`
- `hand.state`
- `timer.state`
- `vote_count.state`
- `bell.ring`
- `nomination.executed`
- `voice.state`
- `voice.call.request`
- `voice.call.accept`
- `voice.call.reject`
- `voice.signal`
- `room.kicked`
- `room.deleted`

`game.updated` carries the full room snapshot after persisted changes. Smaller events carry focused realtime state for chat, voice, timers, voting, and notifications.

Private chat text is only delivered to the sender and recipient. When two non-storyteller players exchange a private message, the room may receive a `chat.private.notice` containing only participant IDs, not message text.

## WebSocket Client Messages

Clients can send:

- `chat.send`
- `hand.set`
- `voice.join`
- `voice.leave`
- `voice.call.request`
- `voice.call.accept`
- `voice.call.reject`
- `voice.signal`
- `timer.set`
- `bell.ring`
- `vote_count.set`

Invalid payloads are ignored or rejected without closing the whole room. Chat sends are rate-limited per player.

## Security Notes

- Treat `player_secret` like a session token.
- Use HTTPS/WSS in production.
- Do not expose private TURN credentials through anything except the intended browser ICE configuration.
- Add reverse-proxy rate limiting or access control if running a public instance.
- Do not assume room codes alone are authentication; the private player secret is what authorizes player actions.
