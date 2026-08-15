# Steam release

Open Clocktower ships on Steam as a free desktop client for **self-hosted**
servers. There is no public Open Clocktower server: every group runs its own
Docker instance and players enter its address in the client.

The build is prepared so that no Steamworks identifier lives in the source. The
Steam SDK reads the App ID from the environment Steam sets at launch, so the
same build works before and after the App ID exists, and every later update is
the same two commands.

## Build and upload

```bash
cd apps/desktop
npm run steam:build          # clean rebuild + verification + SteamPipe scripts
steamcmd +login <account> +run_app_build "<path printed by the build>" +quit
```

`npm run steam:build` refuses to produce an uploadable build unless all of this
holds, so a broken upload is not possible by accident:

| Check | Why it exists |
|---|---|
| `LICENSE` is a real license, `THIRD-PARTY-NOTICES.md` exists | CC-BY (Twemoji) and OFL (fonts) require the notice to ship with the binary |
| `release/` is wiped first, and no stray build directory survives | a failed build left `win-unpacked.failed-*` folders behind before; they would have gone into the depot |
| no `steam_appid.txt` in the output or inside `app.asar` | that file **overrides** the App ID Steam passes in — a shipped copy makes every customer's client announce the wrong app |
| bundled frontend is byte-identical to `apps/frontend/dist` | the client embeds a frozen UI snapshot; this is what caught the Steam build shipping pre-fix voice code |
| `LICENSE.txt` and `THIRD-PARTY-NOTICES.txt` are next to the exe | attribution must travel with the distributed copy |

Other entry points:

```bash
npm run steam:build:test     # same, plus steam_appid.txt for local overlay testing
node scripts/steam-build.mjs --verify-only    # re-check release/ without rebuilding
node scripts/steam-build.mjs --skip-frontend  # reuse the existing frontend dist
```

A failing check exits non-zero, so this is safe to run from CI.

## One-time Steamworks setup

Do these in order once the identity/tax review at partner.steamgames.com clears.

1. **Pay the $100 Steam Direct fee** and take the App ID. The fee is only
   recoupable against $1,000 of revenue, so for a free release treat it as a
   one-off cost.
2. **App landing page** — name `Open Clocktower`, Windows only. App type: *Game*
   is the usual choice; *Application* is defensible for a tabletop tool and gets
   less discovery traffic.
3. **Installation → General Installation → Launch Options**
   - Executable: `OpenClocktower.exe`
   - Arguments: *(none)*
   - Operating System: Windows
4. **SteamPipe → Depots** — a default depot is created with the app. Note its
   depot ID.
5. **Fill in [`apps/desktop/steam/steam.config.json`](../apps/desktop/steam/steam.config.json)**:

   ```json
   { "appId": 1234560, "depotId": 1234561, "branch": "", "steamcmdAccount": "your-account" }
   ```

   Leave `branch` empty so an upload never goes live automatically — you set the
   build live in Steamworks after testing it. This file is the only place a
   Steam identifier exists.
6. **Upload a first build to a beta branch and launch it through Steam.** This
   is the only real test that the App ID resolves and the overlay works; running
   the exe directly does not exercise that path.

## Content survey — the answers for this app

These are mandatory disclosures and Valve checks them during review.

| Question | Answer |
|---|---|
| **AI-generated content** | **Yes — pre-generated.** The bundled artwork was produced with AI image tools, partly from reference material, and large parts of the source code were written with AI assistance. Describe it as: *"Backgrounds, table surfaces and UI art were created with AI image generation tools during development. Parts of the source code were written with AI assistance. No AI generates content while the game is running."* |
| **User-generated content** | **Yes.** Storytellers upload character packs (images, text, night order) into their own room on their own server. |
| **In-game communication** | **Yes — text chat and voice chat between players, unmoderated.** Steam will show the "Includes unmoderated in-game communication" notice. |
| **Online play / third-party servers** | **Yes.** The app connects only to servers the players host themselves. |
| **Personal data** | Voice uses direct WebRTC connections, so players' IP addresses are visible to the other players in the room. Provide a privacy policy URL — you are in the EU, so this is not optional. |

Do not skip the AI disclosure. Discovering it after release is a store-page
compliance problem; declaring it up front costs nothing.

## Review notes (paste into "Instructions for reviewers")

The reviewer cannot test the app without a server, and no public one exists.
Give them yours:

> Open Clocktower is a client for self-hosted game servers, similar to a
> Minecraft or Mumble client — it does not bundle a server and there is no
> official public server. Groups run their own instance with Docker (see
> https://github.com/Willi-28/open-clocktower).
>
> For your review, a test server is available:
>
>   1. Launch the app. It opens fullscreen on a server address screen.
>   2. Enter: https://botc.kazekagewilli.de
>   3. Press Connect, then "Create Room" to open a table. Opening the same
>      server in a second instance or in a browser lets you join as a player.
>   4. Alt+F4 or the "Leave Game" button (bottom right) exits.
>
> The store page states that a self-hosted server is required.

Keep that server reachable for the whole review window.

## Store page

The page must be **publicly visible for at least two weeks** before the release
date, so plan backwards from it. Required material:

| Item | Size |
|---|---|
| Header capsule | 460 × 215 |
| Small capsule | 462 × 174 |
| Main capsule | 616 × 353 |
| Vertical capsule | 374 × 448 |
| Library capsule | 600 × 900 |
| Library header | 3840 × 1240 |
| Logo (transparent PNG) | 1280 × 720 |
| Screenshots | at least 5 at 1920 × 1080 |

Say the self-hosting requirement in the **first line** of the short description
and again under system requirements — it is the single thing most likely to
cause refunds and negative reviews if a buyer misses it. Something like:

> Requires your own self-hosted Open Clocktower server (free, Docker, setup
> guide included). There is no public server.

Since [the README](../README.md) already states that no official game content
ships, keep the store text consistent: describe the app as a storyteller-led
social deduction table, and do not name or compare to a published commercial
game in the description or tags.

## Later updates

Nothing about the identity changes. Rebuild, upload, set the new build live:

```bash
cd apps/desktop
npm run steam:build
steamcmd +login <account> +run_app_build "<printed path>" +quit
```

The frontend is rebuilt and byte-checked every time, so a UI change can no
longer be forgotten on the way into the client. Bump `version` in
`apps/desktop/package.json` when it is worth labelling the build; the depot
description picks it up automatically.
