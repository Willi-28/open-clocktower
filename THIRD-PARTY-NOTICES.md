# Third-party notices

Open Clocktower itself is distributed under the MIT License (see `LICENSE`).
This file lists the third-party material distributed with it and the notices
those licenses require to travel with a distributed copy.

## About Open Clocktower's own content

Open Clocktower ships **no** official Blood on the Clocktower content: no
artwork, logos, rules text, character names, or character packs from that game
or any other published game. Character packs are uploaded per room by the
people running an instance, who are responsible for the content they upload.

The artwork bundled with this project (backgrounds, table surfaces, UI frames,
icons) was **generated with AI image tools**, in some cases starting from
reference material, and is distributed by the project under the MIT License
along with the rest of the repository. Large parts of the source code were
likewise **written with AI assistance**.

## Bundled in the desktop (Steam) client

| Component | Version | License | Notice |
|---|---|---|---|
| [Electron](https://github.com/electron/electron) | 43.x | MIT | Copyright (c) Electron contributors; Copyright (c) 2013-2020 GitHub Inc. Full text ships as `LICENSE.electron.txt`. |
| [Chromium](https://www.chromium.org/) | bundled with Electron | BSD-3-Clause and others | Copyright 2015 The Chromium Authors. Full per-component text ships as `LICENSES.chromium.html`. |
| [steamworks.js](https://github.com/ceifa/steamworks.js) | 0.4.0 | MIT | Copyright (c) 2021 ceifa |
| Steamworks SDK redistributables | shipped by steamworks.js | Valve Steamworks SDK Access Agreement | Redistributable runtime libraries, distributed under the terms accepted on the Steamworks partner site. |

The desktop client also contains the web frontend below.

## Bundled in the web frontend

| Component | Version | License | Notice |
|---|---|---|---|
| [React](https://react.dev/) / React DOM | 19.x | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| [@shiguredo/rnnoise-wasm](https://github.com/shiguredo/rnnoise-wasm) | 2025.1.5 | Apache-2.0 | Copyright 2020-2025 Shiguredo Inc. Wraps [RNNoise](https://gitlab.xiph.org/xiph/rnnoise) (BSD-3-Clause, Copyright (c) 2017-2018 Mozilla, Copyright (c) 2007-2017 Jean-Marc Valin, Xiph.Org Foundation and contributors). |
| [Twemoji](https://github.com/jdecked/twemoji) graphics (`src/assets/twemoji`) | — | **CC-BY 4.0** | Copyright 2020 Twitter, Inc and other contributors. Graphics licensed under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/). |
| [Cinzel](https://fonts.google.com/specimen/Cinzel) (`src/assets/fonts`) | — | SIL Open Font License 1.1 | Copyright 2011 The Cinzel Project Authors. |
| [Alegreya](https://fonts.google.com/specimen/Alegreya) (`src/assets/fonts`) | — | SIL Open Font License 1.1 | Copyright 2011 The Alegreya Project Authors. |

The Twemoji attribution above is the notice required by CC-BY 4.0 and is the
reason this file is installed next to the executable rather than only living in
the repository. Font license details are also kept in
`apps/frontend/src/assets/fonts/LICENSE.md`; the full OFL text is at
<https://openfontlicense.org>.

## Self-hosted server image only

These are dependencies of the Docker server image. They are **not** part of the
desktop client, which ships no server.

| Component | License |
|---|---|
| [FastAPI](https://fastapi.tiangolo.com/) | MIT |
| [Uvicorn](https://www.uvicorn.org/) | BSD-3-Clause |
| [Pydantic](https://docs.pydantic.dev/) | MIT |
| [SQLAlchemy](https://www.sqlalchemy.org/) | MIT |
| [psycopg](https://www.psycopg.org/) (binary) | **LGPL-3.0-or-later** |
| [python-multipart](https://github.com/Kludex/python-multipart) | Apache-2.0 |
| [msgpack](https://github.com/msgpack/msgpack-python) | Apache-2.0 |
| [PostgreSQL](https://www.postgresql.org/) | PostgreSQL License |

psycopg is LGPL: it is used as an unmodified library over its public API and is
installed from PyPI at image build time, which keeps the relinking freedom the
LGPL requires intact. Anyone redistributing a modified psycopg must publish
those modifications.
