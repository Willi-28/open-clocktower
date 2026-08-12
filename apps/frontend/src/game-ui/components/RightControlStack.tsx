/**
 * Right-side control dashboard.
 *
 * A single tabbed panel that switches between the character sheet, night order,
 * reminder tokens, and storyteller tools instead of stacking four separate
 * slide-out drawers. It can be minimized to a slim rail to give the table more
 * room. Night order and storyteller tools are storyteller-only.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { Character, CharacterAssignment, RoomState } from '../../api/client';
import type { PackNightOrder } from '../nightOrder';
import type { ReminderTokenOption } from '../reminderTokens';
import { seatedPlayerCount } from '../voting';
import { CharacterSheetPanel } from './CharacterSheetPanel';
import { NightOrderPanel } from './NightOrderPanel';
import { ReminderTokenPanel } from './ReminderTokenPanel';
import { StorytellerToolsPanel } from './StorytellerToolsPanel';
import type { StorytellerToolsPanelProps } from './StorytellerToolsPanel';

type RightControlStackProps = StorytellerToolsPanelProps & {
  activeNightOrderTab: 'first' | 'other';
  assignments: CharacterAssignment[];
  characterHighlight?: { id: string; nonce: number } | null;
  characterSheetFloating: boolean;
  onDetachCharacterSheet: (clientX: number, clientY: number) => void;
  onReattachCharacterSheet: () => void;
  isMinimized: boolean;
  onToggleMinimized: () => void;
  onResizeDashboard: (widthPx: number) => void;
  characters: Character[];
  isStoryteller: boolean;
  packNightOrder: PackNightOrder;
  reminderTokenOptions: ReminderTokenOption[];
  room: RoomState;
  selectedReminderLabel: string;
  onSetNightOrderTab: (tab: 'first' | 'other') => void;
  onToggleReminderToken: (tokenId: string) => void;
};

type DashboardTabId = 'characters' | 'night' | 'reminders' | 'tools';

/** Pop-out glyph: a window with an arrow escaping through the top-right corner. */
function PopOutIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" />
      <path d="M14 4h6v6" />
      <path d="M20 4 11.5 12.5" />
    </svg>
  );
}

/** Render the right-edge dashboard as one tabbed, minimizable panel beside the table. */
export function RightControlStack(props: RightControlStackProps) {
  const { isStoryteller } = props;
  // On desktop (mouse) tokens are placed/removed by right-clicking the table, so
  // the Tokens tab only appears on touch devices that cannot right-click.
  const [isCoarsePointer, setIsCoarsePointer] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)');
    const handleChange = () => setIsCoarsePointer(query.matches);
    query.addEventListener?.('change', handleChange);
    return () => query.removeEventListener?.('change', handleChange);
  }, []);

  const tabs: { id: DashboardTabId; label: string }[] = [
    { id: 'characters', label: 'Characters' },
    ...(isStoryteller ? [{ id: 'night' as DashboardTabId, label: 'Order' }] : []),
    ...(isCoarsePointer ? [{ id: 'reminders' as DashboardTabId, label: 'Tokens' }] : []),
    ...(isStoryteller ? [{ id: 'tools' as DashboardTabId, label: 'Tools' }] : []),
  ];
  const [activeTab, setActiveTab] = useState<DashboardTabId>('characters');
  const isMinimized = props.isMinimized;
  // Dragging the Characters tab out detaches the sheet; a plain click switches
  // to it (or reattaches it when it is floating).
  const tabDragRef = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean; detached: boolean } | null>(null);
  // Edge handle: drag to resize the dashboard width, click to collapse/expand.
  const asideRef = useRef<HTMLElement | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number; lastWidth: number; moved: boolean; frame: number | null } | null>(null);

  // Character names currently assigned to a player, for the night order panel
  // to highlight which roles the storyteller actually has to wake.
  const inPlayCharacterNames = useMemo(() => {
    const nameById = new Map(props.characters.map((character) => [character.id, character.name]));
    return new Set(
      props.assignments
        .map((assignment) => nameById.get(assignment.character_id))
        .filter((name): name is string => Boolean(name)),
    );
  }, [props.assignments, props.characters]);

  /** Keep dashboard widths inside usable desktop limits. */
  function clampDashboardWidth(widthPx: number) {
    return Math.max(240, Math.min(560, widthPx));
  }

  /** Paint resize movement immediately; React commits the final width on release. */
  function paintDashboardWidth(widthPx: number) {
    asideRef.current?.parentElement?.style.setProperty('--desktop-right-panel', `${widthPx}px`);
  }

  /** Batch live resize paints to the next animation frame for smoother dragging. */
  function queueDashboardWidth(widthPx: number) {
    const resize = resizeRef.current;
    if (!resize) {
      return;
    }
    resize.lastWidth = widthPx;
    if (resize.frame !== null) {
      return;
    }
    resize.frame = window.requestAnimationFrame(() => {
      resize.frame = null;
      paintDashboardWidth(resize.lastWidth);
    });
  }

  /** Finish resize and commit the last painted width to React state. */
  function finishDashboardResize(commit: boolean) {
    const resize = resizeRef.current;
    resizeRef.current = null;
    asideRef.current?.classList.remove('resizing');
    if (!resize) {
      return;
    }
    if (resize.frame !== null) {
      window.cancelAnimationFrame(resize.frame);
      paintDashboardWidth(resize.lastWidth);
    }
    if (commit && resize.moved && !isMinimized) {
      props.onResizeDashboard(resize.lastWidth);
    }
  }

  // When the storyteller role changes the available tabs change too; fall back to
  // the always-present Characters tab if the active one is no longer offered.
  useEffect(() => {
    if ((!isStoryteller && (activeTab === 'night' || activeTab === 'tools')) || (!isCoarsePointer && activeTab === 'reminders')) {
      setActiveTab('characters');
    }
  }, [isStoryteller, isCoarsePointer, activeTab]);

  return (
    <aside ref={asideRef} className={`edge-panel right-edge control-stack${isMinimized ? ' minimized' : ''}`}>
      <button
        className="dashboard-edge-handle"
        aria-label={isMinimized ? 'Show dashboard' : 'Hide dashboard'}
        title={isMinimized ? 'Show dashboard – drag to resize' : 'Hide dashboard – drag to resize'}
        onPointerDown={(event) => {
          if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) {
            return;
          }
          resizeRef.current = {
            startX: event.clientX,
            startWidth: asideRef.current?.getBoundingClientRect().width ?? 340,
            lastWidth: asideRef.current?.getBoundingClientRect().width ?? 340,
            moved: false,
            frame: null,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          const resize = resizeRef.current;
          if (!resize) {
            return;
          }
          const dx = resize.startX - event.clientX;
          if (!resize.moved && Math.abs(dx) > 4) {
            resize.moved = true;
            asideRef.current?.classList.add('resizing');
          }
          if (resize.moved && !isMinimized) {
            event.preventDefault();
            queueDashboardWidth(clampDashboardWidth(resize.startWidth + dx));
          }
        }}
        onPointerUp={() => {
          const resize = resizeRef.current;
          if (!resize) {
            return;
          }
          if (!resize?.moved) {
            finishDashboardResize(false);
            props.onToggleMinimized();
          } else {
            finishDashboardResize(true);
          }
        }}
        onPointerCancel={() => {
          finishDashboardResize(false);
        }}
        type="button"
      >
        <span className="dashboard-edge-grip" aria-hidden="true">{isMinimized ? '‹' : '›'}</span>
      </button>
      <section className="right-dashboard panel" aria-label="Table dashboard">
        <div className="dashboard-tabs">
            <div className="dashboard-tab-list" role="tablist" aria-label="Table dashboards">
              {tabs.map((tab) => {
                if (tab.id === 'characters') {
                  // Draggable: drag out to detach the sheet, click to select/reattach.
                  return (
                    <button
                      aria-selected={activeTab === tab.id}
                      className={[
                        activeTab === tab.id ? 'dashboard-tab active' : 'dashboard-tab',
                        'dashboard-tab-characters',
                        props.characterSheetFloating ? 'detached' : '',
                      ].filter(Boolean).join(' ')}
                      data-characters-tab=""
                      key={tab.id}
                      onPointerDown={(event) => {
                        if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) {
                          return;
                        }
                        tabDragRef.current = {
                          pointerId: event.pointerId,
                          startX: event.clientX,
                          startY: event.clientY,
                          moved: false,
                          detached: false,
                        };
                        event.currentTarget.setPointerCapture(event.pointerId);
                      }}
                      onPointerMove={(event) => {
                        const drag = tabDragRef.current;
                        if (!drag || drag.pointerId !== event.pointerId) {
                          return;
                        }
                        if (Math.abs(event.clientX - drag.startX) > 5 || Math.abs(event.clientY - drag.startY) > 5) {
                          drag.moved = true;
                        }
                        if (drag.moved && (!props.characterSheetFloating || drag.detached)) {
                          event.preventDefault();
                          drag.detached = true;
                          props.onDetachCharacterSheet(event.clientX, event.clientY);
                        }
                      }}
                      onPointerUp={(event) => {
                        const drag = tabDragRef.current;
                        tabDragRef.current = null;
                        if (drag?.detached) {
                          return;
                        }
                        if (props.characterSheetFloating) {
                          props.onReattachCharacterSheet();
                        } else {
                          setActiveTab('characters');
                        }
                      }}
                      onPointerCancel={() => {
                        tabDragRef.current = null;
                      }}
                      role="tab"
                      title={props.characterSheetFloating ? 'Click to reattach the character sheet' : 'Drag out to detach the character sheet'}
                      type="button"
                    >
                      {tab.label}
                      <span className="dashboard-tab-detach-hint" aria-hidden="true"><PopOutIcon /></span>
                    </button>
                  );
                }
                return (
                  <button
                    aria-selected={activeTab === tab.id}
                    className={activeTab === tab.id ? 'dashboard-tab active' : 'dashboard-tab'}
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    role="tab"
                    type="button"
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
        </div>

        <div className="dashboard-body" hidden={isMinimized}>
          {/* All panels stay mounted and only hide, so per-panel state such as
            * opened <details> sections survives switching tabs and minimizing
            * the dashboard. */}
          <div hidden={activeTab !== 'characters'}>
            {props.characterSheetFloating ? (
              <button className="sheet-detached-note" onClick={props.onReattachCharacterSheet} type="button">
                <span className="sheet-detached-icon" aria-hidden="true"><PopOutIcon /></span>
                <span>Character sheet is floating on the table.<br />Click here (or drag it back) to reattach.</span>
              </button>
            ) : (
              <CharacterSheetPanel
                characters={props.characters}
                highlight={activeTab === 'characters' && !isMinimized ? props.characterHighlight : null}
                seatedPlayerCount={seatedPlayerCount(props.room)}
              />
            )}
          </div>

          {isStoryteller ? (
            <div hidden={activeTab !== 'night'}>
              <NightOrderPanel
                activeTab={props.activeNightOrderTab}
                inPlayCharacterNames={inPlayCharacterNames}
                packNightOrder={props.packNightOrder}
                onSetTab={props.onSetNightOrderTab}
              />
            </div>
          ) : null}

          <div hidden={activeTab !== 'reminders'}>
            <ReminderTokenPanel
              reminderTokenOptions={props.reminderTokenOptions}
              selectedReminderLabel={props.selectedReminderLabel}
              onToggleReminderToken={props.onToggleReminderToken}
            />
          </div>

          {isStoryteller ? (
            <div hidden={activeTab !== 'tools'}>
              <StorytellerToolsPanel {...props} />
            </div>
          ) : null}
        </div>
      </section>
    </aside>
  );
}
