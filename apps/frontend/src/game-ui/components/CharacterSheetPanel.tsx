/**
 * Character sheet display panel.
 *
 * The panel lists the currently loaded character pack so players can read role
 * names, categories, icons, and ability text in their selected language.
 */

import type { Character } from '../../api/client';
import { characterRole } from '../gameText';

type CharacterSheetPanelProps = {
  characters: Character[];
};

/** Render the imported character sheet as a collapsible side panel. */
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
