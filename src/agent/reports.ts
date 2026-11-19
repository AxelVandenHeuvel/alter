import type { DataSearch, PageDataSummary } from '../content/page-data';
import { hasProblems, type LostText, type VisualReport } from '../content/visual-check';
import { describeSize, plural } from '../lib/format';
import { usesRates } from '../lib/rates';
import type { ScriptReport } from '../lib/userscripts';
import type { PreviewResult, Proposal } from './agent';

/**
 * What the model is told after its tools run: the measured result of a preview,
 * or what a one-time action produced. Plain text, with notes that steer the next step.
 */

type AppliedPreview = Extract<PreviewResult, { status: 'applied' }>;

export const DECLINED_SCRIPT =
  'The user chose not to run this script, so nothing changed. Do not propose the same script again unless they ask; offer a CSS-only alternative if there is one, or ask what they would like instead.';

export const DECLINED_ACTION = 'The user chose not to run this action, so nothing happened. Ask what they would like instead.';

export function previewReport(proposal: Proposal, result: AppliedPreview, { canFix }: { canFix: boolean }): string {
  const measured: Record<string, unknown> = { colors: result.summary.colors, alter: result.summary.alter };
  if (result.css) measured.css = result.css;
  if (result.script) measured.script = result.script;

  const notes: string[] = [];
  if (result.script?.errors.length) notes.push('The script reported errors; fix them with another propose_patch call.');
  if (result.script && usesRates(proposal.js)) {
    const rates = result.script.rates;
    notes.push(
      rates
        ? `Exchange rates: ${rates.source} for ${rates.date}. Say in your reply that amounts are approximate and use that day's rates.`
        : "Alter couldn't download exchange rates, so alter.convert returned null for every price. Tell the user conversion isn't available right now; don't guess a rate.",
    );
  }
  const focus = result.summary.alter.focus;
  if (proposal.focus.mode !== 'off' && focus.state === 'not-found') {
    notes.push('The focus view found nothing to show on this page. Tell the user, and offer to hide clutter with CSS instead.');
  }
  if (focus.state === 'showing' && focus.fellBack) {
    notes.push('This page has no recipe data, so the reader view is showing instead; mention that to the user.');
  }
  const idleSelectors = [
    ...(result.css?.unmatched ?? []),
    ...(result.script?.watching.filter((w) => w.matched === 0).map((w) => w.selector) ?? []),
  ];
  if (idleSelectors.length) {
    notes.push(
      `Nothing on the page matches: ${idleSelectors.join(' | ')}. Check these selectors; if they target something that is not on screen right now, tell the user you could not verify them.`,
    );
  }
  return ['Preview applied and visible to the user. Page after the change:', JSON.stringify(measured), ...notes, ...visualNotes(result.visual, canFix)].join('\n');
}

const LOST_REASON: Record<LostText['reason'], (l: LostText) => string> = {
  covered: (l) => `now covered by ${l.by}`,
  hidden: () => 'now hidden',
  invisible: () => 'now invisible (transparent color or opacity)',
  unmeasurable: () => 'now on an image or gradient, so it may be unreadable; the check cannot measure it',
};

/** What the visual check found, with what to do about it. Nothing when the page couldn't be checked. */
export function visualNotes(report: VisualReport | null, canFix: boolean): string[] {
  if (!report) return [];
  if (!hasProblems(report)) {
    return report.checked ? [`Visual check passed (${plural(report.checked, 'text element')} on screen): text is readable and nothing overflows.`] : [];
  }
  const lines = ['Visual check, comparing the page on screen with how it was before your change:'];
  if (report.contrast.length) {
    lines.push(`Text that is now hard to read (${plural(report.contrastElements, 'element')}):`);
    for (const p of report.contrast) {
      const count = p.count > 1 ? `${p.count} elements like ` : '';
      lines.push(`- ${count}${p.selector} ("${p.text}"): ${p.color} on ${p.background} is ${p.ratio}:1, needs ${p.required}:1`);
    }
    const listed = report.contrast.reduce((sum, p) => sum + p.count, 0);
    if (report.contrastElements > listed) lines.push(`- and ${plural(report.contrastElements - listed, 'more element')} like these`);
  }
  if (report.lost.length) {
    lines.push(`Text that was readable before your change can no longer be seen (${plural(report.lostElements, 'element')}):`);
    for (const l of report.lost) lines.push(`- ${l.count > 1 ? `${l.count} elements like ` : ''}${l.selector} ("${l.text}"): ${LOST_REASON[l.reason](l)}`);
    const listed = report.lost.reduce((sum, l) => sum + l.count, 0);
    if (report.lostElements > listed) lines.push(`- and ${plural(report.lostElements - listed, 'more element')} like these`);
  }
  for (const s of report.leftBehind) {
    lines.push(`Kept the old look while the page changed tone: ${s.selector} (${s.size}, background ${s.background}). Change it with the page unless it should stand apart, like a video player.`);
  }
  const overflow = report.horizontalOverflow;
  if (overflow) {
    lines.push(`The page now scrolls sideways: it is ${overflow.width}px wide in a ${overflow.viewport}px window${overflow.widest ? ` (widest: ${overflow.widest})` : ''}.`);
  }
  for (const c of report.clipped) lines.push(`Text is now cut off inside ${c.selector} ("${c.text}"), unless that is intended.`);
  if (report.vanished.length) {
    lines.push(
      'Images or icons that showed before now blend into what is behind them, probably drawn for the old background (seen in screenshots):',
      ...report.vanished.map((v) => `- ${v.selector}${v.label ? ` ("${v.label}")` : ''}`),
      'Give icons colors that show on the new background (fill or color for SVG icons; filter: invert(1) for single-color images), or put the logo on a background it was made for.',
    );
  }
  lines.push(
    canFix
      ? 'Fix these with another propose_patch (the complete change) before replying. Leave alone only what the user asked to hide.'
      : 'You have already tried to fix these. Do not propose again for them; tell the user in a sentence what still is not right.',
  );
  return lines;
}

export function actionReport(report: ScriptReport): string {
  const clipboard = report.outputs?.clipboard ?? null;
  const delivered = [
    ...(report.outputs?.downloads ?? []).map((d) => `downloaded ${d.filename} (${describeSize(d.text)})`),
    ...(clipboard !== null ? [`copied ${describeSize(clipboard)} to the clipboard`] : []),
  ];
  const lines = [
    `The action ran. ${delivered.length ? `Alter ${delivered.join(' and ')} for the user.` : 'It produced no file and nothing to copy.'}`,
    JSON.stringify({ errors: report.errors, logs: report.logs, stoppedReason: report.stoppedReason }),
  ];
  if (report.errors.length) lines.push('The action reported errors; fix the script and run it again if the user still wants the result.');
  else if (!delivered.length) lines.push('If the user expected a file or copied text, check the script and run it again.');
  return lines.join('\n');
}

const NOTHING_CAPTURED =
  'Alter only sees data the site loads while it is watching: from the start of each page load on sites the user has given Alter access to, and otherwise from when Alter opened. Ask the user to scroll or open more of the page so the site loads more, then look again.';

/** One line on what data the site has loaded, for the page summary. */
export function describePageData(summary: PageDataSummary | null): string {
  if (!summary) return 'not available on this page';
  if (summary.responses === 0) return 'nothing captured yet (find_page_data explains why)';
  const sources = summary.sources.map((s) => `${s.name} (${formatChars(s.chars)})`);
  return `${plural(summary.responses, 'response')}: ${sources.join(', ')}. Search it with find_page_data.`;
}

const formatChars = (chars: number) => (chars < 1024 ? `${chars} B` : `${Math.round(chars / 1024)} KB`);

/** What find_page_data found, for the model. */
export function pageDataReport(query: string, search: DataSearch): string {
  if (search.summary.responses === 0) return `No data captured on this page yet. ${NOTHING_CAPTURED}`;
  const lines = [`Data the site loaded: ${describePageData(search.summary)}`];
  if (search.total === 0) {
    lines.push(`Nothing matches "${query}". Try another key name or a value you can see on the page.`);
    return lines.join('\n');
  }
  lines.push(`Matches for "${query}" (${search.total} in all), grouped by path ([] stands for any array position):`);
  for (const m of search.matches) {
    lines.push(`- ${m.pattern} (${plural(m.count, 'match', 'matches')}, from ${m.sources.join(', ')})`);
    lines.push(`  e.g. ${m.example.path} = ${m.example.value}`);
    lines.push(`  in: ${m.context}`);
  }
  lines.push('Scripts read this data with alter.data.each or alter.data.onLoad. It can arrive after the elements it describes, so label elements when either one shows up.');
  return lines.join('\n');
}
