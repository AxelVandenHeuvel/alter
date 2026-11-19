import {
  onContextMenuClick,
  registerContextMenu,
  showPanel,
  styleBadge,
  syncActionForTab,
  syncAllTabs,
  TOGGLE_COMMAND,
} from '../lib/launcher';
import { getPatchedHostnames, hostnameFromKey, storageKey, type Patch } from '../lib/patches';
import { RATES_KEY } from '../lib/rates';
import { refreshOpenTabs, SYNC_REQUEST, syncRegistration } from '../lib/registration';
import { SETTINGS_KEY } from '../lib/settings';
import { forgetTabSession } from '../lib/tab-session';
import { reconcileHost, refreshRatesForSavedScripts, syncRegisteredScripts } from '../lib/userscripts';

export default defineBackground(() => {
  // Alter floats over the page it's working on: the icon and the shortcut toggle it, the menu opens it.
  const reportOpenError = (error: unknown) => console.error('Alter: could not open the panel', error);
  chrome.action.onClicked.addListener((tab) => void showPanel(tab, 'toggle').catch(reportOpenError));
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === TOGGLE_COMMAND) void showPanel(tab, 'toggle').catch(reportOpenError);
  });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    onContextMenuClick(info, tab)?.catch(reportOpenError);
  });

  // The toolbar icon follows each tab's page: a note on pages Alter can't change, a badge on altered sites.
  void styleBadge();
  void syncAllTabs();
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.url || change.status === 'complete') void syncActionForTab(tabId, tab.url);
  });

  // Serialize all sync work so overlapping events can't interleave register/unregister calls.
  let queue = Promise.resolve();
  const enqueue = (label: string, task: () => Promise<unknown>) => {
    queue = queue.then(task).then(
      () => undefined,
      (error: unknown) => console.error(`Alter: ${label} failed`, error),
    );
  };
  const syncAll = () => {
    enqueue('content script sync', syncRegistration);
    enqueue('user script sync', syncRegisteredScripts);
  };
  const reconcileAllHosts = () =>
    enqueue('tab reconcile', async () => Promise.all((await getPatchedHostnames()).map((h) => reconcileHost(h))));

  chrome.runtime.onInstalled.addListener(() => {
    // Menu items persist across restarts, so they're (re)created only on install and update.
    registerContextMenu().catch((error: unknown) => console.error('Alter: could not add the menu item', error));
    // User scripts are cleared when the extension updates, so re-register on every install event.
    syncAll();
    // Open pages still run the previous copy of Alter; give them a fresh one, then restart their scripts.
    enqueue('refresh open tabs', refreshOpenTabs);
    reconcileAllHosts();
  });
  chrome.runtime.onStartup.addListener(syncAll);
  // The panel waits for this after saving (see registrationsSettled).
  chrome.runtime.onMessage.addListener((message: { type?: unknown } | null, _sender, respond) => {
    if (message?.type !== SYNC_REQUEST) return false;
    syncAll();
    void queue.then(() => respond(true));
    return true;
  });

  // A saved change that converts prices runs with the rates Alter had when it was registered.
  // Freshen them when the browser starts, only if such a change is saved; new rates re-register
  // the scripts (below). Not in the sync queue, so a slow download can't hold up the rest.
  chrome.runtime.onStartup.addListener(
    () => void refreshRatesForSavedScripts().catch((error: unknown) => console.error('Alter: exchange rate refresh failed', error)),
  );
  chrome.permissions.onAdded.addListener(syncAll);
  chrome.permissions.onRemoved.addListener(syncAll);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const hostnames = Object.keys(changes).flatMap((key) => hostnameFromKey(key) ?? []);
    const settingsChanged = Boolean(changes[SETTINGS_KEY]);
    if (changes[RATES_KEY]) enqueue('user script sync', syncRegisteredScripts);
    if (hostnames.length === 0 && !settingsChanged) return;
    syncAll();
    // Apply the change to open tabs right away: start, stop, or update scripts, and update the badge.
    if (settingsChanged) {
      reconcileAllHosts();
      void syncAllTabs();
    }
    for (const hostname of hostnames) {
      const change = changes[storageKey(hostname)]!;
      const before = (change.oldValue as Patch[] | undefined) ?? [];
      const after = (change.newValue as Patch[] | undefined) ?? [];
      const removed = before.filter((p) => !after.some((q) => q.id === p.id)).map((p) => p.id);
      enqueue('tab reconcile', () => reconcileHost(hostname, removed));
      if (!settingsChanged) void syncAllTabs(hostname);
    }
  });

  // A conversation and its preview belong to one page load. When the tab loads a new document
  // (reload or navigation, not in-page history changes) or closes, they end, even with Alter closed.
  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId === 0) void forgetTabSession(details.tabId);
  });
  chrome.tabs.onRemoved.addListener((tabId) => void forgetTabSession(tabId));
});
