"""Frozen entry point for OpenClocktowerServer.exe.

PyInstaller bundles the UNCHANGED backend (app.main:app) plus the built frontend
(mounted at / by app.main) into a single exe. The Electron host spawns it on a
loopback port with SQLite configured via environment variables — see
apps/desktop/src/serverProcess.mjs. This file adds no game logic; it only starts
uvicorn, so Docker and the desktop run the exact same server.
"""

import argparse

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="Open Clocktower local server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    # Import lazily so config env vars (DATABASE_URL, DATA_DIR) set by the parent
    # process are read when Settings is constructed.
    from app.main import app

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
