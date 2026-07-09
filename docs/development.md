# Development

This project can be developed either as a single Docker Compose stack or as a split backend/frontend stack with Vite hot reload.

## Prerequisites

- Docker
- Docker Compose
- Optional for host-side checks: a current Python runtime and a current Node.js runtime

Do not commit local `.env` files, uploaded data, build output, caches, or dependency folders. The repository ignore rules are set up for that workflow.

## Default Local Stack

The default stack builds the full app image and starts PostgreSQL:

```bash
docker compose up --build
```

Open:

```text
http://localhost:3000
```

Services:

- App container: serves the backend API, WebSockets, and built frontend
- PostgreSQL container: stores room and game state
- `./data`: mounted into the app container for local runtime data

The app reads development settings from `.env.example`. The database schema is created or lightly updated on startup until a dedicated migration workflow is introduced.

## Hot Reload Stack

For frontend work, use the development compose file:

```bash
docker compose -f docker-compose.dev.yml up
```

Open:

```text
http://localhost:5173
```

This stack runs:

- backend with reload enabled on `http://localhost:8000`
- frontend with Vite hot reload on `http://localhost:5173`
- PostgreSQL on the Compose network

The frontend dev server proxies `/api` and `/ws` traffic to the backend service.

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

The frontend check runs type checking, unit tests, and the static analysis script. Backend tests cover rules, uploads, validation, caching, and pack parsing.

## Local Browser Testing

The helper script can open several isolated browser windows for manual multi-player testing:

```powershell
.\scripts\open-test-browsers.ps1 -Url http://localhost:3000 -Players 4
```

Each window uses a separate temporary browser profile so session storage does not collide.

## Local Security Notes

- Development credentials in `.env.example` are for local use only.
- Do not expose the local PostgreSQL port to an untrusted network.
- Browser session credentials are stored client-side; use separate browser profiles when testing multiple users.
- Character pack and avatar uploads are validated, but local test content should still come from trusted sources.
- WebRTC voice may work with STUN locally, but production should use TURN for reliable connectivity.
