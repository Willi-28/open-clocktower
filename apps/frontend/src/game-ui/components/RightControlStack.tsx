/**
 * Right-side control stack.
 *
 * This component composes character sheet, night order, reminder tokens, and
 * storyteller tools into the right edge dashboard.
 */

import type { Character, RoomState } from '../../api/client';
import type { PackNightOrder } from '../nightOrder';
import type { ReminderTokenOption } from '../reminderTokens';
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

/** Render all right-edge panels that belong beside the table. */
export function RightControlStack(props: RightControlStackProps) {
  return (
    <aside className="edge-panel right-edge control-stack">
      <CharacterSheetPanel characters={props.characters} />

      {props.isStoryteller ? (
        <NightOrderPanel
          activeTab={props.activeNightOrderTab}
          packNightOrder={props.packNightOrder}
          onSetTab={props.onSetNightOrderTab}
        />
      ) : null}

      <ReminderTokenPanel
        reminderTokenOptions={props.reminderTokenOptions}
        selectedReminderLabel={props.selectedReminderLabel}
        onToggleReminderToken={props.onToggleReminderToken}
      />

      {props.isStoryteller ? (
        <StorytellerToolsPanel {...props} />
      ) : null}
    </aside>
  );
}
