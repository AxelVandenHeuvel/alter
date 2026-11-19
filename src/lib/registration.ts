import { hostnameOf, originPattern } from './host';
import { PAGE_AGENT_FILE, PAGE_DATA_FILE } from './page-client';
import { getPatchedHostnames } from './patches';

const SCRIPT_ID = 'alter-saved-patches';
/** Asks the background to bring every registration up to date now, and answers once it has. */
export const SYNC_REQUEST = 'alter:sync-registrations';
const PAGE_DATA_ID = 'alter-page-data';

/**
 * Register the page agent at document_start on every host that has saved
 * patches and still grants host access, so patches apply before first paint.
 * Idempotent; safe to call on any change.
 */
export async function syncRegistration(): Promise<string[]> {
  const hostnames = await getPatchedHostnames();
  const granted: string[] = [];
  for (const hostname of hostnames) {
    if (await chrome.permissions.contains({ origins: [originPattern(hostname)] })) granted.push(hostname);
  }

  await putContentScript(
    SCRIPT_ID,
    granted.length > 0
      ? { id: SCRIPT_ID, matches: granted.map(originPattern), js: [PAGE_AGENT_FILE], runAt: 'document_start', allFrames: false, persistAcrossSessions: true }
      : null,
  );
  await syncPageDataRegistration();
  return granted;
}

/**
 * Keep copies of the data sites load from the very start of each page load, on every
 * site Alter has access to, so change scripts (and Alter, while making them) can use it.
 */
async function syncPageDataRegistration(): Promise<void> {
  const { origins = [] } = await chrome.permissions.getAll();
  const matches = origins.filter((origin) => /^(\*|https?):\/\//.test(origin) || origin === '<all_urls>');
  await putContentScript(
    PAGE_DATA_ID,
    matches.length > 0 ? { id: PAGE_DATA_ID, matches, js: [PAGE_DATA_FILE], runAt: 'document_start', world: 'MAIN', allFrames: false, persistAcrossSessions: true } : null,
  );
}

/**
 * Make a registered content script match `script`, or remove it when null. An existing one is
 * updated in place: unregistering and registering again would leave a moment where pages that
 * start loading run without it (no saved changes, no copies of the site's data).
 */
async function putContentScript(id: string, script: chrome.scripting.RegisteredContentScript | null): Promise<void> {
  const exists = (await chrome.scripting.getRegisteredContentScripts({ ids: [id] })).length > 0;
  if (!script) {
    if (exists) await chrome.scripting.unregisterContentScripts({ ids: [id] });
    return;
  }
  if (exists) await chrome.scripting.updateContentScripts([script]);
  else await chrome.scripting.registerContentScripts([script]);
}

/**
 * After Alter installs or updates, pages that were already open still run the old
 * copy of the page agent, which can no longer hear changes. Load a fresh copy into
 * every open tab on a host with saved changes; it takes over from the old one
 * (which removes its styles), so those pages keep working without a refresh.
 */
export async function refreshOpenTabs(): Promise<void> {
  for (const hostname of await syncRegistration()) {
    const tabs = await chrome.tabs.query({ url: originPattern(hostname) });
    for (const tab of tabs) {
      if (tab.id === undefined || hostnameOf(tab.url) !== hostname) continue;
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [PAGE_AGENT_FILE] }).catch(() => undefined);
    }
  }
}

/**
 * Wait until pages that start loading get what storage now says: the background registers
 * changes when storage changes, a moment after a save. Saving waits for this, so a page
 * reloaded right after "Saved" already has the change.
 */
export async function registrationsSettled(): Promise<void> {
  await chrome.runtime.sendMessage({ type: SYNC_REQUEST }).catch(() => undefined);
}
