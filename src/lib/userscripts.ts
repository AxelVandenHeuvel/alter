import runtimeSource from '../userscript/runtime.js?raw';
import { hostnameOf, originPattern } from './host';
import { wrapScript } from './js-safety';
import { getPatchedHostnames, getPatches, type Patch } from './patches';
import { getRates, refreshRates, usesRates, type ExchangeRates } from './rates';
import { isSensitiveHost } from './sensitive';
import { getSettings } from './settings';
import { getSuppressed } from './tab-session';

/**
 * Running model-written scripts through chrome.userScripts, the API Chrome
 * provides for user-approved scripts. Each saved change gets its own world;
 * previews share one. Every world's CSP blocks all network access, so a script
 * can rearrange the page but can't send anything anywhere.
 */

export const PREVIEW_WORLD = 'alter-preview';
/** One-time actions run here, then the world is cleaned up. */
export const ACTION_WORLD = 'alter-action';
export const WORLD_CSP =
  "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:";

export interface ScriptReport {
  errors: string[];
  logs: string[];
  /** Elements handled through alter.onElement. */
  matched: number;
  /** Elements the script added (labels, buttons) that are on the page now. */
  added: number;
  /** The exchange rates the script was given, or null (none needed, or none could be downloaded). */
  rates: { date: string; source: string } | null;
  /** Each alter.onElement selector and how many elements it has handled. */
  watching: { selector: string; matched: number }[];
  active: boolean;
  /** Why the script is not running, when it stopped on purpose. */
  stoppedReason: string | null;
  /** Files and clipboard text a one-time action produced; null for changes. */
  outputs: ActionOutputs | null;
}

export interface ActionOutputs {
  downloads: { filename: string; text: string; type: string }[];
  clipboard: string | null;
}

/** A report for a script that did nothing (yet). */
export function emptyReport(): ScriptReport {
  return { errors: [], logs: [], matched: 0, added: 0, rates: null, watching: [], active: false, stoppedReason: null, outputs: null };
}

export function worldIdFor(patchId: string): string {
  return `alter-${patchId}`;
}

/** Whether the user has turned on "Allow User Scripts" for Alter. Changes live, without a reload. */
export async function userScriptsAvailable(): Promise<boolean> {
  try {
    await chrome.userScripts.getScripts();
    return true;
  } catch {
    return false;
  }
}

/** Short stable hash, used to tell whether a page runs the current version of a script. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export interface BuildOptions {
  /** Exchange rates for alter.convert; scripts can't download them. */
  rates?: ExchangeRates | null;
  /**
   * Make stopping the script stop everything it set up (see the runtime's containment).
   * Only unit tests turn it off: it wraps the world's timers and listeners, which a test shares.
   */
  contain?: boolean;
}

export function buildScript(tag: string, js: string, { rates = null, contain = true }: BuildOptions = {}): { code: string; version: string } {
  // The version tells whether a page runs this script; new rates alone don't restart it.
  const version = hash(`${tag}\n${js}`);
  const meta = { tag, version, contain, rates: rates && { date: rates.date, source: rates.source, perEuro: rates.perEuro } };
  const code = `${runtimeSource}\n__alterStart(${JSON.stringify(meta)}, ${wrapScript(js)});\n`;
  return { code, version };
}

async function execute<T>(tabId: number, worldId: string, code: string): Promise<T | undefined> {
  await chrome.userScripts.configureWorld({ worldId, csp: WORLD_CSP, messaging: false });
  const [result] = await chrome.userScripts.execute<T>({
    target: { tabId },
    worldId,
    injectImmediately: true,
    js: [{ code }],
  });
  if (result?.error) throw new Error(result.error);
  return result?.result;
}

export async function runScript(tabId: number, worldId: string, tag: string, js: string): Promise<ScriptReport> {
  // Only scripts that convert prices get rates, so only they cause a download.
  const { code } = buildScript(tag, js, { rates: usesRates(js) ? await refreshRates() : null });
  const report = await execute<ScriptReport>(tabId, worldId, code);
  return report ?? { ...emptyReport(), errors: ['The script did not report back.'] };
}

/** Run a one-time action on the page, collect what it produced, and clean up after it. */
export async function runAction(tabId: number, js: string): Promise<ScriptReport> {
  try {
    return await runScript(tabId, ACTION_WORLD, 'action', js);
  } finally {
    await disposeScript(tabId, ACTION_WORLD).catch(() => undefined);
  }
}

/** The live report of the script in a world, or null if none has run there. */
export async function readReport(tabId: number, worldId: string): Promise<ScriptReport | null> {
  return (await execute<ScriptReport | null>(tabId, worldId, 'globalThis.__alter ? globalThis.__alter.report() : null;')) ?? null;
}

/** Turn off whatever script runs in the world. Only effects made through alter are undone. */
export async function disposeScript(tabId: number, worldId: string): Promise<void> {
  await execute(tabId, worldId, 'globalThis.__alter && globalThis.__alter.dispose();');
}

async function runningVersion(tabId: number, worldId: string): Promise<string | null> {
  return (
    (await execute<string | null>(
      tabId,
      worldId,
      'globalThis.__alter && globalThis.__alter.active ? globalThis.__alter.version : null;',
    )) ?? null
  );
}

function wantsScript(patch: Patch, paused: boolean, suppressed: string | null): boolean {
  return patch.enabled && !paused && patch.js.trim() !== '' && patch.id !== suppressed && !isSensitiveHost(patch.hostname);
}

/**
 * Make an open tab run exactly the saved scripts it should: start new or edited
 * ones, stop disabled or deleted ones. Pages that load later get them from
 * the registered scripts instead.
 */
export async function reconcileTab(tabId: number, hostname: string, removedIds: string[] = []): Promise<void> {
  if (!(await userScriptsAvailable())) return;
  const [patches, settings, suppressed] = await Promise.all([getPatches(hostname), getSettings(), getSuppressed(tabId)]);

  for (const id of removedIds) await disposeScript(tabId, worldIdFor(id)).catch(() => undefined);
  for (const patch of patches) {
    if (!patch.js.trim()) continue;
    const world = worldIdFor(patch.id);
    const running = await runningVersion(tabId, world).catch(() => null);
    if (wantsScript(patch, settings.paused, suppressed)) {
      if (running !== buildScript(patch.id, patch.js).version) await runScript(tabId, world, patch.id, patch.js).catch(() => undefined);
    } else if (running !== null) {
      await disposeScript(tabId, world).catch(() => undefined);
    }
  }
}

/** Reconcile every open tab on the hostname. */
export async function reconcileHost(hostname: string, removedIds: string[] = []): Promise<void> {
  const tabs = await chrome.tabs.query({ url: originPattern(hostname) });
  await Promise.all(
    tabs.filter((tab) => tab.id !== undefined && hostnameOf(tab.url) === hostname).map((tab) => reconcileTab(tab.id!, hostname, removedIds)),
  );
}

/** Download new exchange rates if a saved change converts prices (and the rates Alter has are old). */
export async function refreshRatesForSavedScripts(): Promise<void> {
  for (const hostname of await getPatchedHostnames()) {
    if ((await getPatches(hostname)).some((patch) => patch.enabled && usesRates(patch.js))) {
      await refreshRates();
      return;
    }
  }
}

/** Register saved scripts so they run on every future page load. Idempotent. */
export async function syncRegisteredScripts(): Promise<void> {
  if (!(await userScriptsAvailable())) return;
  const [settings, rates] = await Promise.all([getSettings(), getRates()]);
  const wanted: chrome.userScripts.RegisteredUserScript[] = [];
  for (const hostname of await getPatchedHostnames()) {
    if (!(await chrome.permissions.contains({ origins: [originPattern(hostname)] }))) continue;
    for (const patch of await getPatches(hostname)) {
      if (!wantsScript(patch, settings.paused, null)) continue;
      const world = worldIdFor(patch.id);
      await chrome.userScripts.configureWorld({ worldId: world, csp: WORLD_CSP, messaging: false });
      wanted.push({
        id: patch.id,
        matches: [originPattern(hostname)],
        js: [{ code: buildScript(patch.id, patch.js, { rates: usesRates(patch.js) ? rates : null }).code }],
        runAt: 'document_idle',
        world: 'USER_SCRIPT',
        worldId: world,
      });
    }
  }
  const existing = await chrome.userScripts.getScripts();
  const stale = existing.filter((s) => !wanted.some((w) => w.id === s.id)).map((s) => s.id);
  if (stale.length) await chrome.userScripts.unregister({ ids: stale });
  const toUpdate = wanted.filter((w) => existing.some((s) => s.id === w.id));
  const toRegister = wanted.filter((w) => !existing.some((s) => s.id === w.id));
  if (toUpdate.length) await chrome.userScripts.update(toUpdate);
  if (toRegister.length) await chrome.userScripts.register(toRegister);
}
