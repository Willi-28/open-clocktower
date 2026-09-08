/**
 * Confirmation dialog component.
 *
 * Storyteller actions such as deleting rooms or showing the board use this
 * modal so high-impact decisions stay explicit and reversible until confirmed.
 */

import { useUiText } from '../../i18n';

type ConfirmActionDialogProps = {
  confirmLabel: string;
  message: string;
  messageValues?: Record<string, string | number>;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  variant?: 'default' | 'danger';
};

/**
 * Presents high-impact storyteller actions without falling back to browser chrome.
 */
export function ConfirmActionDialog({
  confirmLabel,
  message,
  messageValues,
  onCancel,
  onConfirm,
  title,
  variant = 'default',
}: ConfirmActionDialogProps) {
  const t = useUiText();
  return (
    <div className="confirm-dialog-backdrop" role="presentation" onClick={onCancel}>
      <section
        aria-modal="true"
        aria-label={t(title)}
        className={variant === 'danger' ? 'confirm-dialog danger-confirm' : 'confirm-dialog'}
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{t(title)}</h2>
        <p>{t(message, messageValues)}</p>
        <div className="button-row">
          <button className={variant === 'danger' ? 'danger-button' : ''} onClick={onConfirm} type="button">
            {t(confirmLabel)}
          </button>
          <button className="secondary" onClick={onCancel} type="button">{t('Cancel')}</button>
        </div>
      </section>
    </div>
  );
}
