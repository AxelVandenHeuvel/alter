import { useEffect, useState } from 'react';
import { AnthropicProvider } from '../../agent/anthropic';
import type { ModelProvider } from '../../agent/provider';
import { describeHealth } from '../../lib/health-status';
import { originPattern } from '../../lib/host';
import { askPageIfPresent } from '../../lib/page-client';
import { getApiKey } from '../../lib/secrets';
import { getSettings, updateSettings } from '../../lib/settings';
import { captureArea, type Attachment } from './attachments';
import { Composer, type Draft } from './components/Composer';
import { EmptyState } from './components/EmptyState';
import { ArrowLeftIcon, CloseIcon, MinusIcon, PauseIcon, SettingsIcon } from './components/icons';
import { Logo } from './components/Logo';
import { Onboarding } from './components/Onboarding';
import { SavedList } from './components/SavedList';
import { SettingsView } from './components/SettingsView';
import { Thread } from './components/Thread';
import { conversationKey, conversations, useConversation } from './conversations';
import { healthContext, usePageHealth } from './health';
import {
  useAvailableUpdate,
  useHasApiKey,
  useHostPermission,
  usePanelTab,
  useSavedPatches,
  useSettings,
  useUserScriptsAvailable,
  type ActiveTab,
} from './hooks';

/** Running as the floating panel on a page (an iframe), rather than as a standalone page. */
const EMBEDDED = new URLSearchParams(location.search).get('embedded') === '1';

/** Ask the page hosting the floating panel to minimize or close it. */
function widgetAction(tabId: number, action: 'minimize' | 'close') {
  return askPageIfPresent(tabId, { type: 'alter:widget', action, tabId });
}

async function createProvider(): Promise<ModelProvider> {
  const settings = await getSettings();
  if (import.meta.env.ALTER_E2E) {
    const { FakeProvider } = await import('../../agent/fake');
    return new FakeProvider();
  }
  const key = await getApiKey();
  if (!key) throw new Error('Add your Anthropic API key in Settings first.');
  return new AnthropicProvider(key, settings.model);
}

export function App() {
  const [view, setView] = useState<'chat' | 'settings'>('chat');
  const [draft, setDraft] = useState<Draft | null>(null);
  const update = useAvailableUpdate();
  const tab = usePanelTab();
  const settings = useSettings();
  const { hasKey, refresh: refreshKey } = useHasApiKey();
  const hostname = tab?.modifiable ? tab.hostname : null;
  const granted = useHostPermission(hostname);
  const patches = useSavedPatches(hostname);
  const key = tab && hostname ? conversationKey(tab.id, hostname) : null;
  const conversation = useConversation(key);
  const scriptsAvailable = useUserScriptsAvailable();
  const previewRecord = conversation?.previewId ? conversation.proposals[conversation.previewId] : undefined;
  const health = usePageHealth(
    tab?.id ?? null,
    Boolean(hostname && granted),
    patches,
    previewRecord?.id ?? null,
    Boolean(previewRecord?.proposal.js),
  );
  const previewHealth = previewRecord
    ? describeHealth(previewRecord.proposal, health?.changes.preview, healthContext(health, scriptsAvailable))
    : null;

  // Reopening Alter brings back this tab's conversation, if it belongs to the page that's open.
  useEffect(() => {
    if (tab && hostname) void conversations.restore(tab.id, hostname);
  }, [tab, hostname]);

  // Escape tucks the floating panel away, like closing a popover; the conversation stays.
  const tabId = tab?.id ?? null;
  useEffect(() => {
    if (!EMBEDDED || tabId === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing) void widgetAction(tabId, 'minimize');
    };
    addEventListener('keydown', onKeyDown);
    return () => removeEventListener('keydown', onKeyDown);
  }, [tabId]);

  // ⌘↵ (Ctrl+↵) saves the change being previewed, from anywhere in the panel.
  const savableId = previewRecord?.state === 'preview' && !conversation?.running ? previewRecord.id : null;
  useEffect(() => {
    if (!key || !savableId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey) || event.isComposing) return;
      event.preventDefault();
      void conversations.save(key, savableId);
    };
    addEventListener('keydown', onKeyDown);
    return () => removeEventListener('keydown', onKeyDown);
  }, [key, savableId]);

  if (!settings || hasKey === null) return <div className="app" />;

  /** Alter needs access to the site to read and change it. Must run first in a click handler (user gesture). */
  const ensureAccess = async (): Promise<boolean> =>
    Boolean(hostname) && (granted || (await chrome.permissions.request({ origins: [originPattern(hostname!)] })));

  const send = async (text: string, attachments: Attachment[] = []): Promise<boolean> => {
    if (!tab || !hostname || !(await ensureAccess())) return false;
    void conversations.send(tab.id, hostname, text, createProvider, attachments);
    return true;
  };

  const selectArea = async (): Promise<Attachment | null> => {
    if (!tab || !(await ensureAccess())) return null;
    return captureArea(tab.id);
  };

  const ready = hasKey;
  const inChat = view === 'chat' && ready && hostname !== null;
  const hasThread = (conversation?.items.length ?? 0) > 0;
  const lastMessage = conversation?.items.findLast((item) => item.kind === 'user')?.text ?? null;

  return (
    <div className="app">
      <header className="header">
        {view === 'settings' ? (
          <button className="icon-button" type="button" onClick={() => setView('chat')} aria-label="Back">
            <ArrowLeftIcon />
          </button>
        ) : (
          <Logo size={20} />
        )}
        {/* A breadcrumb: Alter, then the site it's working on (or Settings). */}
        <div className="header-title">
          <span className="header-name">Alter</span>
          {(view === 'settings' || hostname) && <span className="header-separator">/</span>}
          {view === 'settings' ? (
            <span className="header-place">Settings</span>
          ) : (
            hostname && (
              <span className="header-place">
                <SiteIcon tab={tab} />
                <span className="header-host">{hostname}</span>
              </span>
            )
          )}
        </div>
        <div className="header-actions">
          {view === 'chat' && (
            <button
              className={`icon-button ${update ? 'has-update' : ''}`}
              type="button"
              onClick={() => setView('settings')}
              aria-label={update ? `Settings (version ${update} is available)` : 'Settings'}
              title={update ? `Settings: version ${update} is available` : 'Settings'}
            >
              <SettingsIcon />
            </button>
          )}
          {EMBEDDED && tab && (
            <>
              <button
                className="icon-button"
                type="button"
                onClick={() => void widgetAction(tab.id, 'minimize')}
                aria-label="Minimize"
                title="Minimize"
              >
                <MinusIcon />
              </button>
              <button className="icon-button" type="button" onClick={() => void widgetAction(tab.id, 'close')} aria-label="Close" title="Close">
                <CloseIcon />
              </button>
            </>
          )}
        </div>
      </header>

      {settings.paused && view === 'chat' && <PausedBanner />}

      {view === 'chat' && ready && hostname && (
        <SavedList
          patches={patches}
          paused={settings.paused}
          revisingId={previewRecord?.proposal.revises ?? null}
          health={health}
          scriptsAvailable={scriptsAvailable}
          onRevise={(patch) => setDraft({ id: Date.now(), text: `Change “${patch.title}”: ` })}
        />
      )}

      {/* Keyed by view, so switching between the conversation and Settings starts at the top. */}
      <main className="main" key={view}>
        {view === 'settings' ? (
          <SettingsView settings={settings} scriptsAvailable={scriptsAvailable} update={update} onKeyChanged={refreshKey} />
        ) : !ready ? (
          <Onboarding settings={settings} onKeySaved={refreshKey} />
        ) : !hostname ? (
          <Unsupported />
        ) : conversation && hasThread ? (
          <Thread
            conversation={conversation}
            scriptsAvailable={scriptsAvailable}
            previewHealth={previewHealth}
            onSave={(id) => conversations.save(conversation.key, id)}
            onDiscard={(id) => conversations.discard(conversation.key, id)}
            onAnswer={(id, approved) => conversations.answer(id, approved)}
            onCompare={(showOriginal) => void askPageIfPresent(conversation.tabId, { type: 'alter:compare', showOriginal })}
          />
        ) : (
          <EmptyState tabId={tab!.id} hostname={hostname} onPick={(text) => void send(text)} />
        )}
      </main>

      {inChat && (
        <footer className="footer">
          <Composer
            placeholder={hasThread ? 'Ask for a tweak…' : 'Describe a change…'}
            running={conversation?.running ?? false}
            draft={draft}
            lastMessage={lastMessage}
            onSend={send}
            onStop={() => key && conversations.stop(key)}
            onSelectArea={selectArea}
          />
          {granted === false && <p className="footer-hint">Alter will ask for access to {hostname} first.</p>}
        </footer>
      )}
    </div>
  );
}

/** The site's favicon, when it has one that loads. */
function SiteIcon({ tab }: { tab: ActiveTab | null }) {
  const [failed, setFailed] = useState(false);
  if (!tab?.favIconUrl || failed || !tab.modifiable) return null;
  return <img className="site-icon" src={tab.favIconUrl} width={14} height={14} alt="" onError={() => setFailed(true)} />;
}

function PausedBanner() {
  return (
    <div className="banner">
      <PauseIcon size={12} />
      <span>All saved changes are paused.</span>
      <button className="link" type="button" onClick={() => void updateSettings({ paused: false })}>
        Resume
      </button>
    </div>
  );
}

function Unsupported() {
  return (
    <div className="empty empty--centered">
      <Logo size={48} muted />
      <h2>Open a website to start</h2>
      <p>Alter works on regular web pages. Browser pages like settings, new tabs, and the Chrome Web Store can't be changed.</p>
    </div>
  );
}
