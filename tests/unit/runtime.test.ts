import { afterEach, describe, expect, it } from 'vitest';
import { buildScript, type ScriptReport } from '../../src/lib/userscripts';

interface AlterGlobal {
  __alter?: { active: boolean; dispose(): void; version: string };
}

/** Run a script exactly as it would be injected, in this test's global "world". */
function run(js: string, tag = 'test'): Promise<ScriptReport> {
  return (0, eval)(buildScript(tag, js, { contain: false }).code) as Promise<ScriptReport>;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  (globalThis as AlterGlobal).__alter?.dispose();
  document.body.innerHTML = '';
});

describe('alter runtime', () => {
  it('handles existing and future elements once each', async () => {
    document.body.innerHTML = '<p class="item">a</p>';
    const report = await run(`alter.onElement('.item', (el) => el.append(alter.h('b', { text: '!' }))); alter.onElement('.missing', () => {});`);
    expect(report.errors).toEqual([]);
    expect(report.watching).toEqual([
      { selector: '.item', matched: 1 },
      { selector: '.missing', matched: 0 },
    ]);
    expect(document.querySelectorAll('.item b')).toHaveLength(1);

    const later = document.createElement('p');
    later.className = 'item';
    document.body.append(later);
    await tick();
    await tick();
    expect(document.querySelectorAll('.item b')).toHaveLength(2);
  });

  it('undoes tracked work when disposed', async () => {
    document.body.innerHTML = '<main></main>';
    await run(`
      document.querySelector('main').append(alter.h('button', { text: 'Go', 'data-testid': 'added' }));
      alter.css('main { color: red }');
      alter.on(document, 'click', () => alter.log('click'));
      alter.onCleanup(() => document.body.setAttribute('data-cleaned', 'yes'));
    `);
    expect(document.querySelector('[data-testid="added"]')?.getAttribute('data-alter')).toBe('test');
    (globalThis as AlterGlobal).__alter!.dispose();
    expect(document.querySelector('[data-testid="added"]')).toBeNull();
    expect(document.querySelector('style.alter-style')).toBeNull();
    expect(document.body.getAttribute('data-cleaned')).toBe('yes');
  });

  it('records errors instead of throwing into the page', async () => {
    document.body.innerHTML = '<p class="x"></p>';
    const report = await run(`alter.onElement('.x', () => { throw new Error('boom'); }); alter.log('after');`);
    expect(report.errors).toEqual(['onElement(.x): boom']);
    expect(report.logs).toEqual(['after']);
    expect(report.active).toBe(true);
  });

  it('never runs alongside a password field', async () => {
    document.body.innerHTML = '<input type="password">';
    const report = await run(`document.body.setAttribute('data-ran', 'yes');`);
    expect(document.body.hasAttribute('data-ran')).toBe(false);
    expect(report.active).toBe(false);
    expect(report.stoppedReason).toMatch(/password field/);
  });

  it('stops when a password field appears later', async () => {
    document.body.innerHTML = '<main></main>';
    await run(`alter.onElement('main', (el) => el.append(alter.h('span', { text: 'hi' })));`);
    expect(document.querySelector('main span')).not.toBeNull();
    document.body.append(Object.assign(document.createElement('input'), { type: 'password' }));
    await tick();
    await tick();
    expect((globalThis as AlterGlobal).__alter!.active).toBe(false);
    expect(document.querySelector('main span')).toBeNull();
  });

  it('runs alongside a sign-in form that is hidden, and stops when it opens', async () => {
    document.body.innerHTML = '<main></main><dialog class="login"><input type="password"></dialog>';
    const report = await run(`alter.onElement('main', (el) => el.append(alter.h('span', { text: '¥' })));`);
    expect(report.active).toBe(true);
    expect(document.querySelector('main span')).not.toBeNull();

    document.querySelector('dialog')!.setAttribute('open', '');
    await tick();
    expect((globalThis as AlterGlobal).__alter!.active).toBe(false);
    expect(document.querySelector('main span')).toBeNull();
  });

  it.each([
    ['is focused', (field: HTMLInputElement) => field.focus()],
    ['gets typed into', (field: HTMLInputElement) => field.dispatchEvent(new Event('input', { bubbles: true }))],
  ])('stops when a hidden password field %s', async (_, use) => {
    document.body.innerHTML = '<main></main><input type="password" style="display: none">';
    const field = document.querySelector<HTMLInputElement>('input')!;
    await run(`alter.onElement('main', (el) => el.append(alter.h('span', { text: '¥' })));`);
    expect((globalThis as AlterGlobal).__alter!.active).toBe(true);
    // Showing it would stop the script a moment later; focus and input stop it right away, before any key arrives.
    field.style.display = '';
    use(field);
    expect((globalThis as AlterGlobal).__alter!.active).toBe(false);
    expect(document.querySelector('main span')).toBeNull();
  });

  it('does not start while a password field is filled in, even a hidden one', async () => {
    document.body.innerHTML = '<input type="password" style="display: none">';
    document.querySelector('input')!.value = 'hunter2';
    const report = await run(`document.body.setAttribute('data-ran', 'yes');`);
    expect(document.body.hasAttribute('data-ran')).toBe(false);
    expect(report.stoppedReason).toMatch(/password field is showing/);
  });

  it('replaces the previous instance when re-run in the same world', async () => {
    document.body.innerHTML = '<main></main>';
    await run(`document.querySelector('main').append(alter.h('i', { text: 'v1' }));`);
    await run(`document.querySelector('main').append(alter.h('i', { text: 'v2' }));`);
    expect(Array.from(document.querySelectorAll('main i'), (el) => el.textContent)).toEqual(['v2']);
  });

  it('hands action outputs to Alter instead of touching the page or clipboard', async () => {
    document.body.innerHTML = '<h1>Title</h1><p>Body</p>';
    const before = document.body.innerHTML;
    const report = await run(`alter.download('post.txt', alter.text(document.querySelector('h1')), 'text/plain'); await alter.copy('copied');`, 'action');
    expect(report.outputs).toEqual({ downloads: [{ filename: 'post.txt', text: 'Title', type: 'text/plain' }], clipboard: 'copied' });
    expect(document.body.innerHTML).toBe(before);
  });

  it('caps action output size', async () => {
    const report = await run(`alter.copy('x'.repeat(6 * 1024 * 1024));`, 'action');
    expect(report.errors).toEqual(['script: The output is larger than 5 MB.']);
  });

  it('runs scripts saved before the rename, which call the helper by its old name', async () => {
    document.body.innerHTML = '<p class="item">a</p>';
    const report = await run(`vb.onElement('.item', (el) => el.append(vb.h('b', { text: '!' })));`);
    expect(report.errors).toEqual([]);
    expect(document.querySelectorAll('.item b')).toHaveLength(1);
  });
});
