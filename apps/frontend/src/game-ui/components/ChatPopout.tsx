/**
 * Floating text-chat window.
 *
 * The text chat lives in a pop-out window toggled from the voice panel: it can
 * be dragged by its title bar, resized from any edge or corner, minimized to
 * the title bar, and closed again from the voice panel toggle. Portaled to the
 * app shell so it floats above the table and side panels.
 */

import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

type ChatPopoutProps = {
  children: ReactNode;
  isMinimized: boolean;
  onClose: () => void;
  onMove: (position: { x: number; y: number }) => void;
  onResize: (size: { width: number; height: number }) => void;
  onToggleMinimized: () => void;
  portalTarget?: HTMLElement | null;
  position: { x: number; y: number };
  size: { width: number; height: number };
};

const MIN_WIDTH = 260;
const MIN_HEIGHT = 220;

// Each resize handle names the edges it drags. 'e'/'s' grow, 'w'/'n' also shift
// the window's origin so the opposite edge stays put.
type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const RESIZE_HANDLES: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** Render the floating, draggable, resizable text chat window. */
export function ChatPopout({
  children,
  isMinimized,
  onClose,
  onMove,
  onResize,
  onToggleMinimized,
  portalTarget,
  position,
  size,
}: ChatPopoutProps) {
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
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
    const maxY = Math.max(8, window.innerHeight - 48);
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

    onResize({ width, height });
    if (originX !== resize.originX || originY !== resize.originY) {
      onMove({ x: originX, y: originY });
    }
  }

  return createPortal(
    <div
      className={isMinimized ? 'chat-popout minimized' : 'chat-popout'}
      style={{ left: position.x, top: position.y, width: size.width, height: isMinimized ? undefined : size.height }}
    >
      <div
        className="chat-popout-titlebar"
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
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      >
        <strong>Text Chat</strong>
        <span className="chat-popout-buttons">
          <button
            aria-label={isMinimized ? 'Restore chat window' : 'Minimize chat window'}
            title={isMinimized ? 'Restore' : 'Minimize'}
            onClick={onToggleMinimized}
            type="button"
          >
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              {isMinimized ? <path d="M12 5v14M5 12h14" /> : <path d="M5 12h14" />}
            </svg>
          </button>
          <button aria-label="Close chat window" title="Close" onClick={onClose} type="button">
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </span>
      </div>
      {!isMinimized ? <div className="chat-popout-body">{children}</div> : null}
      {!isMinimized
        ? RESIZE_HANDLES.map((dir) => (
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
          ))
        : null}
    </div>,
    portalTarget ?? document.body,
  );
}
