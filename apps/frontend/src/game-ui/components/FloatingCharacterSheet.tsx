/**
 * Floating, draggable character sheet.
 *
 * When detached from the right dashboard the character sheet becomes a small
 * window the player can drag around over the table by its title bar and resize
 * from any edge or corner, so the layout feels less static. Portaled to the body
 * so it floats above panels.
 */

import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';

import type { Character } from '../../api/client';
import { CharacterSheetPanel } from './CharacterSheetPanel';

type FloatingCharacterSheetProps = {
  characters: Character[];
  seatedPlayerCount: number;
  highlight?: { id: string; nonce: number } | null;
  position: { x: number; y: number };
  portalTarget?: HTMLElement | null;
  onMove: (position: { x: number; y: number }) => void;
  onReattach: () => void;
};

const MIN_WIDTH = 250;
const MIN_HEIGHT = 220;
const DEFAULT_WIDTH = 320;
const DEFAULT_HEIGHT = 440;

// Each resize handle names the edges it drags. 'e'/'s' grow, 'w'/'n' also shift
// the window's origin so the opposite edge stays put.
type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const RESIZE_HANDLES: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** Render the detached, draggable, resizable character-sheet window. */
export function FloatingCharacterSheet({
  characters,
  seatedPlayerCount,
  highlight,
  position,
  portalTarget,
  onMove,
  onReattach,
}: FloatingCharacterSheetProps) {
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [size, setSize] = useState({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  const resizeRef = useRef<{
    pointerId: number;
    dir: ResizeDir;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    originX: number;
    originY: number;
  } | null>(null);

  function handleTitlebarPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    const maxX = Math.max(8, window.innerWidth - size.width - 8);
    const maxY = Math.max(8, window.innerHeight - size.height - 8);
    onMove({
      x: Math.max(8, Math.min(maxX, drag.originX + event.clientX - drag.startX)),
      y: Math.max(8, Math.min(maxY, drag.originY + event.clientY - drag.startY)),
    });
  }

  function handleResizePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = resizeRef.current;
    if (!resize || event.pointerId !== resize.pointerId) {
      return;
    }
    const dx = event.clientX - resize.startX;
    const dy = event.clientY - resize.startY;
    let { originX, originY } = resize;
    let width = resize.startWidth;
    let height = resize.startHeight;

    if (resize.dir.includes('e')) {
      width = Math.max(MIN_WIDTH, Math.min(window.innerWidth - originX - 8, resize.startWidth + dx));
    }
    if (resize.dir.includes('s')) {
      height = Math.max(MIN_HEIGHT, Math.min(window.innerHeight - originY - 8, resize.startHeight + dy));
    }
    if (resize.dir.includes('w')) {
      // Dragging the left edge moves the origin while the right edge stays fixed.
      const rightEdge = resize.originX + resize.startWidth;
      const nextX = Math.max(8, Math.min(rightEdge - MIN_WIDTH, resize.originX + dx));
      width = rightEdge - nextX;
      originX = nextX;
    }
    if (resize.dir.includes('n')) {
      const bottomEdge = resize.originY + resize.startHeight;
      const nextY = Math.max(8, Math.min(bottomEdge - MIN_HEIGHT, resize.originY + dy));
      height = bottomEdge - nextY;
      originY = nextY;
    }

    setSize({ width, height });
    if (originX !== resize.originX || originY !== resize.originY) {
      onMove({ x: originX, y: originY });
    }
  }

  return createPortal(
    <div className="floating-sheet" style={{ left: position.x, top: position.y, width: size.width, height: size.height }}>
      <div
        className="floating-sheet-titlebar"
        onPointerDown={(event) => {
          if ((event.target instanceof Element && event.target.closest('button')) || event.button !== 0) {
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
          dragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: position.x,
            originY: position.y,
          };
        }}
        onPointerMove={handleTitlebarPointerMove}
        onPointerUp={(event) => {
          dragRef.current = null;
          // Dropping the window over the right dashboard re-docks the sheet.
          const dropTarget = document.elementFromPoint(event.clientX, event.clientY);
          if (dropTarget instanceof Element && (dropTarget.closest('.right-dashboard') || dropTarget.closest('[data-characters-tab]'))) {
            onReattach();
          }
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      >
        <strong>Characters</strong>
        <button className="floating-sheet-reattach" onClick={onReattach} aria-label="Reattach to dashboard" title="Reattach to dashboard" type="button">
          ⤡
        </button>
      </div>
      <div className="floating-sheet-body">
        <CharacterSheetPanel
          characters={characters}
          highlight={highlight}
          seatedPlayerCount={seatedPlayerCount}
        />
      </div>
      {RESIZE_HANDLES.map((dir) => (
        <div
          key={dir}
          className={`floating-sheet-resize floating-sheet-resize-${dir}`}
          aria-hidden="true"
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            resizeRef.current = {
              pointerId: event.pointerId,
              dir,
              startX: event.clientX,
              startY: event.clientY,
              startWidth: size.width,
              startHeight: size.height,
              originX: position.x,
              originY: position.y,
            };
          }}
          onPointerMove={handleResizePointerMove}
          onPointerUp={() => {
            resizeRef.current = null;
          }}
          onPointerCancel={() => {
            resizeRef.current = null;
          }}
        />
      ))}
    </div>,
    portalTarget ?? document.body,
  );
}
