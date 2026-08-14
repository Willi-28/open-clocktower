/**
 * Initial setup screen.
 *
 * Before joining or creating a room, users choose their display name and either
 * enter an existing room code or upload content for a new room.
 */

import { useRef } from 'react';

type PresetPackOption = {
  id: string;
  label: string;
  meta: string;
};

const presetPackOptions: PresetPackOption[] = [
  { id: 'custom', label: 'Custom ZIP upload', meta: 'Ready' },
];

type SetupScreenProps = {
  characterPackFile: File | null;
  displayName: string;
  onCharacterPackFileChange: (file: File | null) => void;
  onCreateRoom: () => void;
  onDisplayNameChange: (displayName: string) => void;
  onJoinRoom: () => void;
  onRoomIdChange: (roomId: string) => void;
  onRoomNameChange: (roomName: string) => void;
  roomId: string;
  roomName: string;
};

/** Render the join-room and create-room forms. */
export function SetupScreen({
  characterPackFile,
  displayName,
  onCharacterPackFileChange,
  onCreateRoom,
  onDisplayNameChange,
  onJoinRoom,
  onRoomIdChange,
  onRoomNameChange,
  roomId,
  roomName,
}: SetupScreenProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedPack = presetPackOptions[0];

  function clearCharacterPackFile() {
    onCharacterPackFileChange(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  return (
    <section className="setup-grid">
      <section className="panel setup-identity">
        <h2>Your Name</h2>
        <label>
          Display Name
          <input required value={displayName} onChange={(event) => onDisplayNameChange(event.target.value)} />
        </label>
      </section>

      <section className="setup-flow">
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            onJoinRoom();
          }}
        >
          <h2>Join Room</h2>
          <label>
            Room Code
            <input required value={roomId} onChange={(event) => onRoomIdChange(event.target.value)} />
          </label>
          <button disabled={!displayName.trim()} type="submit">Join</button>
        </form>

        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            onCreateRoom();
          }}
        >
          <h2>Create Room</h2>
          <label>
            Room Name
            <input value={roomName} onChange={(event) => onRoomNameChange(event.target.value)} />
          </label>
          <div className="pack-field">
            <span className="pack-field-label">Character Pack</span>
            <div className="pack-select">
              <div aria-label="Selected character pack source" className="pack-select-trigger static">
                <span className="pack-select-copy">
                  <span className="pack-select-kicker">Pack Source</span>
                  <strong>{selectedPack.label}</strong>
                </span>
                <span className="pack-option-meta">{selectedPack.meta}</span>
              </div>
            </div>
          </div>
          <div className="pack-upload-row">
            <label className="pack-upload-button">
              <input
                accept=".zip,application/zip"
                ref={fileInputRef}
                type="file"
                onChange={(event) => onCharacterPackFileChange(event.target.files?.[0] ?? null)}
              />
              Upload ZIP
            </label>
            <span className={characterPackFile ? 'pack-upload-file selected' : 'pack-upload-file'}>
              {characterPackFile?.name ?? 'No ZIP selected'}
            </span>
            {characterPackFile ? (
              <button className="pack-clear-button" onClick={clearCharacterPackFile} type="button">
                Clear
              </button>
            ) : null}
          </div>
          {characterPackFile ? (
            <p className="helper-text">{characterPackFile.name} will be uploaded during room creation.</p>
          ) : (
            <p className="helper-text">Upload a character pack ZIP before creating a room.</p>
          )}
          <button disabled={!displayName.trim() || !characterPackFile} type="submit">Create Room</button>
        </form>
      </section>
    </section>
  );
}
