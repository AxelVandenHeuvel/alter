import { Applier } from '../content/applier';
import { describeArea, pickArea } from '../content/select-area';
import { Widget } from '../content/widget';
import { computedStyles, pageSummary, queryElements } from '../content/inspect';
import { takeSnapshot } from '../content/snapshot';
import { compare, graphicPairs, measure, type Measurement } from '../content/visual-check';
import { readPageData, searchPageData } from '../content/page-data';
import { isPageRequest, type Envelope, type PageRequest, type PageResponses } from '../lib/messages';
import { getPatches, normalizePatch, storageKey, type Patch } from '../lib/patches';
import { getSettings, SETTINGS_KEY, type Settings } from '../lib/settings';

/**
 * The page agent. Injected on demand when the user opens Alter on a page (it hosts the floating panel),
 * and registered at document_start on hosts that have saved patches so they
 * apply before first paint.
 */
export default defineContentScript({
  registration: 'runtime',
  runAt: 'document_start',
  noScriptStartedPostMessage: true,
  main(ctx) {
    // Only one copy of the page agent controls a page. When another copy starts (a second
    // injection, or the fresh copy loaded after Alter reloads or updates), WXT invalidates this
    // one; it then removes what it added and stops responding, and the new copy takes over.
    const hostname = location.hostname;
    const applier = new Applier(document);
    const widget = new Widget(document);
    ctx.onInvalidated(() => {
      applier.destroy();
      widget.close();
    });
    // A copy cut off by an extension reload hears nothing more. WXT's interval checks whether
    // this copy is still connected on every tick, which invalidates (and cleans up) an orphan.
    ctx.setInterval(() => undefined, 2000);

    void Promise.all([getPatches(hostname), getSettings()]).then(([patches, settings]) => {
      applier.setPaused(settings.paused);
      applier.setSaved(patches);
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || ctx.isInvalid) return;
      const patchChange = changes[storageKey(hostname)];
      if (patchChange) applier.setSaved(((patchChange.newValue as Patch[] | undefined) ?? []).map(normalizePatch));
      const settingsChange = changes[SETTINGS_KEY];
      if (settingsChange) applier.setPaused(Boolean((settingsChange.newValue as Settings | undefined)?.paused));
    });

    // How the page looked before the current run of previews; each preview is checked against it.
    let beforePreview: Measurement | null = null;
    // The page at the last visual check, for the panel's screenshot comparison.
    let lastChecked: Measurement | null = null;

    const handle = async (request: PageRequest): Promise<PageResponses[PageRequest['type']]> => {
      switch (request.type) {
        case 'alter:ping':
          return { ok: true, pageKey: String(performance.timeOrigin) };
        case 'alter:summary':
          return pageSummary(document, applier.state);
        case 'alter:snapshot':
          return takeSnapshot(document, { focusTerms: request.focusTerms, maxChars: request.maxChars });
        case 'alter:query':
          return queryElements(document, request.selector);
        case 'alter:styles':
          return computedStyles(document, request.selector, request.properties);
        case 'alter:pageData':
          return searchPageData(readPageData(document), request.query);
        case 'alter:preview':
          if (!applier.state.previewActive) beforePreview = measure(document);
          applier.setPreview(request.content, request.replaces);
          // Let the new styles (and Dark Reader) settle before measuring the result.
          await waitForPaint();
          return pageSummary(document, applier.state);
        case 'alter:clearPreview':
          applier.setPreview(null);
          beforePreview = lastChecked = null;
          return { ok: true };
        case 'alter:compare':
          applier.setComparing(request.showOriginal);
          return { ok: true };
        case 'alter:widget':
          await widget.perform(request.action, request.tabId);
          return { state: widget.state };
        case 'alter:selectArea': {
          widget.conceal();
          const rect = await pickArea(document);
          if (!rect) {
            widget.reveal();
            return { selection: null };
          }
          const selection = describeArea(document, rect);
          // Let the page repaint without the overlay before the screenshot is taken.
          await waitForPaint();
          return { selection };
        }
        case 'alter:health':
          return applier.health();
        case 'alter:visualCheck':
          if (!applier.state.previewActive) return null;
          lastChecked = measure(document, beforePreview);
          return compare(beforePreview, lastChecked);
        case 'alter:previewActive':
          return { active: applier.state.previewActive };
        case 'alter:graphics':
          if (!beforePreview || !lastChecked) return null;
          return {
            pairs: graphicPairs(beforePreview, lastChecked),
            scale: window.devicePixelRatio,
            covered: widget.covered().map(({ left, top, width, height }) => ({ left, top, width, height })),
          };
      }
    };

    chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (!isPageRequest(message) || ctx.isInvalid) return false;
      handle(message)
        .then((value) => sendResponse({ ok: true, value } satisfies Envelope<unknown>))
        .catch((error: unknown) =>
          sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies Envelope<unknown>),
        );
      return true;
    });
  },
});

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    // requestAnimationFrame never fires in hidden tabs, so cap the wait.
    const fallback = setTimeout(resolve, 400);
    requestAnimationFrame(() =>
      setTimeout(() => {
        clearTimeout(fallback);
        resolve();
      }, 150),
    );
  });
}
