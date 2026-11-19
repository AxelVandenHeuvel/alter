import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isNewer, LATEST_RELEASE_URL, latestRelease, RELEASE_CHECK_EVERY_MS } from '../../src/lib/updates';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: structuredClone(store[key]) } : {}),
        set: async (items: Record<string, unknown>) => void Object.assign(store, structuredClone(items)),
      },
    },
  });
});

const github = (status: number, body: unknown = {}) => vi.fn(async () => ({ ok: status === 200, status, json: async () => body }) as Response);

describe('isNewer', () => {
  it('compares versions part by part, with or without a leading v', () => {
    expect(isNewer('v0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.10.0', '0.9.3')).toBe(true);
    expect(isNewer('1.0', '1.0.0')).toBe(false);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.0.9', '0.1.0')).toBe(false);
  });

  it('ignores anything that is not a plain version', () => {
    expect(isNewer('nightly', '0.1.0')).toBe(false);
    expect(isNewer('1.0.0-beta', '0.1.0')).toBe(false);
  });
});

describe('latestRelease', () => {
  it('asks GitHub, then not again for a day', async () => {
    const fetcher = github(200, { tag_name: 'v0.2.0' });
    expect(await latestRelease(fetcher, 1000)).toBe('0.2.0');
    expect(fetcher).toHaveBeenCalledWith(LATEST_RELEASE_URL, expect.objectContaining({ credentials: 'omit' }));
    expect(await latestRelease(fetcher, 1000 + RELEASE_CHECK_EVERY_MS - 1)).toBe('0.2.0');
    expect(fetcher).toHaveBeenCalledTimes(1);

    const later = github(200, { tag_name: 'v0.3.0' });
    expect(await latestRelease(later, 1000 + RELEASE_CHECK_EVERY_MS)).toBe('0.3.0');
  });

  it('knows of no release before one is published', async () => {
    expect(await latestRelease(github(404), 1000)).toBeNull();
  });

  it('keeps what it knew when GitHub is unreachable or refuses, and waits a day before asking again', async () => {
    await latestRelease(github(200, { tag_name: 'v0.2.0' }), 1000);
    const offline = vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await latestRelease(offline, 1000 + RELEASE_CHECK_EVERY_MS)).toBe('0.2.0');
    expect(await latestRelease(github(403), 1000 + 2 * RELEASE_CHECK_EVERY_MS)).toBe('0.2.0');
    const soon = github(200, { tag_name: 'v0.4.0' });
    expect(await latestRelease(soon, 1000 + 2 * RELEASE_CHECK_EVERY_MS + 1)).toBe('0.2.0');
    expect(soon).not.toHaveBeenCalled();
  });
});
