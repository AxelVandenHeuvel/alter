import { createStore, del, get, set } from 'idb-keyval';

/**
 * The API key lives in the extension origin's IndexedDB rather than
 * chrome.storage.local, because content scripts can read chrome.storage.local
 * but can never reach the extension origin's IndexedDB.
 */
const store = createStore('alter-secrets', 'secrets');
const API_KEY = 'anthropic-api-key';

export function getApiKey(): Promise<string | undefined> {
  return get<string>(API_KEY, store);
}

export function setApiKey(key: string): Promise<void> {
  return set(API_KEY, key, store);
}

export function clearApiKey(): Promise<void> {
  return del(API_KEY, store);
}
