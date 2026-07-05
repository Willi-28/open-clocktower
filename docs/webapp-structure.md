# Webapp Structure

Open Clocktower is split into a React frontend, a FastAPI backend, shared schemas,
and deployment scripts. The frontend owns the browser experience; the backend owns
room state, persistence, validation, and realtime broadcasts.

## Top-Level Layout

```text
open-clocktower/
├─ apps/
│  ├─ frontend/          React + Vite browser app
│  └─ backend/           FastAPI app, game rules, persistence, WebSockets
├─ docs/                 Project documentation
├─ scripts/              Local checks and developer helpers
├─ shared/               Cross-app schemas and contracts
├─ data/                 Local runtime data placeholder
├─ Dockerfile
└─ docker-compose*.yml   Local, dev, and production stacks
```

## Frontend

`apps/frontend/src/App.tsx` is the screen orchestrator. It wires together room
lifecycle, chat, voice, voting, timer, game data, settings, and the table view.
Feature behavior lives in smaller hooks and components below `src/game-ui/`.

```text
apps/frontend/src/
├─ api/client.ts                 Typed HTTP client for backend routes
├─ audio/                        Browser audio capture, effects, filtering
├─ assets/                       Table, background, favicon, and sound assets
├─ game-ui/
│  ├─ components/                Rendered panels, table, dialogs, controls
│  ├─ hooks/                     Stateful feature logic
│  ├─ layout/                    Pure layout calculations
│  ├─ utils/                     Pure player/table helpers
│  ├─ chatRules.ts               Private chat visibility rules
│  ├─ clientSettings.ts          Local browser settings
│  ├─ emojis.ts                  Chat emoji shortcodes, search, and rendering
│  ├─ gameConfig.ts              Static frontend game defaults
│  ├─ nightOrder.ts              Character night-order derivation
│  ├─ reminderTokens.ts          Reminder token display helpers
│  ├─ timer.ts                   Timer formatting
│  ├─ useChatState.ts            Chat tabs, drafts, and message visibility
│  ├─ useDiscussionTimer.ts      Discussion timer state
│  ├─ voiceRooms.ts              Voice room labels and presence helpers
│  └─ voting.ts                  Vote order and vote-count helpers
├─ styles/app.css                Main visual design
├─ websocket/roomSocket.ts       Browser WebSocket wrapper
└─ main.tsx                      React entry point
```

Important hooks:

- `useRoomLifecycle`: create, join, leave, kick, and delete rooms.
- `useRoomSocketEvents`: apply realtime room, chat, timer, and voice events.
- `useGameData`: character packs, assignments, and demon bluffs.
- `useVotingControls`: nomination, execution, raised hand, and vote count flow.
- `useVoiceController`: combines device selection, voice rooms, peers, and activity.
- `useOptimisticSeatMove`: immediate seat feedback while serializing rapid seat clicks.
- `useLocalGameAnnotations`: local suspicions and reminder token placement.
- `useTableUiState`: selected player, panels, table zoom, and UI-only state.

## Backend

`apps/backend/app/main.py` creates the FastAPI app, registers HTTP and WebSocket
routes, applies cache policy, starts cleanup, and serves the built frontend in
the production container.

```text
apps/backend/app/
├─ api/rooms.py                  HTTP room and gameplay endpoints
├─ config.py                     Environment-based backend settings
├─ db/
│  ├─ models.py                  SQLAlchemy database models
│  └─ session.py                 Engine, sessions, and schema creation
├─ game/
│  ├─ character_packs.py         Uploaded character pack parsing
│  ├─ chat_rules.py              Server-side private chat rules
│  ├─ media_validation.py        Avatar upload validation
│  ├─ room_state.py              Pydantic request/response models
│  ├─ rules.py                   Core game rule checks
│  └─ store.py                   Room persistence and state transitions
├─ websocket/
│  ├─ room_hub.py                Connected clients and room broadcasts
│  └─ rooms.py                   WebSocket endpoint and message handling
└─ main.py
```

Request flow:

1. Frontend calls `api/client.ts` or sends a WebSocket message through `roomSocket.ts`.
2. FastAPI validates request models from `game/room_state.py`.
3. `game/store.py` applies rules and persists changes through `db/models.py`.
4. HTTP handlers return the updated room state.
5. `websocket/room_hub.py` broadcasts room, chat, timer, and voice updates.

## Data And Contracts

- PostgreSQL stores rooms, players, nominations, votes, character assignments,
  demon bluffs, and uploaded room content metadata.
- Browser `localStorage` stores client settings, reconnect session data, local
  suspicions, and local reminder tokens.
- `shared/schemas/events.schema.json` documents realtime event payloads.
- Frontend TypeScript types in `api/client.ts` mirror backend Pydantic models.

## Checks

Frontend:

```bash
cd apps/frontend
npm run check
```

Backend:

```bash
cd apps/backend
python -m unittest discover -s tests
```

## Cleanup Rules

Generated files should stay out of the app structure:

- Python caches: `__pycache__/`, `.pytest_cache/`, `*.py[cod]`
- Python package metadata: `*.egg-info/`
- Frontend installs/builds: `node_modules/`, `dist/`, `.vite/`
- Local runtime data except `data/.gitkeep`
