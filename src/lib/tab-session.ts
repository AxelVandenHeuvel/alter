/**
 * Per-tab state that belongs to one page load, kept in chrome.storage.session so every
 * extension context (the background, each tab's panel) sees the same thing. It ends when
 * the tab loads a new document or closes.
 */

const conversationKey = (tabId: number) => `conversation:${tabId}`;
const suppressedKey = (tabId: number) => `suppressed:${tabId}`;

/** The tab's conversation with Alter, so it survives closing and reopening the panel. */
export async function loadConversation<T>(tabId: number): Promise<T | undefined> {
  const key = conversationKey(tabId);
  return (await chrome.storage.session.get(key))[key] as T | undefined;
}

export async function storeConversation(tabId: number, value: unknown): Promise<void> {
  await chrome.storage.session.set({ [conversationKey(tabId)]: value });
}

export async function removeConversation(tabId: number): Promise<void> {
  await chrome.storage.session.remove(conversationKey(tabId));
}

/**
 * While a revision of a saved change is previewed in a tab, the saved version is
 * kept off in that tab.
 */
export async function setSuppressed(tabId: number, patchId: string | null): Promise<void> {
  if (patchId) await chrome.storage.session.set({ [suppressedKey(tabId)]: patchId });
  else await chrome.storage.session.remove(suppressedKey(tabId));
}

export async function getSuppressed(tabId: number): Promise<string | null> {
  const key = suppressedKey(tabId);
  return ((await chrome.storage.session.get(key))[key] as string | undefined) ?? null;
}

/**
 * A tab loaded a new page or closed: previews and revisions in progress belonged to
 * the old page (which took its preview with it), so forget their session state.
 */
export async function forgetTabSession(tabId: number): Promise<void> {
  await chrome.storage.session.remove([suppressedKey(tabId), conversationKey(tabId)]);
}
