// Shared helpers for checks that drive an installed Google Chrome through the
// DevTools protocol, with a throwaway profile. Used where Chrome for Testing
// can't help (it can't click the toolbar icon or open extension UI reliably, and extension reloads close it).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function launchChrome(port) {
  const chromePath = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const profile = mkdtempSync(path.join(tmpdir(), 'alter-check-'));
  const chrome = spawn(
    chromePath,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${port}`,
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let url;
  for (let i = 0; i < 40 && !url; i++) {
    await pause(500);
    url = await fetch(`http://127.0.0.1:${port}/json/version`)
      .then((r) => r.json())
      .then((json) => json.webSocketDebuggerUrl)
      .catch(() => undefined);
  }
  if (!url) throw new Error(`Could not reach Chrome at ${chromePath}`);
  const socket = new WebSocket(url);
  await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));

  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  const targets = async () => (await send('Target.getTargets', { filter: [{}] })).targetInfos;
  const attach = async (targetId) => (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  const evaluate = async (sessionId, expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };

  const close = async () => {
    socket.close();
    chrome.kill();
    await pause(500);
    rmSync(profile, { recursive: true, force: true });
  };
  return { send, targets, attach, evaluate, close };
}

/**
 * Poll `read` until it returns `expected` (or `timeoutMs` passes) and return the last value.
 * Checks wait for state instead of sleeping, so they hold up when the machine is busy.
 */
export async function waitFor(read, expected, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  do {
    value = await read().catch((error) => `error: ${error.message}`);
    if (value === expected) return value;
    await pause(200);
  } while (Date.now() < deadline);
  return value;
}

/** Collects pass/fail lines and sets the exit code. */
export function checker() {
  const failures = [];
  return {
    check(label, actual, expected) {
      const ok = actual === expected;
      console.log(`${ok ? '✓' : '✗'} ${label}${ok ? '' : ` (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
      if (!ok) failures.push(label);
    },
    fail(message) {
      failures.push(message);
      console.error(`✗ ${message}`);
    },
    exitCode: () => (failures.length ? 1 : 0),
  };
}
