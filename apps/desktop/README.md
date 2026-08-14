# Open Clocktower — Steam desktop (`apps/desktop`)

A thin Electron shell that lets people play over **Steam** with no port
forwarding and no accounts, **reusing the existing backend and frontend
unchanged**. Docker self-hosting and the plain browser version are untouched.

**One file.** The user runs a single `OpenClocktower.exe` (portable). The Python
backend is built by PyInstaller and **embedded inside** that exe — never a
separate program the user launches — and it is started **only when they host a
room** (Create Room). Joining or connecting to a custom server starts no local
server at all.

## How it works (transport-only split)

The backend already (a) serves the built frontend at `/`, (b) is fully
env-configured, and (c) is talked to by the frontend purely via
`window.location` (relative `/api/...` + `ws://<host>/ws/...`). So the whole app
is one local process, and **which origin serves the page decides the transport**.

```
Host PC (OpenClocktower.exe)                 Joiner PC (OpenClocktower.exe)
  spawn OpenClocktowerServer.exe  ─ 127.0.0.1   local TCP listener 127.0.0.1:PORT2
  (uvicorn + SQLite, UNCHANGED)                 Electron loads http://127.0.0.1:PORT2
  Electron loads http://127.0.0.1:PORT          (frontend thinks it's a normal server)
  create Steam lobby (host = owner)                     │  raw bytes (HTTP + WS)
        │  per remote connection                        ▼
        └────►  TCP  ⇄  Steam message tunnel  ◄──  ISteamNetworking P2P / SDR relay
                         (protocol-agnostic byte pipe)
```

- The tunnel carries the **entire HTTP + WebSocket byte stream**, so the FastAPI
  backend and React frontend never learn Steam exists. One shared game/room/chat/
  voting logic; only the transport differs. → `src/transport/`
- Steam P2P messaging routes through the **Steam Datagram Relay** when a direct
  path is unavailable, so **no port forwarding**. → `src/steam/steam.mjs`
- Docker/Web path is the "Connect to server" button — a normal `loadURL`.

Nothing under `apps/backend` or `apps/frontend` was modified for this.

## Layout

| File | Role |
|------|------|
| `src/main.mjs` | Electron main: create/join/custom wiring + clean teardown |
| `src/serverProcess.mjs` | spawn/stop the shared backend (SQLite) + health wait |
| `src/transport/` | protocol-agnostic TCP⇄channel tunnel (host + client + framing) |
| `src/steam/steam.mjs` | Steam lobby + a `TransportChannel` over Steam networking |
| `src/launcher/launcher.html` | tiny pre-game screen (Create / Join / Connect) |
| `server_entry.py` + `server.spec` | PyInstaller build of `OpenClocktowerServer.exe` |
| `electron-builder.yml` | packages `OpenClocktower.exe` |
| `test/tunnel.test.mjs` | runnable proof of the tunnel (no Steam/Electron needed) |

## Verified vs. needs real Steam

- **Verified here:** `node test/tunnel.test.mjs` passes (small + 1 MiB chunked +
  concurrent connections round-trip through an in-memory channel); the unchanged
  backend boots on SQLite over HTTP; and **`OpenClocktowerServer.exe` was built
  with `server.spec` (PyInstaller) and boot-tested** — it serves `/api/health`,
  the bundled React frontend at `/` (incl. hashed `/assets/*.js`), `/api/client-config`,
  and create-room, all on SQLite. The transport + server-exe packaging are sound.
- **Needs two Steam accounts on two PCs:** `src/steam/steam.mjs` is now bound to
  the exact `steamworks.js` **0.4.0** API (declarations verified: `acceptP2PSession`,
  `readP2PPacket -> {data,size,steamId:{steamId64}}`, `sendP2PPacket`, lobby `.id`
  / `.getOwner().steamId64`, and the `P2PSessionRequest` / `GameLobbyJoinRequested`
  callbacks via `client.callback.register`). Legacy P2P requires accepting the
  session before packets flow, which the channel does automatically. Still needs a
  real two-PC run to confirm end to end.

## Develop

```bash
cd apps/desktop
npm install
npm test                       # tunnel self-test (no Steam)

# For the shell to serve the game UI locally in dev, build the frontend into the
# backend's static dir first (same as Docker does), then run Electron:
cd ../frontend && npm ci && npm run build && cp -r dist ../backend/app/static
cd ../desktop && npm start     # needs Steam running; App 480 via steam_appid.txt
```

Dev host mode runs the server via `py -m uvicorn app.main:app` from
`apps/backend` (see `serverProcess.mjs`), so the backend deps must be importable
in your `py` environment.

## Package (Windows)

```bash
# 1) build the frontend (static UI bundled into the server exe)
cd apps/frontend && npm ci && npm run build

# 2) build OpenClocktowerServer.exe (backend must be pip-installed in this env)
cd ../backend && pip install -e .
cd ../desktop && pyinstaller server.spec --distpath build/server

# 3) build the single portable OpenClocktower.exe (embeds the server exe + steam_appid.txt)
npm install && npm run dist        # -> release/OpenClocktower-<version>.exe  (one file, no installer)
```

The server exe from step 2 is embedded as an internal resource; there is no
separate binary for the user to run.

## Test over Steam with App 480 (Spacewar)

App **480** is Valve's public test app — two different Steam accounts on two PCs
can create/join lobbies and use networking without publishing anything.

1. `steam_appid.txt` (already `480`) sits next to the exe (dev + packaged).
2. Sign in to **different** Steam accounts on each PC, both with Steam running.
3. PC A: launch → **Create Room** → a local server starts, a lobby is created,
   the game UI loads. Note the lobby ID (or invite the other account via the
   Steam overlay / friends — accepting fires auto-join).
4. PC B: launch → paste the lobby ID → **Join** (or accept the invite). Traffic
   tunnels over Steam to PC A's backend; the same room/chat/voting works.
5. Close the room on PC A → the server + tunnels + lobby are torn down.

## Notes / caveats

- **Voice (WebRTC):** signaling rides the tunneled WebSocket and works; the media
  path is still direct WebRTC and needs STUN/TURN for strict NATs (unchanged from
  today). Routing voice over Steam too is a possible later step, out of scope here.
- **SQLite host:** temporary hosts use SQLite (no PostgreSQL); Docker keeps
  PostgreSQL. Same models, same code — only `DATABASE_URL` differs.
- **steamworks.js version:** pinned to exactly `0.4.0` in `package.json` and the
  binding in `steam.mjs` matches that version's declarations. If you bump it,
  re-check `readP2PPacket` / `acceptP2PSession` / the callback names.
- **Steam native libs at package time:** `electron-builder.yml` sets
  `npmRebuild: false` (steamworks.js ships prebuilt napi binaries) and unpacks
  `node_modules/steamworks.js/**` from the asar (its `.node` addon and the Steam
  runtime lib cannot load from inside an asar). If Steam fails to init in the
  packaged app, copy `node_modules/steamworks.js/sdk/redistributable_bin/win64/steam_api64.dll`
  next to `OpenClocktower.exe` as a fallback.
