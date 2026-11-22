import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, getSettings, SETTINGS_KEY, updateSettings } from '../../src/lib/settings';

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

describe('settings', () => {
  it('start from the defaults, with the Plain look', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.look).toBe('plain');
  });

  it('keep the look the user picks', async () => {
    await updateSettings({ look: 'patchwork' });
    expect((await getSettings()).look).toBe('patchwork');
  });

  it('fall back to Plain for a look Alter no longer has', async () => {
    store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, look: 'velvet' };
    expect((await getSettings()).look).toBe('plain');
  });

  it('drop settings an older version stored', async () => {
    store[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, provider: 'local' };
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
