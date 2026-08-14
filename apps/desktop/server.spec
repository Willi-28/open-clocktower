# PyInstaller spec for OpenClocktowerServer.exe
#
# Build from apps/desktop with the backend deps installed in the active env:
#   cd apps/frontend && npm ci && npm run build           # produces dist/ (static UI)
#   cd ../backend && pip install -e .                      # backend importable
#   cd ../desktop && pyinstaller server.spec               # -> build/server/OpenClocktowerServer.exe
#
# The built frontend is bundled as app/static so app.main mounts it at "/", and
# uvicorn's dynamically imported submodules are collected so the frozen server
# boots without a Python install on the target machine.

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

HERE = Path(SPECPATH)
BACKEND = (HERE / ".." / "backend").resolve()
FRONTEND_DIST = (HERE / ".." / "frontend" / "dist").resolve()

# Make the `app` package importable while this spec runs so collect_submodules
# can enumerate it (the backend need not be pip-installed to build the exe).
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

hidden = (
    collect_submodules("uvicorn")
    + collect_submodules("app")
    + ["anyio", "sqlalchemy.dialects.sqlite"]
)

datas = []
if FRONTEND_DIST.exists():
    # Mounted at "/" by app.main via Path(__file__).parent / "static".
    datas.append((str(FRONTEND_DIST), "app/static"))

a = Analysis(
    [str(HERE / "server_entry.py")],
    pathex=[str(BACKEND)],
    binaries=[],
    datas=datas,
    hiddenimports=hidden,
    hookspath=[],
    runtime_hooks=[],
    excludes=["psycopg", "psycopg2"],  # SQLite host build does not need PostgreSQL
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="OpenClocktowerServer",
    console=True,
    disable_windowed_traceback=False,
    upx=True,
)
