import { useCallback, useEffect, useState } from 'react';
import { hostnameOf, isModifiable, originPattern } from '../../lib/host';
import { TOGGLE_COMMAND } from '../../lib/launcher';
import { getPatches, getSiteSummaries, hostnameFromKey, normalizePatch, storageKey, type Patch, type SiteSummary } from '../../lib/patches';
import { getApiKey } from '../../lib/secrets';
import { getSettings, SETTINGS_KEY, type Settings } from '../../lib/settings';
import { getSpend, SPEND_KEY, type MonthlySpend } from '../../lib/spend';
import { isNewer, latestRelease } from '../../lib/updates';
import { userScriptsAvailable } from '../../lib/userscripts';
import { conversations } from './conversations';

export interface ActiveTab {
  id: number;
  url: string;
  hostname: string | null;
  modifiable: boolean;
  title: string;
  favIconUrl: string | undefined;
}

function toActiveTab(tab: chrome.tabs.Tab | undefined): ActiveTab | null {
  if (!tab?.id) return null;
  const url = tab.url ?? '';
  return {
    id: tab.id,
    url,
    hostname: hostnameOf(url),
    modifiable: isModifiable(url),
    title: tab.title ?? '',
    favIconUrl: tab.favIconUrl,
  };
}

/** The tab this panel belongs to. Each tab gets its own panel, opened with ?tabId=. */
const PANEL_TAB_ID = Number(new URLSearchParams(location.search).get('tabId')) || null;

/** The tab the panel works on, kept up to date as it navigates. */
export function usePanelTab(): ActiveTab | null {
  const [tab, setTab] = useState<ActiveTab | null>(null);

  useEffect(() => {
    if (PANEL_TAB_ID === null) return;
    const tabId = PANEL_TAB_ID;
    void chrome.tabs
      .get(tabId)
      .then((found) => setTab(toActiveTab(found)))
      .catch(() => setTab(null));

    const onUpdated = (updatedId: number, change: chrome.tabs.OnUpdatedInfo, updated: chrome.tabs.Tab) => {
      if (updatedId === tabId && (change.url || change.title || change.favIconUrl)) setTab(toActiveTab(updated));
    };
    // A new document (reload or navigation; not in-page history changes) ends the conversation.
    const onCommitted = (details: chrome.webNavigation.WebNavigationTransitionCallbackDetails) => {
      if (details.tabId === tabId && details.frameId === 0) conversations.pageChanged(tabId);
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.webNavigation.onCommitted.addListener(onCommitted);
    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.webNavigation.onCommitted.removeListener(onCommitted);
    };
  }, []);

  return tab;
}

/**
 * State loaded for a specific key (a hostname). Results are tagged with the key
 * they belong to, so a stale result never shows for a different site and no
 * synchronous reset is needed when the key changes.
 */
function useKeyedState<T>(key: string | null, initial: T): [T, (key: string, value: T) => void] {
  const [state, setState] = useState<{ key: string; value: T } | null>(null);
  const set = useCallback((forKey: string, value: T) => setState({ key: forKey, value }), []);
  return [state && state.key === key ? state.value : initial, set];
}

/** Whether Alter may read and change pages on the hostname, or null while unknown. */
export function useHostPermission(hostname: string | null): boolean | null {
  const [granted, setGranted] = useKeyedState<boolean | null>(hostname, null);

  useEffect(() => {
    if (!hostname) return;
    const check = () =>
      void chrome.permissions.contains({ origins: [originPattern(hostname)] }).then((result) => setGranted(hostname, result));
    check();
    chrome.permissions.onAdded.addListener(check);
    chrome.permissions.onRemoved.addListener(check);
    return () => {
      chrome.permissions.onAdded.removeListener(check);
      chrome.permissions.onRemoved.removeListener(check);
    };
  }, [hostname, setGranted]);

  return granted;
}

const NO_PATCHES: Patch[] = [];

export function useSavedPatches(hostname: string | null): Patch[] {
  const [patches, setPatches] = useKeyedState<Patch[]>(hostname, NO_PATCHES);

  useEffect(() => {
    if (!hostname) return;
    void getPatches(hostname).then((result) => setPatches(hostname, result));
    const key = storageKey(hostname);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[key]) {
        setPatches(hostname, ((changes[key].newValue as Patch[] | undefined) ?? NO_PATCHES).map(normalizePatch));
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [hostname, setPatches]);

  return patches;
}

export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    void getSettings().then(setSettings);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[SETTINGS_KEY]) void getSettings().then(setSettings);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  return settings;
}

/** Whether an API key is stored. `refresh` re-reads it after Settings changes it. */
export function useHasApiKey(): { hasKey: boolean | null; refresh: () => void } {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // E2E builds use a scripted model and need no key.
    const load = import.meta.env.ALTER_E2E ? Promise.resolve(true) : getApiKey().then(Boolean);
    void load.then((value) => {
      if (!cancelled) setHasKey(value);
    });
    return () => {
      cancelled = true;
    };
  }, [version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return { hasKey, refresh };
}

/**
 * Whether "Allow User Scripts" is on for Alter. Chrome has no event for the
 * toggle, but the API appears live, so poll while the panel is open.
 */
export function useUserScriptsAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    const check = () =>
      void userScriptsAvailable().then((value) => {
        if (!cancelled) setAvailable(value);
      });
    check();
    const timer = setInterval(check, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  return available;
}

/** The keyboard shortcut that opens and closes Alter (e.g. "⇧⌘Y"), or null if the user removed it. */
export function useToggleShortcut(): string | null {
  const [shortcut, setShortcut] = useState<string | null>(null);
  useEffect(() => {
    void chrome.commands.getAll().then((commands) => setShortcut(commands.find((c) => c.name === TOGGLE_COMMAND)?.shortcut || null));
  }, []);
  return shortcut;
}

/** Every site with saved changes, kept up to date. Null while loading. */
export function useSiteSummaries(): SiteSummary[] | null {
  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  useEffect(() => {
    const load = () => void getSiteSummaries().then(setSites);
    load();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && Object.keys(changes).some((key) => hostnameFromKey(key) !== null)) load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  return sites;
}

/** This month's spending on the user's Anthropic key, kept up to date. Null while loading. */
export function useSpend(): MonthlySpend | null {
  const [spend, setSpend] = useState<MonthlySpend | null>(null);
  useEffect(() => {
    const load = () => void getSpend().then(setSpend);
    load();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[SPEND_KEY]) load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);
  return spend;
}

/** A newer release's version when one is out, else null. Checks GitHub at most once a day. */
export function useAvailableUpdate(): string | null {
  const [update, setUpdate] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void latestRelease().then((latest) => {
      if (!cancelled && latest && isNewer(latest, chrome.runtime.getManifest().version)) setUpdate(latest);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return update;
}
