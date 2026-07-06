/**
 * Night order panel.
 *
 * This collapsible panel shows first-night and other-night steps derived from
 * the uploaded character pack's night-order metadata. Steps whose character is
 * assigned to a player are highlighted so the storyteller sees at a glance
 * which roles to wake.
 */

import type { PackNightOrder, NightOrderStep } from '../nightOrder';

type NightOrderPanelProps = {
  activeTab: 'first' | 'other';
  inPlayCharacterNames: Set<string>;
  packNightOrder: PackNightOrder;
  onSetTab: (tab: 'first' | 'other') => void;
};

/** Render sorted first-night or other-night character instructions. */
export function NightOrderPanel({ activeTab, inPlayCharacterNames, packNightOrder, onSetTab }: NightOrderPanelProps) {
  function renderStep(step: NightOrderStep, phase: 'first' | 'other') {
    const isInPlay = inPlayCharacterNames.has(step.character);
    return (
      <li className={isInPlay ? 'night-step-in-play' : ''} key={`${phase}-${step.character}`}>
        <strong>{step.character}</strong>
        <span>{step.note}</span>
      </li>
    );
  }

  return (
    <div className="night-order-panel">
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
              {packNightOrder.firstNight.map((step) => renderStep(step, 'first'))}
            </ol>
          )
        ) : packNightOrder.otherNights.length === 0 ? (
          <p className="helper-text">No other-night order data is loaded. Re-upload the character pack if it contains night-order data.</p>
        ) : (
          <ol className="night-order-list">
            {packNightOrder.otherNights.map((step) => renderStep(step, 'other'))}
          </ol>
        )}
      </section>
    </div>
  );
}
