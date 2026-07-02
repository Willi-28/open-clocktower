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
          <label>
            Character Pack
            <input
              accept=".zip,application/zip"
              type="file"
              onChange={(event) => onCharacterPackFileChange(event.target.files?.[0] ?? null)}
            />
          </label>
          {characterPackFile ? (
            <p className="helper-text">{characterPackFile.name} will be uploaded during room creation.</p>
          ) : (
            <p className="helper-text">A character pack is required before a room can be created.</p>
          )}
          <button disabled={!displayName.trim() || !characterPackFile} type="submit">Create Room</button>
        </form>
      </section>
    </section>
  );
}
