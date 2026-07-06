/**
 * Right-side control dashboard.
 *
 * A single tabbed panel that switches between the character sheet, night order,
 * reminder tokens, and storyteller tools instead of stacking four separate
 * slide-out drawers. It can be minimized to a slim rail to give the table more
 * room. Night order and storyteller tools are storyteller-only.
 */

import { useEffect, useMemo, useState } from 'react';

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

/** Render the right-edge dashboard as one tabbed, minimizable panel beside the table. */
export function RightControlStack(props: RightControlStackProps) {
  const { isStoryteller } = props;
  const tabs: { id: DashboardTabId; label: string }[] = [
    { id: 'characters', label: 'Characters' },
    ...(isStoryteller ? [{ id: 'night' as DashboardTabId, label: 'Order' }] : []),
    { id: 'reminders', label: 'Tokens' },
    ...(isStoryteller ? [{ id: 'tools' as DashboardTabId, label: 'Tools' }] : []),
  ];
  const [activeTab, setActiveTab] = useState<DashboardTabId>('characters');
  const [isMinimized, setIsMinimized] = useState(false);

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

  // When the storyteller role changes the available tabs change too; fall back to
  // the always-present Characters tab if the active one is no longer offered.
  useEffect(() => {
    if (isStoryteller) {
      return;
    }
    if (activeTab === 'night' || activeTab === 'tools') {
      setActiveTab('characters');
    }
  }, [isStoryteller, activeTab]);

  return (
    <aside className={`edge-panel right-edge control-stack${isMinimized ? ' minimized' : ''}`}>
      <section className="right-dashboard panel" aria-label="Table dashboard">
        <div className="dashboard-tabs">
          {!isMinimized ? (
            <div className="dashboard-tab-list" role="tablist" aria-label="Table dashboards">
              {tabs.map((tab) => (
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
              ))}
            </div>
          ) : null}
          <button
            aria-label={isMinimized ? 'Expand dashboard' : 'Minimize dashboard'}
            className="dashboard-collapse"
            onClick={() => setIsMinimized((minimized) => !minimized)}
            title={isMinimized ? 'Expand dashboard' : 'Minimize dashboard'}
            type="button"
          >
            {isMinimized ? '‹' : '›'}
          </button>
        </div>

        <div className="dashboard-body" hidden={isMinimized}>
          {/* All panels stay mounted and only hide, so per-panel state such as
            * opened <details> sections survives switching tabs and minimizing
            * the dashboard. */}
          <div hidden={activeTab !== 'characters'}>
            <CharacterSheetPanel characters={props.characters} seatedPlayerCount={seatedPlayerCount(props.room)} />
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
