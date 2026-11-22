import { useEffect, useState } from 'react';
import { formatCost } from '../../../agent/pricing';
import { plural } from '../../../lib/format';
import { deleteAllPatches, type SiteSummary } from '../../../lib/patches';
import { clearApiKey, getApiKey } from '../../../lib/secrets';
import { LOOKS, MODELS, updateSettings, type Settings } from '../../../lib/settings';
import { RELEASES_PAGE } from '../../../lib/updates';
import { useSiteSummaries, useSpend, useToggleShortcut } from '../hooks';
import { ApiKeyForm } from './ApiKeyForm';
import { CheckIcon, ExternalIcon } from './icons';
import { openExtensionDetails } from './ScriptSetup';
import { Toggle } from './Toggle';

export function SettingsView({
  settings,
  scriptsAvailable,
  update,
  onKeyChanged,
}: {
  settings: Settings;
  scriptsAvailable: boolean | null;
  /** A newer release's version, when one is out. */
  update: string | null;
  onKeyChanged: () => void;
}) {
  const [keyHint, setKeyHint] = useState<string | null | undefined>(undefined);

  const loadKey = () => void getApiKey().then((key) => setKeyHint(key ? `••••${key.slice(-4)}` : null));
  useEffect(loadKey, []);

  return (
    <div className="settings">
      <section className="settings-section">
        <h3>AI model</h3>
            <div className="radio-list" role="radiogroup" aria-label="Claude model">
              {MODELS.map((model) => (
                <label key={model.id} className={`radio ${settings.model === model.id ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="model"
                    checked={settings.model === model.id}
                    onChange={() => void updateSettings({ model: model.id })}
                  />
                  <span className="radio-label">{model.label}</span>
                  <span className="radio-hint">{model.hint}</span>
                </label>
              ))}
            </div>
            <div className="settings-subsection">
              <p className="field-label">Anthropic API key</p>
              {keyHint ? (
                <div className="key-saved">
                  <span>
                    Key saved <code>{keyHint}</code>
                  </span>
                  <button
                    className="button secondary danger small"
                    type="button"
                    onClick={async () => {
                      await clearApiKey();
                      loadKey();
                      onKeyChanged();
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                keyHint === null && (
                  <ApiKeyForm
                    model={settings.model}
                    onSaved={() => {
                      loadKey();
                      onKeyChanged();
                    }}
                  />
                )
              )}
              <p className="muted">Stored only in this browser profile and sent only to Anthropic.</p>
            </div>
      </section>

      <section className="settings-section">
        <h3>Look</h3>
        <div className="radio-list" role="radiogroup" aria-label="Look">
          {LOOKS.map((look) => (
            <label key={look.id} className={`radio ${settings.look === look.id ? 'selected' : ''}`}>
              <input type="radio" name="look" checked={settings.look === look.id} onChange={() => void updateSettings({ look: look.id })} />
              <span className="radio-label">{look.label}</span>
              <span className="radio-hint">{look.hint}</span>
            </label>
          ))}
        </div>
      </section>

      <UsageSection limit={settings.monthlyLimit} />

      <section className="settings-section">
        <div className="setting-row">
          <div>
            <h3>Scripts</h3>
            <p className="muted">
              Lets Alter run scripts you approve, for changes CSS can't make. Chrome requires turning on “Allow User
              Scripts” for Alter once.
            </p>
          </div>
          {scriptsAvailable ? (
            <span className="status-on">
              <CheckIcon size={12} /> On
            </span>
          ) : (
            <button className="button secondary small" type="button" onClick={openExtensionDetails}>
              Turn on
            </button>
          )}
        </div>
      </section>

      <section className="settings-section">
        <div className="setting-row">
          <div>
            <h3>Pause all changes</h3>
            <p className="muted">Turns off every saved change on every site until you resume.</p>
          </div>
          <Toggle checked={settings.paused} label="Pause all changes" onChange={(paused) => void updateSettings({ paused })} />
        </div>
      </section>

      <SitesSection />

      <ShortcutSection />

      <section className="settings-section">
        <h3>Privacy</h3>
        <p className="muted">
          Alter has no account and no servers. When you ask for a change, it sends an outline of the current page straight
          to Anthropic. Form values are never sent, and email addresses and long numbers are removed first. Screenshots you attach go to Claude as
          they are, so select only what you mean. Scripts only run after you approve them, never on sign-in, email,
          banking, or password manager sites, and can't reach the internet.
        </p>
        <p className="muted">
          On sites Alter can access, it keeps a copy of the data the site itself loads, in that tab only, so changes can
          show things the site has but doesn't display. It never makes requests of its own. Only what Claude looks up in
          it while making a change is sent, like the page outline.
        </p>
        <p className="muted">
          When a change converts prices, Alter downloads the European Central Bank's exchange rates through frankfurter.dev,
          at most twice a day. That request asks only for the rates and carries nothing about your pages.
        </p>
        <p className="muted">
          Once a day, Alter asks GitHub whether a newer version is out. That request carries nothing about your pages
          either.
        </p>
      </section>

      <VersionSection update={update} />
    </div>
  );
}

/** The installed version, and where to get a newer one: copies installed from GitHub don't update themselves. */
function VersionSection({ update }: { update: string | null }) {
  return (
    <section className="settings-section version-section" data-testid="version">
      <div className="setting-row">
        <div>
          <h3>Version {chrome.runtime.getManifest().version}</h3>
          <p className="muted">{update ? `Version ${update} is out.` : 'Alter checks for a newer version once a day.'}</p>
        </div>
        <a className={`button ${update ? 'primary' : 'secondary'} small`} href={RELEASES_PAGE} target="_blank" rel="noreferrer">
          {update ? 'Download' : 'Releases'} <ExternalIcon size={12} />
        </a>
      </div>
    </section>
  );
}

/** Every site with saved changes, so they can be found and cleared without visiting each one. */
function SitesSection() {
  const sites = useSiteSummaries();
  if (!sites) return null;
  return (
    <section className="settings-section">
      <h3>Sites you've changed</h3>
      {sites.length === 0 ? (
        <p className="muted">Nothing saved yet. Changes you save show up here.</p>
      ) : (
        <ul className="site-list">
          {sites.map((site) => (
            <SiteRow key={site.hostname} site={site} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SiteRow({ site }: { site: SiteSummary }) {
  const [confirming, setConfirming] = useState(false);
  // Asking twice is enough of a safeguard; the question goes away on its own.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  return (
    <li className="site-row" data-testid="site-row">
      <span className="site-name">{site.hostname}</span>
      <span className="site-count">
        {plural(site.total, 'change')}
        {site.enabled < site.total && ` · ${site.enabled} on`}
      </span>
      <button
        className={`button secondary small ${confirming ? 'danger' : ''}`}
        type="button"
        onClick={() => (confirming ? void deleteAllPatches(site.hostname) : setConfirming(true))}
        aria-label={confirming ? `Confirm removing every change on ${site.hostname}` : `Remove every change on ${site.hostname}`}
      >
        {confirming ? 'Remove all?' : 'Remove'}
      </button>
    </li>
  );
}

function ShortcutSection() {
  const shortcut = useToggleShortcut();
  return (
    <section className="settings-section">
      <div className="setting-row">
        <div>
          <h3>Keyboard shortcut</h3>
          <p className="muted">
            {shortcut ? (
              <>
                <kbd>{shortcut}</kbd> opens and closes Alter on any page.
              </>
            ) : (
              'Set a shortcut to open and close Alter from the keyboard.'
            )}
          </p>
        </div>
        <button
          className="button secondary small"
          type="button"
          onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}
        >
          Change <ExternalIcon size={12} />
        </button>
      </div>
    </section>
  );
}

/** What the user's key has spent through Alter this month, and an optional limit. */
function UsageSection({ limit }: { limit: number | null }) {
  const spend = useSpend();
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? (limit === null ? '' : limit.toFixed(2));

  // Saved when the field loses focus or on Enter; an empty field means no limit.
  const commit = () => {
    if (draft === null) return;
    const amount = Number.parseFloat(draft.replace(/[$,\s]/g, ''));
    void updateSettings({ monthlyLimit: draft.trim() === '' || !(amount > 0) ? null : Math.round(amount * 100) / 100 });
    setDraft(null);
  };

  const share = spend && limit ? Math.min(1, spend.cost / limit) : 0;
  return (
    <section className="settings-section">
      <h3>Usage this month</h3>
      {spend && (
        <p className="usage-summary" data-testid="usage-summary">
          <span className="usage-amount">{formatCost(spend.cost)}</span>
          <span className="muted">
            {plural(spend.requests, 'request')}
            {limit !== null && ` · ${formatCost(limit)} limit`}
          </span>
        </p>
      )}
      {limit !== null && (
        <div className={`meter ${share >= 1 ? 'meter--full' : ''}`} role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={spend?.cost ?? 0} aria-label="Spent of monthly limit">
          <span style={{ width: `${share * 100}%` }} />
        </div>
      )}
      <label className="limit-field">
        <span>Monthly limit</span>
        <span className="money-input">
          <span aria-hidden="true">$</span>
          <input
            className="input"
            inputMode="decimal"
            placeholder="No limit"
            value={value}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            aria-label="Monthly limit in US dollars"
          />
        </span>
      </label>
      <p className="muted">
        Worked out from each response&apos;s token usage at Anthropic&apos;s prices, in this browser only. Your bill in the
        Anthropic Console is the final word.
      </p>
    </section>
  );
}
