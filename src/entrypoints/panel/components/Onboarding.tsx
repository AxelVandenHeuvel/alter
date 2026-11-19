import type { Settings } from '../../../lib/settings';
import { ApiKeyForm } from './ApiKeyForm';
import { ExternalIcon } from './icons';
import { Logo } from './Logo';

const CONSOLE_KEYS_URL = 'https://console.anthropic.com/settings/keys';

/** First run. Alter has no account and no servers: it talks straight to Claude with the user's own key. */
export function Onboarding({ settings, onKeySaved }: { settings: Settings; onKeySaved: () => void }) {
  return (
    <div className="empty empty--centered onboarding">
      <Logo size={40} />
      <h2>Welcome to Alter</h2>
      <p>No account and no servers. Alter talks directly to Claude from this browser, with your own Anthropic key.</p>

      <ol className="setup-steps onboarding-steps">
        <li>
          <span>Create a key in the Anthropic Console</span>
          <a className="button secondary small" href={CONSOLE_KEYS_URL} target="_blank" rel="noreferrer">
            Open <ExternalIcon size={12} />
          </a>
        </li>
        <li className="onboarding-key">
          <span>Paste it here</span>
          <ApiKeyForm model={settings.model} onSaved={onKeySaved} autoFocus />
        </li>
      </ol>
      <p className="muted small">
        The key stays in this browser and goes only to Anthropic. Alter shows what each request costs, and you can set a
        monthly limit in Settings.
      </p>
    </div>
  );
}
