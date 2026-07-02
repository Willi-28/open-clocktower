import type { Character } from '../../api/client';
import { characterRole } from '../gameText';

type CharacterSheetPanelProps = {
  characters: Character[];
};

export function CharacterSheetPanel({ characters }: CharacterSheetPanelProps) {
  return (
    <details className="panel compact sheet-panel">
      <summary>Character Sheet</summary>
      <div className="character-sheet">
        {characters.length === 0 ? <p className="helper-text">No characters loaded.</p> : null}
        {characters.map((character) => (
          <article className="character-card" key={character.id}>
            {character.icon ? <img alt="" src={character.icon} /> : <span className="character-fallback" />}
            <div>
              <strong>{characterRole(character)}</strong>
              <p>{character.ability || 'No ability text.'}</p>
            </div>
          </article>
        ))}
      </div>
    </details>
  );
}
