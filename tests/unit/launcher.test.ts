import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONTEXT_MENU_ID,
  onContextMenuClick,
  registerContextMenu,
  showPanel,
  syncActionForTab,
  UNSUPPORTED_POPUP,
} from '../../src/lib/launcher';
import { SETTINGS_KEY } from '../../src/lib/settings';

const chromeMock = {
  contextMenus: { removeAll: vi.fn(async () => {}), create: vi.fn() },
  // The page agent answers every message with an envelope.
  tabs: { sendMessage: vi.fn(async () => ({ ok: true, value: { ok: true, pageKey: '1', state: 'open' } })) },
  scripting: { executeScript: vi.fn(async () => []) },
  action: { setPopup: vi.fn(async () => {}), setBadgeText: vi.fn(async () => {}), setTitle: vi.fn(async () => {}) },
  storage: { local: { get: vi.fn(async (_key: unknown): Promise<Record<string, unknown>> => ({})) } },
};

const saved = (id: string, enabled: boolean) => ({ id, enabled, hostname: 'news.example', js: '', focus: undefined });

beforeEach(() => {
  vi.clearAllMocks();
  chromeMock.storage.local.get.mockImplementation(async () => ({}));
  vi.stubGlobal('chrome', chromeMock);
});

describe('opening Alter', () => {
  it('adds "Alter" to the right-click menu on web pages only, replacing any earlier copy', async () => {
    await registerContextMenu();
    expect(chromeMock.contextMenus.removeAll).toHaveBeenCalledBefore(chromeMock.contextMenus.create);
    expect(chromeMock.contextMenus.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: CONTEXT_MENU_ID, title: 'Alter', documentUrlPatterns: ['http://*/*', 'https://*/*'] }),
    );
  });

  it('asks the page to show the floating panel for its own tab', async () => {
    await onContextMenuClick({ menuItemId: CONTEXT_MENU_ID } as chrome.contextMenus.OnClickData, { id: 7, url: 'https://news.example/' } as chrome.tabs.Tab);
    expect(chromeMock.tabs.sendMessage).toHaveBeenLastCalledWith(7, { type: 'alter:widget', action: 'open', tabId: 7 });
    await showPanel({ id: 7, url: 'https://news.example/' } as chrome.tabs.Tab, 'toggle');
    expect(chromeMock.tabs.sendMessage).toHaveBeenLastCalledWith(7, { type: 'alter:widget', action: 'toggle', tabId: 7 });
  });

  it('does nothing on pages Alter cannot change, or for other menu items', async () => {
    await showPanel({ id: 7, url: 'chrome://settings/' } as chrome.tabs.Tab, 'toggle');
    expect(onContextMenuClick({ menuItemId: 'other' } as chrome.contextMenus.OnClickData, { id: 7 } as chrome.tabs.Tab)).toBeNull();
    expect(chromeMock.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('shows a short note from the icon on pages Alter cannot change', async () => {
    await syncActionForTab(3, 'chrome://newtab/');
    expect(chromeMock.action.setPopup).toHaveBeenLastCalledWith({ tabId: 3, popup: UNSUPPORTED_POPUP });
    await syncActionForTab(3, 'https://news.example/');
    expect(chromeMock.action.setPopup).toHaveBeenLastCalledWith({ tabId: 3, popup: '' });
  });

  it('badges the icon with how many saved changes are on for the site', async () => {
    chromeMock.storage.local.get.mockImplementation(async (key: unknown) =>
      key === SETTINGS_KEY ? {} : { 'patches:news.example': [saved('a', true), saved('b', false), saved('c', true)] },
    );
    await syncActionForTab(3, 'https://news.example/today');
    expect(chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 3, text: '2' });
    expect(chromeMock.action.setTitle).toHaveBeenLastCalledWith({ tabId: 3, title: 'Open Alter (2 saved changes on here)' });
  });

  it('shows no badge while everything is paused, or where nothing is saved', async () => {
    chromeMock.storage.local.get.mockImplementation(async (key: unknown) =>
      key === SETTINGS_KEY ? { [SETTINGS_KEY]: { paused: true } } : { 'patches:news.example': [saved('a', true)] },
    );
    await syncActionForTab(3, 'https://news.example/');
    expect(chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 3, text: '' });
    chromeMock.storage.local.get.mockImplementation(async () => ({}));
    await syncActionForTab(3, 'https://elsewhere.example/');
    expect(chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ tabId: 3, text: '' });
    expect(chromeMock.action.setTitle).toHaveBeenLastCalledWith({ tabId: 3, title: 'Open Alter' });
  });
});
