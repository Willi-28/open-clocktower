/**
 * Credits and attribution.
 *
 * Two sources are shown together: the attribution the room's character pack
 * declares in its manifest, and the app's own third-party notices. Both are
 * license obligations rather than decoration, so this view is reachable from
 * the setup screen and from client settings during a game.
 */

import type { CreditEntry, PackCredits } from '../../api/client';
import { aiDisclosure, appCreditSections, appLicenseSummary, unofficialNotice } from '../appCredits';
import { useUiText } from '../../i18n';

/** Whether the room's pack credits have arrived yet. */
export type CreditsStatus = 'loading' | 'ready' | 'error';

type CreditsViewProps = {
  packCredits: PackCredits | null;
  status: CreditsStatus;
};

/** Render one credited person and what they are credited for. */
function CreditRow({ entry }: { entry: CreditEntry }) {
  return (
    <li className="credit-row">
      <span className="credit-name">{entry.url ? <CreditLink label={entry.name} url={entry.url} /> : entry.name}</span>
      {entry.role ? <span className="credit-role">{entry.role}</span> : null}
      {entry.works.length > 0 ? <span className="credit-works">{entry.works.join(', ')}</span> : null}
    </li>
  );
}

/**
 * Render an external link from pack data.
 *
 * The server only stores http(s) credit URLs, and noreferrer keeps a pack from
 * learning where its players came from.
 */
function CreditLink({ label, url }: { label: string; url: string }) {
  return (
    <a href={url} rel="noreferrer noopener" target="_blank">
      {label}
    </a>
  );
}

/**
 * Explain an empty pack section.
 *
 * A pack declaring no credits is normal - the manifest block is optional - so
 * that case must read differently from a request that has not landed or failed.
 */
function packPlaceholder(status: CreditsStatus) {
  if (status === 'loading') {
    return 'Loading pack credits...';
  }
  if (status === 'error') {
    return 'The credits for this character pack could not be loaded.';
  }
  return 'This character pack declares no credits. Pack authors can add an optional "credits" block to their manifest.';
}

/** Render pack attribution followed by the app's own third-party notices. */
export function CreditsView({ packCredits, status }: CreditsViewProps) {
  const t = useUiText();
  const hasPackCredits =
    packCredits !== null &&
    Boolean(
      packCredits.pack_name ||
        packCredits.author ||
        packCredits.license ||
        packCredits.notice ||
        packCredits.entries.length,
    );

  return (
    <div className="credits-view">
      <section className="credits-section">
        <h3>{t('Character Pack')}</h3>
        {hasPackCredits && packCredits ? (
          <>
            {packCredits.pack_name ? (
              <p className="credits-lead">
                {packCredits.url ? <CreditLink label={packCredits.pack_name} url={packCredits.url} /> : packCredits.pack_name}
              </p>
            ) : null}
            <dl className="credits-facts">
              {packCredits.author ? (
                <>
                  <dt>{t('Author')}</dt>
                  <dd>{packCredits.author}</dd>
                </>
              ) : null}
              {packCredits.license ? (
                <>
                  <dt>{t('License')}</dt>
                  <dd>{packCredits.license_url ? <CreditLink label={packCredits.license} url={packCredits.license_url} /> : packCredits.license}</dd>
                </>
              ) : null}
            </dl>
            {packCredits.notice ? <p className="credits-notice">{packCredits.notice}</p> : null}
            {packCredits.entries.length > 0 ? (
              <ul className="credit-list">
                {packCredits.entries.map((entry) => (
                  <CreditRow entry={entry} key={`${entry.name}:${entry.role}`} />
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <p className="helper-text">{t(packPlaceholder(status))}</p>
        )}
      </section>

      <section className="credits-section">
        <h3>Open Clocktower</h3>
        <p className="credits-notice">{t(unofficialNotice)}</p>
        <p className="credits-notice">{t(appLicenseSummary)}</p>
        <p className="credits-notice">{t(aiDisclosure)}</p>
      </section>

      {appCreditSections.map((section) => (
        <section className="credits-section" key={section.title}>
          <h3>{t(section.title)}</h3>
          <ul className="credit-list">
            {section.items.map((item) => (
              <li className="credit-row" key={item.name}>
                <span className="credit-name">{item.url ? <CreditLink label={item.name} url={item.url} /> : item.name}</span>
                <span className="credit-role">{item.license}</span>
                <span className="credit-works">{t(item.detail)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
