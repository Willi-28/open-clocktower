# Webapp Structure

Open Clocktower is split into a React frontend, a FastAPI backend, shared event schemas, Docker infrastructure, and project documentation.

## Top-Level Layout

```text
open-clocktower/
├─ apps/
│  ├─ frontend/          Browser app, assets, audio, UI logic
│  └─ backend/           API, WebSockets, game rules, persistence
├─ docs/                 Documentation
├─ scripts/              Local developer helpers
├─ shared/               Cross-app schemas and contracts
├─ data/                 Local runtime data placeholder
├─ Dockerfile            Multi-stage production image
└─ docker-compose*.yml   Local, hot-reload, and production stacks
```

## Frontend

The frontend is a React app built with Vite. `apps/frontend/src/App.tsx` is the main screen orchestrator. Feature-specific state lives in hooks, pure helpers, and panel components under `apps/frontend/src/game-ui/`.

Important areas:

```text
apps/frontend/src/
├─ api/client.ts                 Typed HTTP client
├─ audio/                        Browser audio capture, effects, and filtering
├─ assets/                       Images, tables, backgrounds, sounds, fonts
├─ game-ui/
│  ├─ components/                Panels, dialogs, table, controls
│  ├─ hooks/                     Stateful room, voice, vote, and UI logic
│  ├─ layout/                    Pure table layout calculations
│  ├─ utils/                     Pure player and table helpers
│  ├─ chatRules.ts               Client-side chat visibility helper
│  ├─ clientSettings.ts          Browser-local settings
│  ├─ emojis.ts                  Chat emoji definitions and search data
│  ├─ gameConfig.ts              Static UI defaults
│  ├─ gameText.ts                Character display helpers
│  ├─ nightOrder.ts              Night-order derivation
│  ├─ reminderTokens.ts          Reminder token display helpers
│  ├─ sessionStorage.ts          Browser session persistence
│  ├─ timer.ts                   Timer formatting
│  ├─ twemoji.ts                 Emoji asset rendering helpers
│  ├─ useChatState.ts            Chat tabs, drafts, and visibility
│  ├─ useDiscussionTimer.ts      Timer state
│  ├─ voiceRooms.ts              Voice-room labels and presence helpers
│  └─ voting.ts                  Vote order and vote-count helpers
├─ styles/app.css                Main visual design and themes
├─ websocket/roomSocket.ts       Browser WebSocket wrapper
└─ main.tsx                      React entry point
```

Key hooks:

- `useRoomLifecycle`: create, join, leave, kick, and delete rooms.
- `useRoomSocketEvents`: apply realtime room, chat, timer, vote, and voice events.
- `useGameData`: load characters, reminder tokens, assignments, and demon bluffs.
- `useVotingControls`: nomination, execution, raised-hand, and vote-count flow.
- `useVoiceController`: voice devices, peer connections, room membership, mute state, and diagnostics.
- `useOptimisticSeatMove`: immediate seat feedback while limiting rapid seat changes.
- `useLocalGameAnnotations`: local suspicions and local reminder placements.
- `useTableUiState`: selected player, active panels, dashboard state, and table UI state.

## Backend

The backend is a FastAPI app. It owns validation, persistence, authentication checks, room state, WebSocket routing, upload validation, and production static file serving.

```text
apps/backend/app/
├─ api/rooms.py                  HTTP room and gameplay endpoints
├─ config.py                     Environment-based settings
├─ db/
│  ├─ models.py                  SQLAlchemy models
│  └─ session.py                 Engine, sessions, and schema bootstrap
├─ game/
│  ├─ character_packs.py         Character pack ZIP parsing and validation
│  ├─ chat_rules.py              Private chat rules
│  ├─ media_validation.py        Avatar upload validation
│  ├─ room_state.py              Request and response models
│  ├─ rules.py                   Pure game rule checks
│  └─ store.py                   Persistence and room state transitions
├─ websocket/
│  ├─ room_hub.py                Connected clients and room broadcasts
│  └─ rooms.py                   WebSocket endpoint and message handling
└─ main.py                       App assembly, middleware, cleanup, static files
```

Request flow:

1. The browser calls `api/client.ts` or sends a WebSocket message through `roomSocket.ts`.
2. FastAPI validates HTTP request models from `game/room_state.py`.
3. `game/store.py` authenticates the actor, applies rules, and persists changes.
4. HTTP handlers return updated state.
5. `websocket/room_hub.py` broadcasts room, chat, timer, vote, bell, nomination, voice, kick, and delete events.

## Data And Runtime State

- PostgreSQL stores persistent room state, players, nominations, votes, character assignments, bluffs, avatars, and imported pack metadata.
- The app data volume stores runtime uploads and local assets.
- Browser storage keeps client settings, session credentials, local notes, local reminders, and local UI preferences.
- Some live behavior is process-local: WebSocket connections, voice signaling, timers, cleanup loops, and in-process throttles. This is why production should run one app replica.

## Contracts

- Backend Pydantic models define public HTTP request and response shapes.
- Frontend TypeScript types in `api/client.ts` mirror those backend models.
- `shared/schemas/events.schema.json` documents the realtime event envelope and event names.

## Infrastructure

- `Dockerfile` builds the frontend and installs the backend into one production image.
- `docker-compose.yml` runs a local full-stack app plus PostgreSQL.
- `docker-compose.dev.yml` runs backend reload, Vite hot reload, and PostgreSQL.
- `docker-compose.prod.yml` runs the app image and PostgreSQL behind a Traefik network.
- `.dockerignore` keeps documentation, local data, environment files, and development artifacts out of the production build context.

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

## Files That Should Stay Local

- `.env` and other untracked environment files
- `data/` runtime content, except the placeholder file
- frontend `node_modules/`, build output, and Vite cache
- Python caches, virtual environments, test caches, and coverage output
- local logs, local database files, and OS metadata files
