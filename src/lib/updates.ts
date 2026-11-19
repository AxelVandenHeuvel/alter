/**
 * Alter is installed from its GitHub releases, and those copies never update themselves.
 * Once a day the panel asks GitHub for the latest release, so Settings can say when a newer
 * version is out. The request asks only for the release; it carries nothing about the user's pages.
 */

export const RELEASES_PAGE = 'https://github.com/AxelVandenHeuvel/alter/releases/latest';
export const LATEST_RELEASE_URL = 'https://api.github.com/repos/AxelVandenHeuvel/alter/releases/latest';
export const RELEASE_KEY = 'latest-release';
export const RELEASE_CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

interface ReleaseCheck {
  /** The latest release's version ("1.2.0"), or null when there is none or it couldn't be read. */
  version: string | null;
  checkedAt: number;
}

/** "v1.2.0" or "1.2" as numbers, or null for anything that isn't a plain version. */
function parts(version: string): number[] | null {
  const match = /^v?(\d+(?:\.\d+)*)$/.exec(version.trim());
  return match ? match[1]!.split('.').map(Number) : null;
}

/** Whether `candidate` is a later version than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parts(candidate);
  const b = parts(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** The latest release's version, checking GitHub at most once a day. Null when unknown. */
export async function latestRelease(fetcher: typeof fetch = fetch, now = Date.now()): Promise<string | null> {
  const stored = (await chrome.storage.local.get(RELEASE_KEY))[RELEASE_KEY] as ReleaseCheck | undefined;
  if (stored && now - stored.checkedAt < RELEASE_CHECK_EVERY_MS) return stored.version;
  let version: string | null = stored?.version ?? null;
  try {
    const response = await fetcher(LATEST_RELEASE_URL, {
      headers: { accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      credentials: 'omit',
    });
    if (response.ok) {
      const tag = ((await response.json()) as { tag_name?: unknown }).tag_name;
      version = typeof tag === 'string' && parts(tag) ? tag.trim().replace(/^v/, '') : null;
    } else if (response.status === 404) {
      // No release published yet.
      version = null;
    }
  } catch {
    // Offline or slow: keep what Alter knew, and try again tomorrow.
  }
  await chrome.storage.local.set({ [RELEASE_KEY]: { version, checkedAt: now } satisfies ReleaseCheck });
  return version;
}
