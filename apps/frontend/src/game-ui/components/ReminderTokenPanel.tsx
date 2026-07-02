import type { ReminderTokenOption } from '../reminderTokens';

type ReminderTokenPanelProps = {
  reminderTokenOptions: ReminderTokenOption[];
  selectedReminderLabel: string;
  onToggleReminderToken: (tokenId: string) => void;
};

export function ReminderTokenPanel({
  reminderTokenOptions,
  selectedReminderLabel,
  onToggleReminderToken,
}: ReminderTokenPanelProps) {
  return (
    <details className="panel compact reminder-panel">
      <summary>Reminder Tokens</summary>
      <div className="reminder-symbol-grid">
        {reminderTokenOptions.length === 0 ? <p className="helper-text">No reminder token PNGs loaded.</p> : null}
        {reminderTokenOptions.map((token) => (
          <button
            className={selectedReminderLabel === token.id ? 'reminder-symbol selected' : 'reminder-symbol'}
            key={token.id}
            onClick={() => onToggleReminderToken(token.id)}
            title={token.title}
            type="button"
          >
            <img alt="" src={token.icon} />
            <span>{token.label}</span>
          </button>
        ))}
      </div>
    </details>
  );
}
