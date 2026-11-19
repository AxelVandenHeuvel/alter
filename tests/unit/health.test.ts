import { describe, expect, it } from 'vitest';
import { cssHealth, matchableSelector, splitSelectorList } from '../../src/content/health';
import { describeHealth, type ChangeHealth } from '../../src/lib/health-status';
import { DARK_MODE_OFF, FOCUS_OFF, type FocusSettings } from '../../src/lib/patches';

describe('CSS health', () => {
  it('splits selector lists only on top-level commas', () => {
    expect(splitSelectorList('a, b:is(.x, .y), [data-x="1,2"]')).toEqual(['a', 'b:is(.x, .y)', '[data-x="1,2"]']);
  });

  it('tests the element behind pseudo-elements and interaction states', () => {
    expect(matchableSelector('a:hover::after')).toBe('a');
    expect(matchableSelector('.menu:focus-within > li:hover')).toBe('.menu > li');
    expect(matchableSelector(':hover')).toBe('*');
    expect(matchableSelector('div:not(.x):has(> img)')).toBe('div:not(.x):has(> img)');
  });

  it('reports which selectors match the page', () => {
    document.body.innerHTML = '<main><p class="a">x</p></main>';
    const style = document.createElement('style');
    style.textContent = `.a, .missing { color: red } @media (min-width: 1px) { main:hover { color: blue } } .gone::before { content: '' }`;
    document.head.append(style);
    expect(cssHealth(document, style.sheet)).toEqual({ selectors: 4, matching: 2, unmatched: ['.missing', '.gone::before'] });
    style.remove();
  });
});

describe('describeHealth', () => {
  const css = (matching: number, selectors = 2, unmatched: string[] = []) => ({ selectors, matching, unmatched });
  const script = (matched: number, extra: Partial<NonNullable<ChangeHealth['script']>> = {}) => ({
    errors: [],
    logs: [],
    matched,
    added: 0,
    rates: null,
    watching: [{ selector: '.item', matched }],
    active: true,
    stoppedReason: null,
    outputs: null,
    ...extra,
  });
  const change = (overrides: { css?: string; js?: string; dark?: boolean; focus?: FocusSettings['mode'] } = {}) => ({
    css: overrides.css ?? '.a {}',
    js: overrides.js ?? '',
    darkMode: { ...DARK_MODE_OFF, enabled: overrides.dark ?? false },
    focus: { ...FOCUS_OFF, mode: overrides.focus ?? 'off' },
  });
  const context = { darkModeActive: false, scriptsAvailable: true, focus: { state: 'off' as const } };

  it('says what a working change is doing', () => {
    expect(describeHealth(change(), { css: css(2), script: null }, context)).toMatchObject({ tone: 'ok', text: 'All 2 style rules apply' });
    expect(describeHealth(change({ js: 'x' }), { css: css(1, 2, ['.b']), script: script(5) }, context)).toEqual({
      tone: 'ok',
      text: '1 of 2 style rules apply · Script handled 5 elements',
      details: ['Not found here: .b'],
    });
    expect(describeHealth(change({ css: '', dark: true }), { css: null, script: null }, { ...context, darkModeActive: true })).toMatchObject({
      text: 'Dark mode on',
    });
  });

  it('says when a change does nothing on this page', () => {
    expect(describeHealth(change({ js: 'x' }), { css: css(0, 1, ['.a']), script: script(0) }, context)).toEqual({
      tone: 'idle',
      text: 'Nothing to change on this page',
      details: ['Not found here: .a', 'Script is still waiting for: .item'],
    });
  });

  it('surfaces errors, stops, and scripts being off', () => {
    expect(describeHealth(change({ js: 'x' }), { css: null, script: script(0, { errors: ['onElement(.x): boom'] }) }, context)).toMatchObject({
      tone: 'error',
      text: 'Script error: onElement(.x): boom',
    });
    expect(
      describeHealth(change({ js: 'x' }), { css: null, script: script(0, { stoppedReason: 'The page has a password field.' }) }, context),
    ).toMatchObject({ tone: 'off' });
    expect(describeHealth(change({ js: 'x' }), undefined, { ...context, scriptsAvailable: false })).toMatchObject({
      tone: 'error',
      text: 'Not running: scripts are off in Chrome',
    });
    expect(describeHealth(change(), undefined, context)).toBeNull();
  });

  it('describes the reader and recipe views', () => {
    const noCss = { css: null, script: null };
    const show = (focus: Parameters<typeof describeHealth>[2]['focus']) =>
      describeHealth(change({ css: '', focus: 'recipe' }), noCss, { ...context, focus });
    expect(show({ state: 'showing', view: 'recipe', title: 'Pasta', fellBack: false })).toMatchObject({ tone: 'ok', text: 'Recipe view on' });
    expect(show({ state: 'showing', view: 'reader', title: 'Story', fellBack: true })).toMatchObject({
      tone: 'ok',
      text: 'No recipe data here, showing the reader view',
    });
    expect(show({ state: 'closed', view: 'recipe' })).toMatchObject({ text: 'Recipe view closed on this page' });
    expect(show({ state: 'looking' })).toMatchObject({ tone: 'idle', text: 'Looking for the content…' });
    expect(show({ state: 'not-found', mode: 'recipe' })).toEqual({
      tone: 'idle',
      text: 'Nothing to change on this page',
      details: ['No recipe or article found on this page.'],
    });
  });
});
