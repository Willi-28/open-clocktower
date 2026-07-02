import type { PackNightOrder } from '../nightOrder';

type NightOrderPanelProps = {
  activeTab: 'first' | 'other';
  packNightOrder: PackNightOrder;
  onSetTab: (tab: 'first' | 'other') => void;
};

export function NightOrderPanel({ activeTab, packNightOrder, onSetTab }: NightOrderPanelProps) {
  return (
    <details className="panel compact night-order-panel">
      <summary>Night Order</summary>
      <div className="segmented-control night-order-tabs" role="tablist" aria-label="Night order phase">
        <button className={activeTab === 'first' ? 'active' : ''} onClick={() => onSetTab('first')} type="button">
          First Night
        </button>
        <button className={activeTab === 'other' ? 'active' : ''} onClick={() => onSetTab('other')} type="button">
          Other Nights
        </button>
      </div>
      <section className="night-order-section">
        {activeTab === 'first' ? (
          packNightOrder.firstNight.length === 0 ? (
            <p className="helper-text">No first-night order data is loaded. Re-upload the character pack if it contains night-order data.</p>
          ) : (
            <ol className="night-order-list">
              {packNightOrder.firstNight.map((step) => (
                <li key={`first-${step.character}`}>
                  <strong>{step.character}</strong>
                  <span>{step.note}</span>
                </li>
              ))}
            </ol>
          )
        ) : packNightOrder.otherNights.length === 0 ? (
          <p className="helper-text">No other-night order data is loaded. Re-upload the character pack if it contains night-order data.</p>
        ) : (
          <ol className="night-order-list">
            {packNightOrder.otherNights.map((step) => (
              <li key={`other-${step.character}`}>
                <strong>{step.character}</strong>
                <span>{step.note}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </details>
  );
}
