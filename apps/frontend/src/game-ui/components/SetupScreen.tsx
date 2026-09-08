/**
 * Initial setup screen.
 *
 * Before joining or creating a room, users choose their display name and either
 * enter an existing room code or upload content for a new room.
 */

import { useEffect, useRef, useState } from 'react';

import { bundledPacks, loadBundledPack } from '../bundledPacks';
import { useUiText } from '../../i18n';

const customPackId = 'custom';

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
  const t = useUiText();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // A bundled pack is the default when one ships, so creating a room needs no
  // file at all; picking "custom" falls back to the manual ZIP upload.
  const [selectedPackId, setSelectedPackId] = useState(bundledPacks[0]?.id ?? customPackId);
  const [isPreparingPack, setIsPreparingPack] = useState(false);
  const [packError, setPackError] = useState('');
  const selectedBundledPack = bundledPacks.find((pack) => pack.id === selectedPackId);

  // Hand the chosen bundled pack to the room as a File, so it travels the same
  // upload path as a pack the storyteller picks by hand and needs no server
  // support of its own.
  useEffect(() => {
    if (!selectedBundledPack) {
      return;
    }
    let isCurrent = true;
    setIsPreparingPack(true);
    setPackError('');
    void loadBundledPack(selectedBundledPack)
      .then((file) => {
        if (isCurrent) {
          onCharacterPackFileChange(file);
        }
      })
      .catch((error: Error) => {
        if (isCurrent) {
          setPackError(error.message);
        }
      })
      .finally(() => {
        if (isCurrent) {
          setIsPreparingPack(false);
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [selectedBundledPack, onCharacterPackFileChange]);

  /** Switch pack source, dropping any file the previous choice had set. */
  function selectPackSource(packId: string) {
    setSelectedPackId(packId);
    setPackError('');
    clearCharacterPackFile();
  }

  function clearCharacterPackFile() {
    onCharacterPackFileChange(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  return (
    <section className="setup-grid">
      <section className="panel setup-identity">
        <h2>{t('Your Name')}</h2>
        <label>{t('Display Name')}<input required value={displayName} onChange={(event) => onDisplayNameChange(event.target.value)} />
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
          <h2>{t('Join Room')}</h2>
          <label>{t('Room Code')}<input required value={roomId} onChange={(event) => onRoomIdChange(event.target.value)} />
          </label>
          <button disabled={!displayName.trim()} type="submit">{t('Join')}</button>
        </form>

        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            onCreateRoom();
          }}
        >
          <h2>{t('Create Room')}</h2>
          <label>{t('Room Name')}<input value={roomName} onChange={(event) => onRoomNameChange(event.target.value)} />
          </label>
          <div className="pack-field">
            <span className="pack-field-label">{t('Character Pack')}</span>
            <div className="pack-select">
              <select
                aria-label={t('Character pack')}
                className="pack-select-input"
                value={selectedPackId}
                onChange={(event) => selectPackSource(event.target.value)}
              >
                {bundledPacks.map((pack) => (
                  <option key={pack.id} value={pack.id}>
                    {pack.label}
                  </option>
                ))}
                <option value={customPackId}>{t('Custom ZIP upload')}</option>
              </select>
            </div>
          </div>
          {selectedBundledPack ? (
            isPreparingPack ? <p className="helper-text">{t('Preparing {pack}...', { pack: selectedBundledPack.label })}</p> : null
          ) : (
            <>
              <div className="pack-upload-row">
                <label className="pack-upload-button">
                  <input
                    accept=".zip,application/zip"
                    ref={fileInputRef}
                    type="file"
                    onChange={(event) => onCharacterPackFileChange(event.target.files?.[0] ?? null)}
                  />{t('Upload ZIP')}</label>
                <span className={characterPackFile ? 'pack-upload-file selected' : 'pack-upload-file'}>
                  {characterPackFile?.name ?? t('No ZIP selected')}
                </span>
                {characterPackFile ? (
                  <button className="pack-clear-button" onClick={clearCharacterPackFile} type="button">{t('Clear')}</button>
                ) : null}
              </div>
              {characterPackFile ? (
                <p className="helper-text">{t('{file} will be uploaded during room creation.', { file: characterPackFile.name })}</p>
              ) : null}
            </>
          )}
          {packError ? <p className="helper-text">{t(packError)}</p> : null}
          <button disabled={!displayName.trim() || !characterPackFile || isPreparingPack} type="submit">{t('Create Room')}</button>
        </form>
      </section>
    </section>
  );
}
