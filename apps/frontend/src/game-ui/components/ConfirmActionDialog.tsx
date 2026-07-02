type ConfirmActionDialogProps = {
  confirmLabel: string;
  message: string;
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
  onCancel,
  onConfirm,
  title,
  variant = 'default',
}: ConfirmActionDialogProps) {
  return (
    <div className="confirm-dialog-backdrop" role="presentation" onClick={onCancel}>
      <section
        aria-modal="true"
        aria-label={title}
        className={variant === 'danger' ? 'confirm-dialog danger-confirm' : 'confirm-dialog'}
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="button-row">
          <button className={variant === 'danger' ? 'danger-button' : ''} onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
          <button className="secondary" onClick={onCancel} type="button">
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}
