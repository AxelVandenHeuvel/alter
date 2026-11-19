import type { PreviewResult, Proposal } from '../../agent/agent';
import { sendToPage } from '../../lib/page-client';
import { setSuppressed } from '../../lib/tab-session';
import { disposeScript, PREVIEW_WORLD, reconcileTab, runScript, userScriptsAvailable } from '../../lib/userscripts';
import type { VisualReport } from '../../content/visual-check';
import { captureTab, vanishedGraphics, type Pixels } from './pixel-check';

/** Each tab's screenshot from before its first preview, for finding images a preview made vanish. */
const baselines = new Map<number, Pixels | null>();

/**
 * Show a proposal on the page: CSS and dark mode through the page agent, the
 * script (already approved) in the shared preview world. A saved change being
 * revised is turned off in this tab while the preview shows.
 */
export async function applyPreview(
  tabId: number,
  hostname: string,
  proposal: Proposal,
): Promise<Omit<Extract<PreviewResult, { status: 'applied' }>, 'proposalId'>> {
  await setSuppressed(tabId, proposal.revises);
  // The page agent measures the page before the first preview of a run; take the screenshot to go with it.
  if (!(await sendToPage(tabId, { type: 'alter:previewActive' })).active) baselines.set(tabId, await captureTab(tabId));
  const scripts = await userScriptsAvailable();
  if (scripts) await reconcileTab(tabId, hostname);

  const cssSummary = await sendToPage(tabId, {
    type: 'alter:preview',
    content: { css: proposal.css, darkMode: proposal.darkMode, focus: proposal.focus },
    replaces: proposal.revises,
  });
  const css = (await sendToPage(tabId, { type: 'alter:health' })).css.preview ?? null;
  const visualCheck = () => checkVisuals(tabId);
  if (!scripts) return { status: 'applied', summary: cssSummary, css, script: null, visual: await visualCheck() };

  if (!proposal.js) {
    await disposeScript(tabId, PREVIEW_WORLD);
    return { status: 'applied', summary: cssSummary, css, script: null, visual: await visualCheck() };
  }
  const script = await runScript(tabId, PREVIEW_WORLD, 'preview', proposal.js);
  // Measure again: the script may have changed the page.
  const summary = await sendToPage(tabId, { type: 'alter:summary' });
  return { status: 'applied', summary, css, script, visual: await visualCheck() };
}

async function checkVisuals(tabId: number): Promise<VisualReport | null> {
  const report = await sendToPage(tabId, { type: 'alter:visualCheck' });
  const before = baselines.get(tabId);
  if (!report || !before) return report;
  const [layout, after] = [await sendToPage(tabId, { type: 'alter:graphics' }), await captureTab(tabId)];
  return layout && after ? { ...report, vanished: vanishedGraphics(before, after, layout) } : report;
}

/** Remove the preview and put the saved changes back exactly as stored. */
export async function clearPreview(tabId: number, hostname: string): Promise<void> {
  baselines.delete(tabId);
  await sendToPage(tabId, { type: 'alter:clearPreview' }).catch(() => undefined);
  await setSuppressed(tabId, null);
  if (!(await userScriptsAvailable())) return;
  await disposeScript(tabId, PREVIEW_WORLD).catch(() => undefined);
  await reconcileTab(tabId, hostname).catch(() => undefined);
}
