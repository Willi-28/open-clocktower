# Development

## Local Stack

The default development stack uses Docker Compose with PostgreSQL:

```bash
docker compose up --build
```

Services:

- App: `http://localhost:3000`
- PostgreSQL: `localhost:5432`

The backend reads `DATABASE_URL` from `.env.example` for development. The app creates the initial SQLAlchemy schema on startup while migrations are still pending.

Players do not have accounts in the MVP. They join a room by name and room code. Storyteller selection happens inside the lobby before the game starts.

## Hot Reload Frontend

For client-side work such as CSS or React changes, use the Vite development
server instead of the production-style static frontend:

```bash
docker compose -f docker-compose.dev.yml up
```

Open `http://localhost:5173`. The frontend source is mounted into the Node
container, so CSS and TypeScript changes update through Vite HMR without
rebuilding or restarting the app container. The Vite proxy forwards `/api` and
`/ws` traffic to the backend service.

Useful local checks:

```bash
cd apps/frontend
npm run check
```

Backend unit tests can be run inside a Python environment with the backend
package installed:

```bash
cd apps/backend
python -m unittest discover -s tests
```
