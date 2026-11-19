import type { Envelope, PageRequest, PageResponse } from './messages';

/** The page agent's built file (from src/entrypoints/page.content.ts). */
export const PAGE_AGENT_FILE = 'content-scripts/page.js';
/** Keeps copies of the data the site loads, in the page's main world (from src/entrypoints/page-data.content.ts). */
export const PAGE_DATA_FILE = 'content-scripts/page-data.js';

export class PageUnavailableError extends Error {}

async function rawSend<R extends PageRequest>(tabId: number, request: R): Promise<PageResponse<R['type']>> {
  const envelope = (await chrome.tabs.sendMessage(tabId, request)) as Envelope<PageResponse<R['type']>> | undefined;
  if (!envelope) throw new PageUnavailableError('The page did not respond.');
  if (!envelope.ok) throw new Error(envelope.error);
  return envelope.value;
}

/** Inject the page agent if it isn't running in the tab yet. Requires host permission. */
export async function ensurePageAgent(tabId: number): Promise<void> {
  try {
    await rawSend(tabId, { type: 'alter:ping' });
    return;
  } catch {
    // Not injected yet (or the page navigated); inject below.
  }
  try {
    // Start keeping the site's data now, if it wasn't registered before the page loaded; it ignores a second copy.
    await chrome.scripting.executeScript({ target: { tabId }, files: [PAGE_DATA_FILE], world: 'MAIN', injectImmediately: true });
    await chrome.scripting.executeScript({ target: { tabId }, files: [PAGE_AGENT_FILE] });
  } catch (error) {
    throw new PageUnavailableError(
      `Alter can't access this page: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  await rawSend(tabId, { type: 'alter:ping' });
}

/**
 * Ask the page agent only if it is already running there; never inject it.
 * For background polling, which shouldn't put Alter into a page by itself.
 */
export async function askPageIfPresent<R extends PageRequest>(tabId: number, request: R): Promise<PageResponse<R['type']> | null> {
  try {
    return await rawSend(tabId, request);
  } catch {
    return null;
  }
}

export async function sendToPage<R extends PageRequest>(tabId: number, request: R): Promise<PageResponse<R['type']>> {
  await ensurePageAgent(tabId);
  return rawSend(tabId, request);
}
