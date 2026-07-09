/**
 * Demon bluff slot editor.
 *
 * The storyteller uses this compact bar to choose up to three bluff characters
 * after character data has been imported for the room. The character picker is
 * portaled so it always sits above the side dashboards.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { Character } from '../../api/client';

type DemonBluffBarProps = {
  characters: Character[];
  demonBluffIds: string[];
  portalTarget?: HTMLElement | null;
  onSetDemonBluffSlot: (slotIndex: number, characterId: string) => void;
};

/**
 * Lets the storyteller view and edit the three demon bluff slots.
 */
export function DemonBluffBar({ characters, demonBluffIds, portalTarget, onSetDemonBluffSlot }: DemonBluffBarProps) {
  const [picker, setPicker] = useState<{ slotIndex: number; left: number; bottom: number } | null>(null);

  // Close the picker on any outside click or Escape.
  useEffect(() => {
    if (!picker) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('.demon-bluff-picker') && !event.target.closest('.demon-bluff-slot')) {
        setPicker(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPicker(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [picker]);

  return (
    <div className="demon-bluff-bar">
      {[0, 1, 2].map((slotIndex) => {
        const character = characters.find((item) => item.id === demonBluffIds[slotIndex]);
        return (
          <div className="demon-bluff-slot" key={slotIndex}>
            <button
              onClick={(event) => {
                if (picker?.slotIndex === slotIndex) {
                  setPicker(null);
                  return;
                }
                const rect = event.currentTarget.getBoundingClientRect();
                setPicker({
                  slotIndex,
                  left: Math.min(rect.left, window.innerWidth - 232),
                  bottom: window.innerHeight - rect.top + 8,
                });
              }}
              type="button"
            >
              {character?.icon ? <img alt="" src={character.icon} /> : <span>{slotIndex + 1}</span>}
            </button>
          </div>
        );
      })}

      {picker
        ? createPortal(
            <div className="demon-bluff-picker" style={{ position: 'fixed', left: Math.max(12, picker.left), bottom: picker.bottom }}>
              <button
                onClick={() => {
                  onSetDemonBluffSlot(picker.slotIndex, '');
                  setPicker(null);
                }}
                type="button"
              >
                <span className="demon-bluff-picker-fallback" aria-hidden="true">✕</span>
                Empty
              </button>
              {characters.map((option) => (
                <button
                  key={option.id}
                  onClick={() => {
                    onSetDemonBluffSlot(picker.slotIndex, option.id);
                    setPicker(null);
                  }}
                  type="button"
                >
                  {option.icon ? <img alt="" src={option.icon} /> : <span className="demon-bluff-picker-fallback" aria-hidden="true" />}
                  {option.name}
                </button>
              ))}
            </div>,
            portalTarget ?? document.body,
          )
        : null}
    </div>
  );
}
