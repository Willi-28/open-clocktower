/**
 * Right-side control dashboard.
 *
 * A single tabbed panel that switches between the character sheet, night order,
 * reminder tokens, and storyteller tools instead of stacking four separate
 * slide-out drawers. It can be minimized to a slim rail to give the table more
 * room. Night order and storyteller tools are storyteller-only.
 */

import { useEffect, useState } from 'react';

import type { Character, RoomState } from '../../api/client';
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

        {!isMinimized ? (
          <div className="dashboard-body">
            {activeTab === 'characters' ? (
              <CharacterSheetPanel characters={props.characters} seatedPlayerCount={seatedPlayerCount(props.room)} />
            ) : null}

            {activeTab === 'night' && isStoryteller ? (
              <NightOrderPanel
                activeTab={props.activeNightOrderTab}
                packNightOrder={props.packNightOrder}
                onSetTab={props.onSetNightOrderTab}
              />
            ) : null}

            {activeTab === 'reminders' ? (
              <ReminderTokenPanel
                reminderTokenOptions={props.reminderTokenOptions}
                selectedReminderLabel={props.selectedReminderLabel}
                onToggleReminderToken={props.onToggleReminderToken}
              />
            ) : null}

            {activeTab === 'tools' && isStoryteller ? <StorytellerToolsPanel {...props} /> : null}
          </div>
        ) : null}
      </section>
    </aside>
  );
}
