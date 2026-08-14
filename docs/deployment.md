# Deployment

Open Clocktower is designed for a small self-hosted deployment: one app container behind an HTTPS reverse proxy and one internal PostgreSQL container.

The examples below use:

```text
clocktower.example.com
```

## Infrastructure Model

Production Compose starts:

- `app`: the Open Clocktower container, serving the API, WebSockets, and static frontend on its internal HTTP port
- `db`: PostgreSQL on an internal Docker network
- `open_clocktower_data`: persistent runtime data and uploads
- `postgres_data`: persistent database data
- an external reverse-proxy network, expected to be owned by Traefik

Traefik terminates HTTPS, redirects HTTP to HTTPS, forwards WebSocket traffic, and applies secure transport headers.

## Required Reverse Proxy Assumptions

- Traefik is already running on the host.
- Traefik owns the public HTTP and HTTPS entrypoints.
- DNS for `clocktower.example.com` points to the host.
- Traefik has a certificate resolver configured.
- The external Docker network used by Traefik exists.

Create the network if needed:

```bash
docker network create traefik_proxy
```

## Environment

Copy the production example and edit the resulting `.env`:

```bash
cp .env.production.example .env
```

Required values:

```env
OPEN_CLOCKTOWER_IMAGE=willi28/open-clocktower:latest
APP_DOMAIN=clocktower.example.com
TRAEFIK_NETWORK=traefik_proxy
TRAEFIK_CERT_RESOLVER=le
POSTGRES_DB=open_clocktower
POSTGRES_USER=open_clocktower
POSTGRES_PASSWORD=use-a-long-random-password
FORCE_HTTPS=true
FORWARDED_ALLOW_IPS=172.16.0.0/12
```

Keep `.env` private. It contains database credentials and may contain TURN credentials.

### `FORWARDED_ALLOW_IPS`

The app reads the client IP from `X-Forwarded-For` and uses it for the per-IP
rate limits on room create/join. `FORWARDED_ALLOW_IPS` decides **which peers are
allowed to set that header**, and it defaults to `127.0.0.1` (trust nobody).

Set it to the address or network the reverse proxy connects from - the Docker
bridge range `172.16.0.0/12` covers a standard Compose + Traefik setup. Verify it
against your own network if you customised it:

```bash
docker network inspect traefik_proxy --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
```

Never set it to `*`. Uvicorn then trusts the header from any source and takes the
first entry, so any client could pick its own IP and walk past the rate limits.

Use `latest` for normal deployments unless you intentionally pin a known-good image for rollback. Avoid keeping multiple conflicting `OPEN_CLOCKTOWER_IMAGE` entries in the same `.env` file.

## Start And Update

Pull and start:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Update later with the same commands:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Check health:

```bash
curl https://clocktower.example.com/api/health
```

## Security Checklist

- Use HTTPS only in production.
- Leave `FORCE_HTTPS=true` unless running behind a trusted local-only test proxy.
- Do not publish PostgreSQL to the internet.
- Use a long random `POSTGRES_PASSWORD`.
- Keep `.env`, database dumps, and uploaded content out of git.
- Back up both `postgres_data` and `open_clocktower_data`.
- Use TURN for reliable public voice chat and keep TURN credentials private.
- Do not upload protected or untrusted character content.
- Run a single app replica unless a shared realtime/state layer is added.
- Keep the host, reverse proxy, database image, and app image updated.
- Put additional rate limiting or access control at the reverse proxy if the instance is public.

## WebRTC Voice

Browsers use ICE servers for peer-to-peer voice connections.

STUN-only configuration can work on many networks:

```env
ICE_SERVERS_JSON=[{"urls":"stun:stun.l.google.com:19302"}]
```

For production, add TURN:

```env
ICE_SERVERS_JSON=[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.example.com:3478","username":"turn-user","credential":"turn-password"}]
```

For public instances, prefer short-lived TURN credentials generated server-side. Static TURN credentials are easier to configure but should be treated as secrets.

## Persistence And Backups

Back up:

- PostgreSQL data volume
- Open Clocktower data volume
- the production `.env` file, stored securely outside the repository

Test restore procedures before relying on backups for real sessions.

Room data is intentionally session-oriented. Empty rooms are cleaned up automatically after the configured idle period, and deleting a room deletes related room-local state.

## Scaling Notes

Run exactly one app container for the current architecture. WebSocket connections, voice signaling, timers, room cleanup, and some in-process runtime guards are local to one app process. Multiple replicas can split clients across processes and produce inconsistent live behavior unless a shared realtime/state backend is introduced.

## Operational Notes

- The app serves `/api/health` for basic monitoring.
- Static frontend assets are fingerprinted and may be cached aggressively.
- The HTML shell is served with no-store/no-cache headers so new deployments load current assets.
- Uploaded character pack ZIPs, icons, and profile images are size- and type-validated.
- SVG uploads are not accepted for character pack icons because SVG requires sanitization before it is safe to serve.
