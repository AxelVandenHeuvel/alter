import { afterEach, describe, expect, it } from 'vitest';
import { buildScript, type ScriptReport } from '../../src/lib/userscripts';

/**
 * Containment wraps the world's listeners, timers, and observers once, and this file's
 * test environment is that world. Each test ends by starting an empty script, so the
 * timers the test runner sets afterwards belong to a run that is still going.
 */

interface AlterGlobal {
  __alter?: { active: boolean; dispose(): void };
}

const alter = () => (globalThis as AlterGlobal).__alter!;

function run(js: string): Promise<ScriptReport> {
  return (0, eval)(buildScript('test', js).code) as Promise<ScriptReport>;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(async () => {
  document.body.innerHTML = '';
  await run('');
});

/** A script that counts what reaches it without using alter's helpers. */
const SNOOP = `
  const count = (name) => document.body.dataset[name] = String(Number(document.body.dataset[name] || 0) + 1);
  document.addEventListener('keydown', () => count('keys'));
  document.addEventListener('keyup', { handleEvent: () => count('handled') });
  document.querySelector('button').onclick = () => count('clicks');
  setInterval(() => count('ticks'), 5);
  new MutationObserver(() => count('mutations')).observe(document.body, { childList: true });
`;

const counts = () => ({ ...document.body.dataset });

describe('containment', () => {
  it('lets a running script’s own listeners, timers, and observers work', async () => {
    document.body.innerHTML = '<button>Go</button>';
    await run(SNOOP);
    document.dispatchEvent(new KeyboardEvent('keydown'));
    document.dispatchEvent(new KeyboardEvent('keyup'));
    document.querySelector('button')!.click();
    document.body.append(document.createElement('p'));
    await wait(30);
    expect(counts()).toMatchObject({ keys: '1', handled: '1', clicks: '1', mutations: '1' });
    expect(Number(counts().ticks)).toBeGreaterThan(1);
  });

  it('makes all of them do nothing once the script stops, even ones made without alter', async () => {
    document.body.innerHTML = '<button>Go</button>';
    await run(SNOOP);
    alter().dispose();
    // A new run, so this test's own timers keep working.
    await run('');
    const before = counts();
    document.dispatchEvent(new KeyboardEvent('keydown'));
    document.dispatchEvent(new KeyboardEvent('keyup'));
    document.querySelector('button')!.click();
    document.body.append(document.createElement('p'));
    await wait(30);
    expect(counts()).toEqual(before);
  });

  it('still removes listeners the script removes itself', async () => {
    document.body.innerHTML = '<button>Go</button>';
    await run(`
      const listener = () => document.body.dataset.clicked = 'yes';
      document.addEventListener('click', listener);
      document.removeEventListener('click', listener);
    `);
    document.querySelector('button')!.click();
    expect(document.body.dataset.clicked).toBeUndefined();
  });

  it('still reports back when the script is stopped right after it runs', async () => {
    const report = await run(`const field = document.createElement('input'); field.type = 'password'; document.body.append(field);`);
    expect(report.active).toBe(false);
    expect(report.stoppedReason).toMatch(/password field is showing/);
  });

  it('silences a script the moment a password field gets focus', async () => {
    document.body.innerHTML = '<input type="password" style="display: none">';
    await run(`document.addEventListener('keydown', (event) => document.body.dataset.typed = event.key);`);
    const field = document.querySelector('input')!;
    field.style.display = '';
    field.focus();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    expect(alter().active).toBe(false);
    expect(document.body.dataset.typed).toBeUndefined();
  });
});
