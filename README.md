# Open Clocktower

Self-hosted browser app for hidden-role / social-deduction games.

## Tech stack

- Frontend: React + Vite + TypeScript
- Backend: Python + FastAPI
- Realtime: WebSockets
- Persistence: PostgreSQL via SQLAlchemy
- Deployment: Docker / Docker Compose

## Development

```bash
docker compose up --build
```

Open the app at `http://localhost:3000`.

## Production With Traefik

Open Clocktower 0.1 is designed to run as one app container plus one PostgreSQL
container behind an existing Traefik reverse proxy.

1. Create an `.env` from `.env.production.example`.
2. Set `APP_DOMAIN`, `POSTGRES_PASSWORD`, and `OPEN_CLOCKTOWER_IMAGE`.
3. Make sure your Traefik container has an external Docker network named `traefik_proxy`.
4. Start the production stack:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Traefik terminates HTTPS and forwards HTTP/WebSocket traffic to the app on port `8000`.
Plain HTTP is redirected to HTTPS, and production enables a backend HTTPS guard
as a second layer.
Do not scale the `app` service above one replica in version 0.1 because live room
state and WebRTC signaling are kept in memory per app container.

See [docs/deployment.md](docs/deployment.md) for the homeserver setup.

To test several players on one machine, start the app and then run:

```powershell
.\scripts\open-test-browsers.ps1 -Players 5
```

The script opens isolated incognito/profile windows so each window gets its own browser session.

## Manual MVP Test Flow

1. Create a room as storyteller and upload a character pack zip.
2. Join from several isolated browser windows with the room code.
3. Let players choose seats by clicking open seats.
4. Select the possible characters and click `Randomly Assign`.
5. Pick three demon bluffs as storyteller.
6. Switch between `Day` and `Night` from the storyteller tools.
7. Use seats for nominations, private chat, calls, deaths, and dead votes.
8. Use `Reminder Tokens` and `Private Suspicions` for local table markers.

## MVP 1 Scope

The current scaffold follows the Notion MVP 1 cut:

- create and open rooms
- join as player with only name and room code, without accounts
- choose exactly one storyteller in the lobby before the game starts
- lock joining and storyteller selection after the game starts
- configure dynamic seat counts
- render a circular digital table
- assign players to seats
- switch lobby/day/night manually
- start nominations and cast votes
- show public votes visually
- upload room-local character packs
- assign real characters as storyteller
- save private character suspicions in the browser
- reset the persisted game state

Players can reconnect from the same browser session. For version 0.1, room state
is intentionally stored in one app process, so production should run a single app
container.

Most game data is scoped to a room session. Deleting a room deletes its players, nominations, and votes through database cascades.

Open Clocktower does not ship official game content, names, rules text, logos, or protected assets. Server operators are responsible for the content they upload to their own instance.
