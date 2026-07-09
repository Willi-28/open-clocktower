/**
 * Character sheet display panel.
 *
 * The panel lists the currently loaded character pack grouped by the category
 * defined in the pack (Townsfolk, Outsider, Minion, Demon, ...) so players can
 * read role names, icons, and ability text in their selected language.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { Character } from '../../api/client';
import { RoleDistribution } from './RoleDistribution';

type CharacterSheetPanelProps = {
  characters: Character[];
  seatedPlayerCount: number;
  // Scroll to and flash this character when a seat is clicked; nonce re-triggers
  // the effect even when the same character is requested again.
  highlight?: { id: string; nonce: number } | null;
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
export function CharacterSheetPanel({ characters, seatedPlayerCount, highlight }: CharacterSheetPanelProps) {
  const categoryGroups = useMemo(() => groupByCategory(characters), [characters]);
  // Packs without category info render as one flat list instead of an "Unknown" group.
  const showCategoryHeadings = categoryGroups.some((group) => group.category.toLowerCase() !== 'unknown');

  const cardRefs = useRef(new Map<string, HTMLElement>());
  const [flashedCharacterId, setFlashedCharacterId] = useState<string | null>(null);

  useEffect(() => {
    if (!highlight) {
      return;
    }
    const card = cardRefs.current.get(highlight.id);
    if (!card) {
      return;
    }
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setFlashedCharacterId(highlight.id);
    const timer = window.setTimeout(() => setFlashedCharacterId(null), 1800);
    return () => window.clearTimeout(timer);
  }, [highlight]);

  return (
    <div className="character-sheet">
      {characters.length === 0 ? <p className="helper-text">No characters loaded.</p> : null}
      {categoryGroups.map((group) => (
        <section className="character-team" key={group.category}>
          {showCategoryHeadings ? <h3 className="tool-section-heading character-team-heading">{group.category}</h3> : null}
          {group.characters.map((character) => {
            const className = [
              'character-card',
              flashedCharacterId === character.id ? 'character-card-flash' : '',
            ].filter(Boolean).join(' ');

            return (
              <article
                className={className}
                key={character.id}
                ref={(element) => {
                  if (element) {
                    cardRefs.current.set(character.id, element);
                  } else {
                    cardRefs.current.delete(character.id);
                  }
                }}
              >
                {character.icon ? <img alt="" src={character.icon} /> : <span className="character-fallback" />}
                <div>
                  <strong>{character.name}</strong>
                  <p>{character.ability || 'No ability text.'}</p>
                </div>
              </article>
            );
          })}
        </section>
      ))}
      <RoleDistribution count={seatedPlayerCount} />
    </div>
  );
}
