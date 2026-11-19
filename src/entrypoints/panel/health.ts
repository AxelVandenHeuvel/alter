import { useEffect, useState } from 'react';
import type { ChangeHealth, HealthContext } from '../../lib/health-status';
import type { FocusStatus } from '../../lib/messages';
import { askPageIfPresent } from '../../lib/page-client';
import type { Patch } from '../../lib/patches';
import { PREVIEW_WORLD, readReport, userScriptsAvailable, worldIdFor } from '../../lib/userscripts';

export interface PageHealthState {
  /** Keyed by saved patch id, plus 'preview'. */
  changes: Record<string, ChangeHealth>;
  darkModeActive: boolean;
  focus: FocusStatus;
}

const POLL_MS = 2000;

/** What every change's status line needs to know about the page as a whole. */
export function healthContext(health: PageHealthState | null, scriptsAvailable: boolean | null): HealthContext {
  return {
    darkModeActive: health?.darkModeActive ?? false,
    scriptsAvailable,
    focus: health?.focus ?? { state: 'off' },
  };
}

async function readHealth(tabId: number, patches: Patch[], previewHasScript: boolean): Promise<PageHealthState | null> {
  // Saved changes start the page agent on their own; with nothing saved or previewed there is nothing to report.
  const page = await askPageIfPresent(tabId, { type: 'alter:health' });
  if (!page) return null;
  const scripts = await userScriptsAvailable();
  const changes: Record<string, ChangeHealth> = {};

  for (const patch of patches) {
    const script = scripts && patch.enabled && patch.js.trim() ? await readReport(tabId, worldIdFor(patch.id)).catch(() => null) : null;
    changes[patch.id] = { css: page.css[patch.id] ?? null, script };
  }
  const previewScript = scripts && previewHasScript ? await readReport(tabId, PREVIEW_WORLD).catch(() => null) : null;
  changes.preview = { css: page.css.preview ?? null, script: previewScript };
  return { changes, darkModeActive: page.darkModeActive, focus: page.focus };
}

/**
 * Live health of every change on the page, polled while the panel is open:
 * which CSS rules match something, what scripts handled, and their errors.
 */
export function usePageHealth(
  tabId: number | null,
  enabled: boolean,
  patches: Patch[],
  /** The proposal being previewed; a snapshot from before it existed would misreport it. */
  previewId: string | null,
  previewHasScript: boolean,
): PageHealthState | null {
  const snapshotKey = `${tabId}:${previewId}`;
  const [state, setState] = useState<{ key: string; value: PageHealthState } | null>(null);

  useEffect(() => {
    if (tabId === null || !enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const value = await readHealth(tabId, patches, previewHasScript);
        if (!cancelled && value) setState({ key: snapshotKey, value });
      } catch {
        // The page is navigating or not reachable; try again on the next tick.
      }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tabId, enabled, patches, previewHasScript, snapshotKey]);

  return state && state.key === snapshotKey ? state.value : null;
}
