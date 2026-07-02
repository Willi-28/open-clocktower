/**
 * Demon bluff slot editor.
 *
 * The storyteller uses this compact bar to choose up to three bluff characters
 * after character data has been imported for the room.
 */

import type { Character } from '../../api/client';

type DemonBluffBarProps = {
  characters: Character[];
  demonBluffIds: string[];
  onSelectSlot: (slotIndex: number | null) => void;
  onSetDemonBluffSlot: (slotIndex: number, characterId: string) => void;
  selectedBluffSlot: number | null;
};

/**
 * Lets the storyteller view and edit the three demon bluff slots.
 */
export function DemonBluffBar({
  characters,
  demonBluffIds,
  onSelectSlot,
  onSetDemonBluffSlot,
  selectedBluffSlot,
}: DemonBluffBarProps) {
  return (
    <div className="demon-bluff-bar">
      {[0, 1, 2].map((slotIndex) => {
        const character = characters.find((item) => item.id === demonBluffIds[slotIndex]);
        return (
          <div className="demon-bluff-slot" key={slotIndex}>
            <button onClick={() => onSelectSlot(selectedBluffSlot === slotIndex ? null : slotIndex)} type="button">
              {character?.icon ? <img alt="" src={character.icon} /> : <span>{slotIndex + 1}</span>}
            </button>
            {selectedBluffSlot === slotIndex ? (
              <select
                autoFocus
                value={character?.id ?? ''}
                onChange={(event) => {
                  onSelectSlot(null);
                  onSetDemonBluffSlot(slotIndex, event.target.value);
                }}
              >
                <option value="">Empty</option>
                {characters.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
