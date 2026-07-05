/**
 * Character sheet display panel.
 *
 * The panel lists the currently loaded character pack grouped by the category
 * defined in the pack (Townsfolk, Outsider, Minion, Demon, ...) so players can
 * read role names, icons, and ability text in their selected language.
 */

import { useMemo } from 'react';

import type { Character } from '../../api/client';
import { RoleDistribution } from './RoleDistribution';

type CharacterSheetPanelProps = {
  characters: Character[];
  seatedPlayerCount: number;
};

// Standard Blood on the Clocktower category display order; pack-specific
// categories beyond these keep their order of appearance below the known ones.
const categoryDisplayOrder = ['townsfolk', 'outsider', 'minion', 'demon', 'traveler', 'traveller', 'fabled'];

/** Group characters by their pack-defined category, in the standard sheet order. */
function groupByCategory(characters: Character[]) {
  const groups: Array<{ category: string; characters: Character[] }> = [];
  for (const character of characters) {
    const category = character.category.trim() || 'unknown';
    const group = groups.find((candidate) => candidate.category.toLowerCase() === category.toLowerCase());
    if (group) {
      group.characters.push(character);
    } else {
      groups.push({ category, characters: [character] });
    }
  }
  const rank = (category: string) => {
    const index = categoryDisplayOrder.indexOf(category.toLowerCase());
    return index === -1 ? categoryDisplayOrder.length : index;
  };
  return groups.sort((a, b) => rank(a.category) - rank(b.category));
}

/** Render the imported character sheet as a dashboard tab section. */
export function CharacterSheetPanel({ characters, seatedPlayerCount }: CharacterSheetPanelProps) {
  const categoryGroups = useMemo(() => groupByCategory(characters), [characters]);
  // Packs without category info render as one flat list instead of an "Unknown" group.
  const showCategoryHeadings = categoryGroups.some((group) => group.category.toLowerCase() !== 'unknown');

  return (
    <div className="character-sheet">
      {characters.length === 0 ? <p className="helper-text">No characters loaded.</p> : null}
      {categoryGroups.map((group) => (
        <section className="character-team" key={group.category}>
          {showCategoryHeadings ? <h3 className="tool-section-heading character-team-heading">{group.category}</h3> : null}
          {group.characters.map((character) => (
            <article className="character-card" key={character.id}>
              {character.icon ? <img alt="" src={character.icon} /> : <span className="character-fallback" />}
              <div>
                <strong>{character.name}</strong>
                <p>{character.ability || 'No ability text.'}</p>
              </div>
            </article>
          ))}
        </section>
      ))}
      <RoleDistribution playerCount={seatedPlayerCount} />
    </div>
  );
}
