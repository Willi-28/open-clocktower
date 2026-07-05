# Open Clocktower

Open Clocktower is a self-hosted browser app for live, moderated social-deduction games.

It gives a group a shared digital table with rooms, seats, phases, nominations, voting, private notes, private chat, calls, and custom character packs. It is meant for groups that want to run their own game night online or around a table with a browser-based helper.

## What it is

Open Clocktower helps a storyteller host a hidden-role game session:

* create a private room
* invite players with a room code
* arrange players around a digital table
* upload a character pack to play
* choose which characters are in play
* assign hidden characters
* manage day and night phases
* run nominations and votes
* keep local notes, reminders, and private suspicions

Players do not need accounts. They join with a name and a room code.

## Character packs

To play, you need to upload a character pack.

Character packs contain the roles and character information used in a room. Open Clocktower does not include official game content, so each server operator or storyteller provides their own packs.

Packs are uploaded per room and can be customized for your own group, scripts, variants, or homebrew content.

See [`docs/character-packs.md`](docs/character-packs.md) for the expected format.

## Inspiration and content

Open Clocktower is inspired by the style of live, storyteller-led hidden-role games, especially Blood on the Clocktower.

This project is independent and unaffiliated. It does not include official game content, character names, rules text, logos, artwork, or protected assets. Server operators are responsible for the content they upload to their own instance.

## Install and run locally

You need Docker and Docker Compose.

```bash
docker compose up --build
```

Then open:

```text
http://localhost:3000
```

## Docker image

A Docker image is available on Docker Hub:

[Docker Hub: willi28/open-clocktower](https://hub.docker.com/repository/docker/willi28/open-clocktower/general)

The project repositories and Docker image may remain private while the project is still in preparation. They are intended to become public once the project is ready.

## Production setup

Production is designed for a small self-hosted setup behind an existing Traefik reverse proxy.

Basic steps:

1. Copy `.env.production.example` to `.env`.
2. Set `APP_DOMAIN`, `POSTGRES_PASSWORD`, and `OPEN_CLOCKTOWER_IMAGE`.
3. Make sure Traefik has an external Docker network named `traefik_proxy`.
4. Start the production stack:

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

For the full setup, see [`docs/deployment.md`](docs/deployment.md).

## More information

* [`docs/deployment.md`](docs/deployment.md) — homeserver and Traefik setup
* [`docs/development.md`](docs/development.md) — local development
* [`docs/character-packs.md`](docs/character-packs.md) — custom character pack format
* [`docs/api-events.md`](docs/api-events.md) — API and realtime events
* [`docs/webapp-structure.md`](docs/webapp-structure.md) — project structure

## Status

Open Clocktower is an early MVP. It is usable for testing and small private sessions, but it is intentionally simple. Most game data is scoped to a room session, and deleting a room also deletes its related players, nominations, and votes.
