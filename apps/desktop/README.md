# Open Clocktower — desktop client (`apps/desktop`)

A thin Electron client for self-hosted Open Clocktower servers, distributed via
Steam. The app is a fullscreen, frameless window that first asks for a server
address, then opens the bundled Open Clocktower setup screen against that server.

The browser version and Docker self-hosting are unchanged.

## Why URL-first

Over the internet there are four connection cases:

| # | From | To | Works? |
|---|------|-----|--------|
| 1 | Browser | Docker host | ✅ via URL |
| 2 | Desktop (.exe) | Docker host | ✅ via URL |
| 3 | Steam client | Steam P2P host | (dropped) |
| 4 | Browser | Steam P2P host | ❌ impossible — Steam's relay is Steam-only; a browser has no URL to reach a NAT'd host |

Case 4 can't work without public infrastructure (even WebRTC needs a public
signaling server). So the desktop app uses the same public self-hosted server as
the browser build: everyone joins one shared backend by URL, and rooms are
created or joined there.

## How it works

The frontend talks to `window.location` for REST (`/api/...`) and WebSocket
(`ws://<host>/ws/...`). In the desktop build, `window.location` is a small local
gateway that serves the bundled UI and forwards API/WebSocket traffic to the
chosen server.

1. The window opens **fullscreen + frameless** on a local entry shell, served by
   a tiny gateway (`src/gateway.mjs`) so it can appear before any connection.
   That shell contains only the server address bar.
2. **Connect** validates the server (`GET /api/health`) and stores it as the
   gateway upstream.
3. The normal bundled setup screen lets players create a room or join an
   existing room on the chosen server.
4. A bottom-right desktop action row lets players **Change Server** from the
   setup screen or **Leave Game** to quit the frameless window; Alt+F4 also works.

Steam is initialised only so the app registers as running / shows the overlay -
**no lobbies or networking**. The frontend is unchanged except small **guarded**
hooks (server-address shell, `connect`, Leave Game button, `?room=` deep-link)
that are inert in the browser/Docker build, where `window.desktop` is undefined.

## Layout

| File | Role |
|------|------|
| `src/main.mjs` | Electron main: fullscreen window, gateway, connect/close IPC, Steam init |
| `src/gateway.mjs` | serves the bundled frontend and proxies `/api` + `/ws` to the chosen server |
| `src/preload.cjs` | exposes `window.desktop.connect` / `changeServer` / `close` |
| `src/steam/steam.mjs` | Steam SDK init + callback pump (presence only) |
| `electron-builder.yml` | packages `OpenClocktower.exe` (bundles the frontend only) |
| `test/gateway.test.mjs` | runnable proof (no Steam/Electron needed) |

Frontend touch points (guarded by `window.desktop`): `ServerConnectScreen`
(server address only), `App` (Leave Game button, `?room=` deep-link auto-join,
connect routing), and the normal `SetupScreen` after a server is selected.

The gateway prefers the stable local port `28741` (`OCT_DESKTOP_PORT` can
override it) so browser-local settings such as theme, audio devices, and volume
survive closing and reopening the desktop app.

## The bundled frontend is a snapshot

`extraResources` copies `apps/frontend/dist` into the app, so the client ships a
**frozen** build of the UI. The desktop `start`, `dist`, and `dist:dir` scripts
now rebuild that frontend snapshot automatically before launching or packaging.
An already-created `.exe` still needs to be packaged again before it contains
new UI changes.

## Hardening

The renderer runs with `contextIsolation: true` and `nodeIntegration: false`, and
on top of that:

- The window is pinned to the gateway origin. `will-navigate` to anything else is
  cancelled, and both it and `setWindowOpenHandler` only pass `http(s)` links to
  `shell.openExternal` - other schemes would let a link start local programs.
- The gateway listens on loopback *and* requires a loopback `Host` header, so a
  hostname that resolves to `127.0.0.1` (DNS rebinding) cannot claim this origin
  and read the stored player session out of its localStorage.
- Static serving resolves inside the bundled `dist` and rejects any path that
  escapes it.

## Verified

- `npm test` passes (gateway self-test: bundled UI, 503 before connect, server
  proxy, SPA fallback, path traversal blocked, host pinned, fixed port).
- Frontend `npm run check` passes (typecheck + unit tests + static analysis) with
  the guarded desktop hooks.
- `electron-builder --dir` assembles a complete runnable app at
  `release/win-unpacked/OpenClocktower.exe` (Electron + bundled frontend + the
  Steam native addon unpacked). The Windows icon is applied automatically from
  `assets/icon.ico` by the `afterPack` hook. Launching it fullscreen and the
  actual join against a live self-hosted server still needs a manual run.

## Develop

```bash
cd apps/frontend && npm ci              # one-time frontend dependencies
cd ../desktop && npm install && npm test
npm start          # rebuilds the frontend, then opens fullscreen; Alt+F4 to quit
npm run dist:dir   # rebuilds the frontend, then creates the unpacked test build
```

## Package (Windows)

```bash
cd apps/frontend && npm ci              # one-time frontend dependencies
cd ../desktop && npm install
npm run dist   # rebuilds frontend -> release/OpenClocktower-<version>.exe
```

The desktop client bundles only the frontend; there is no embedded server, so
there is no Python build step.

**Note:** the single-file `portable`/`nsis` target needs permission to create
symlinks while electron-builder unpacks its code-sign cache. If it fails with
"cannot create symbolic link", enable Windows **Developer Mode** or run the
terminal **as Administrator**. `npm run dist:dir` (unpacked folder) avoids that
code-sign editing step and still writes the saved Clocktower icon via the local
`afterPack` hook.

## Notes

- **steamworks.js:** pinned to `0.4.0`; `npmRebuild: false` and
  `asarUnpack: ["**/node_modules/steamworks.js/**"]` (its native `.node` can't
  load from inside an asar). If Steam fails to init, the app still works - it just
  won't show as "running" on Steam.
- **Voice (WebRTC):** unchanged from the browser - direct WebRTC using the
  server's configured STUN/TURN.
- **steam_appid.txt** (`480`, Spacewar) ships next to the exe for testing; swap it
  for your real App ID on release (or ship through Steam, which provides it).
