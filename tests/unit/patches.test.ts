import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addPatch,
  DARK_MODE_OFF,
  deleteAllPatches,
  deletePatch,
  effectiveContent,
  FOCUS_OFF,
  getPatches,
  restorePatch,
  updatePatch,
  type Patch,
} from '../../src/lib/patches';

const dark = { enabled: true, brightness: 100, contrast: 100, sepia: 0 };

function patch(id: string, changes: Partial<Patch> = {}): Patch {
  return {
    id,
    hostname: 'example.com',
    title: id,
    summary: '',
    intent: '',
    css: `.${id} { display: none }`,
    darkMode: DARK_MODE_OFF,
    focus: FOCUS_OFF,
    js: '',
    enabled: true,
    model: 'm',
    createdAt: 0,
    ...changes,
  };
}

describe('effectiveContent', () => {
  it('layers enabled saved patches in order, then the preview', () => {
    const result = effectiveContent([patch('a'), patch('b', { enabled: false }), patch('c')], { css: '.p{}', darkMode: DARK_MODE_OFF, focus: FOCUS_OFF });
    expect(result.styles.map((s) => s.id)).toEqual(['a', 'c', 'preview']);
    expect(result.darkMode.enabled).toBe(false);
  });

  it('uses the last layer that enables dark mode', () => {
    const result = effectiveContent([patch('a', { darkMode: dark }), patch('b', { darkMode: { ...dark, brightness: 90 } })], null);
    expect(result.darkMode.brightness).toBe(90);
  });

  it('hides the saved patch a preview revises, only while previewing', () => {
    const saved = [patch('a', { darkMode: dark }), patch('b')];
    const preview = { css: '.new{}', darkMode: DARK_MODE_OFF, focus: FOCUS_OFF };
    const revising = effectiveContent(saved, preview, 'a');
    expect(revising.styles.map((s) => s.id)).toEqual(['b', 'preview']);
    expect(revising.darkMode.enabled).toBe(false);
    expect(effectiveContent(saved, null, 'a').styles.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('skips empty CSS layers', () => {
    expect(effectiveContent([patch('a', { css: '  ', darkMode: dark })], null).styles).toEqual([]);
  });

  it('uses the last layer that turns on a focus view', () => {
    const reader = { mode: 'reader' as const, theme: 'auto' as const, textSize: 'normal' as const };
    const result = effectiveContent([patch('a', { focus: reader })], { css: '', darkMode: DARK_MODE_OFF, focus: { ...reader, mode: 'recipe' } });
    expect(result.focus.mode).toBe('recipe');
    expect(effectiveContent([patch('a', { focus: reader, enabled: false })], null).focus.mode).toBe('off');
  });
});

describe('saved patch storage', () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = {};
    // Like chrome.storage, every call resolves on a later task, so overlapping edits really overlap.
    const later = <T>(value: () => T) => new Promise<T>((resolve) => setTimeout(() => resolve(value()), 0));
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: (key: string) => later(() => (key in store ? { [key]: structuredClone(store[key]) } : {})),
          set: (items: Record<string, unknown>) => later(() => void Object.assign(store, structuredClone(items))),
          remove: (key: string) => later(() => void delete store[key]),
        },
      },
    });
  });

  const ids = async () => (await getPatches('example.com')).map((p) => `${p.id}${p.enabled ? '' : ' (off)'}`);

  it('keeps every change when several are made at once', async () => {
    await Promise.all([addPatch(patch('a')), addPatch(patch('b')), addPatch(patch('c'))]);
    await Promise.all([updatePatch('example.com', 'a', { enabled: false }), updatePatch('example.com', 'c', { enabled: false })]);
    expect(await ids()).toEqual(['a (off)', 'b', 'c (off)']);
  });

  it('puts a deleted patch back where it was, once', async () => {
    await Promise.all([addPatch(patch('a')), addPatch(patch('b')), addPatch(patch('c'))]);
    const [, b] = await getPatches('example.com');
    await deletePatch('example.com', 'b');
    expect(await ids()).toEqual(['a', 'c']);
    await restorePatch(b!, 1);
    await restorePatch(b!, 1);
    expect(await ids()).toEqual(['a', 'b', 'c']);
  });

  it('removes the storage entry when the last patch goes', async () => {
    await addPatch(patch('a'));
    await deleteAllPatches('example.com');
    expect(store).toEqual({});
  });
});
