# Bundled character packs

Every `.zip` in this folder is available to local frontend builds and is bundled
into locally created desktop clients. It appears in the pack list on the
room-creation screen without server support or a separate upload. Selecting one
sends it to the room through the normal character-pack upload path.

Public Docker images deliberately contain no packs from this folder. Both Git
and the Docker build context ignore the ZIPs, and the Dockerfile aborts if one
ever reaches the frontend build stage.

## Adding one

Drop the `.zip` in. That is the whole step - the list is built from this folder
at build time, so nothing has to be registered anywhere.

**The file name becomes the label.** `the-menagerie-v1.17.zip` is listed as
"The Menagerie v1.17", so rename the file if you want it to read differently.
Keep names short: the list shows them on one line.

The client is a frozen snapshot in the desktop build, so run the desktop build
again after adding a pack (see `apps/desktop/README.md`).

## Requirements

Each ZIP has to be a valid character pack: `manifest.json` in the root, at most
15 MB, and within the limits in [docs/character-packs.md](../../../../docs/character-packs.md).
An invalid pack is only rejected when a room is created with it, not at build
time, so create one test room with anything you add.

Packs should carry a `credits` block. It is optional, but the credits screen in
client settings reads it, and a bundled pack is distributed to everyone who
installs the app - so whoever made it should be named in it.

## Licensing

Only add packs you have the right to distribute. These ship inside the
application to every user, which is a different thing from a storyteller
uploading a pack into their own room on their own server: the project itself
becomes the distributor. Content you did not create needs its author's
permission.

The repository README states that the app is unofficial and ships no official
game content, and that bundled packs are unofficial fan-made content credited to
their authors. Keep that true: a pack whose author has not been named, or whose
own terms forbid redistribution, does not belong here.
