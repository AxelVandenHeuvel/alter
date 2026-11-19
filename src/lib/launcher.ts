import { BRAND } from './brand';
import { plural } from './format';
import { hostnameOf, isModifiable } from './host';
import { sendToPage } from './page-client';
import { getPatches } from './patches';
import { getSettings } from './settings';

/**
 * How Alter is opened: the toolbar icon, the right-click menu, and the keyboard
 * shortcut. All three are user gestures, which grant temporary access to the tab
 * (activeTab), so the page agent can be loaded to host the floating panel.
 */
export async function showPanel(tab: chrome.tabs.Tab | undefined, action: 'open' | 'toggle'): Promise<void> {
  if (tab?.id === undefined || !isModifiable(tab.url)) return;
  await sendToPage(tab.id, { type: 'alter:widget', action, tabId: tab.id });
}

export const CONTEXT_MENU_ID = 'open-alter';
export const TOGGLE_COMMAND = 'toggle-alter';
export const UNSUPPORTED_POPUP = 'unsupported.html';
const DEFAULT_TITLE = 'Open Alter';
/** Beside its icon in a menu of actions, the name says what clicking does. */
const MENU_TITLE = 'Alter';

/**
 * "Alter" in the page's right-click menu, on regular web pages only.
 * Menu items persist, so this runs on install and update; removing first keeps
 * it idempotent.
 */
export async function registerContextMenu(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: MENU_TITLE,
    contexts: ['page', 'selection', 'link', 'image'],
    documentUrlPatterns: ['http://*/*', 'https://*/*'],
  });
}

export function onContextMenuClick(info: chrome.contextMenus.OnClickData, tab: chrome.tabs.Tab | undefined): Promise<void> | null {
  if (info.menuItemId !== CONTEXT_MENU_ID || tab?.id === undefined) return null;
  return showPanel(tab, 'open');
}

/** How many saved changes are on for the hostname right now (none while everything is paused). */
export async function activeChangeCount(hostname: string | null): Promise<number> {
  if (!hostname) return 0;
  const [patches, settings] = await Promise.all([getPatches(hostname), getSettings()]);
  return settings.paused ? 0 : patches.filter((p) => p.enabled).length;
}

/**
 * Keep the toolbar icon in step with the tab's page. On pages Alter can't change
 * (browser pages, the Web Store) the icon opens a short note instead of doing nothing.
 * On sites with saved changes, a badge shows how many are on, so it's always clear
 * when a site looks different because of Alter.
 */
export async function syncActionForTab(tabId: number, url: string | undefined): Promise<void> {
  const modifiable = isModifiable(url);
  const count = modifiable ? await activeChangeCount(hostnameOf(url)) : 0;
  await Promise.all([
    chrome.action.setPopup({ tabId, popup: modifiable ? '' : UNSUPPORTED_POPUP }),
    chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' }),
    chrome.action.setTitle({
      tabId,
      title: count > 0 ? `${DEFAULT_TITLE} (${plural(count, 'saved change')} on here)` : DEFAULT_TITLE,
    }),
  ]);
}

/** The badge's look is the same in every tab; set it once per service worker start. */
export async function styleBadge(): Promise<void> {
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ color: BRAND.accent }),
    chrome.action.setBadgeTextColor({ color: '#ffffff' }),
  ]);
}

/** Bring every open tab's icon up to date (after a change to saved changes or settings). */
export async function syncAllTabs(hostname?: string): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => tab.id !== undefined && (hostname === undefined || hostnameOf(tab.url) === hostname))
      .map((tab) => syncActionForTab(tab.id!, tab.url).catch(() => undefined)),
  );
}
