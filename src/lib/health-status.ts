import type { CssHealth } from '../content/health';
import { plural } from './format';
import type { FocusStatus } from './messages';
import type { PatchContent } from './patches';
import type { ScriptReport } from './userscripts';

/** Raw health of one change on the current page. */
export interface ChangeHealth {
  css: CssHealth | null;
  script: ScriptReport | null;
}

export type HealthTone = 'ok' | 'idle' | 'error' | 'off';

export interface HealthStatus {
  tone: HealthTone;
  text: string;
  /** Extra lines for the expanded view: what wasn't found, the script's latest note. */
  details: string[];
}

export interface HealthContext {
  darkModeActive: boolean;
  scriptsAvailable: boolean | null;
  focus: FocusStatus;
}

const VIEW_NAME = { reader: 'Reader view', recipe: 'Recipe view' } as const;

/** Turn raw health into the one-line status shown in the panel. Null while unknown. */
export function describeHealth(change: PatchContent, health: ChangeHealth | undefined, context: HealthContext): HealthStatus | null {
  const hasScript = change.js.trim() !== '';
  if (hasScript && context.scriptsAvailable === false) {
    return { tone: 'error', text: 'Not running: scripts are off in Chrome', details: [] };
  }
  if (!health) return null;

  const { css, script } = health;
  const details: string[] = [];
  if (script?.errors.length) {
    return { tone: 'error', text: `Script error: ${script.errors[script.errors.length - 1]}`, details: script.errors.slice(0, -1) };
  }
  if (script?.stoppedReason) return { tone: 'off', text: script.stoppedReason, details: [] };
  if (hasScript && !script) return { tone: 'idle', text: 'Script not running on this page yet', details: [] };

  const parts: string[] = [];
  let doing = false;
  if (change.focus.mode !== 'off') {
    const focus = context.focus;
    if (focus.state === 'showing') {
      parts.push(focus.fellBack ? 'No recipe data here, showing the reader view' : `${VIEW_NAME[focus.view]} on`);
      doing = true;
    } else if (focus.state === 'closed') {
      parts.push(`${VIEW_NAME[focus.view]} closed on this page`);
      doing = true;
    } else if (focus.state === 'looking') {
      return { tone: 'idle', text: 'Looking for the content…', details: [] };
    } else if (focus.state === 'not-found') {
      details.push(change.focus.mode === 'recipe' ? 'No recipe or article found on this page.' : 'No article found on this page.');
    }
  }
  if (change.darkMode.enabled && context.darkModeActive) {
    parts.push('Dark mode on');
    doing = true;
  }
  if (css && css.selectors > 0) {
    if (css.matching > 0) {
      parts.push(
        css.selectors === 1
          ? '1 style rule applies'
          : css.matching === css.selectors
            ? `All ${css.selectors} style rules apply`
            : `${css.matching} of ${css.selectors} style rules apply`,
      );
      doing = true;
    }
    if (css.unmatched.length) details.push(`Not found here: ${css.unmatched.join(', ')}`);
  }
  if (script) {
    if (script.matched > 0) {
      parts.push(`Script handled ${plural(script.matched, 'element')}`);
      doing = true;
    } else if (script.watching.length === 0) {
      parts.push('Script ran');
      doing = true;
    }
    const idle = script.watching.filter((w) => w.matched === 0).map((w) => w.selector);
    if (idle.length) details.push(`Script is still waiting for: ${idle.join(', ')}`);
    if (script.logs.length) details.push(`Latest note: ${script.logs[script.logs.length - 1]}`);
  }

  if (!doing) return { tone: 'idle', text: 'Nothing to change on this page', details };
  return { tone: 'ok', text: parts.join(' · '), details };
}
