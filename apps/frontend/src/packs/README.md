# Local character packs

Every `.zip` in this folder is available to local frontend builds. Release-mode
builds, including published desktop clients, deliberately exclude it. It appears in the pack list on the
room-creation screen without server support or a separate upload. Selecting one
sends it to the room through the normal character-pack upload path.

Public Docker images and desktop releases contain no packs from this folder.
Git and the Docker build context ignore the ZIPs, while local development and
`npm start` desktop builds can still use them.

## Adding one

Drop the `.zip` in. That is the whole step - the list is built from this folder
at build time, so nothing has to be registered anywhere.

**The file name becomes the label.** `the-menagerie-v1.17.zip` is listed as
"The Menagerie v1.17", so rename the file if you want it to read differently.
Keep names short: the list shows them on one line.

The client is a frozen snapshot in local desktop builds, so run the desktop app
again after adding a pack (see `apps/desktop/README.md`).

## Requirements

Each ZIP has to be a valid character pack: `manifest.json` in the root, at most
15 MB, and within the limits in [docs/character-packs.md](../../../../docs/character-packs.md).
An invalid pack is only rejected when a room is created with it, not at build
time, so create one test room with anything you add.

Packs should carry a `credits` block. It is optional, but the credits screen in
client settings reads it, so whoever made it should be named in it.

## Licensing

Only add packs you have the right to use. The ZIP files stay in the local
workspace and are not part of public source, Docker, or desktop releases.

The repository README states that the app is unofficial and ships no official
game content, and that bundled packs are unofficial fan-made content credited to
their authors. Keep that true: a pack whose author has not been named, or whose
own terms forbid redistribution, does not belong here.
