import type { CssHealth } from '../content/health';
import type { DataSearch, PageDataSummary } from '../content/page-data';
import type { AreaSelection } from '../content/select-area';
import type { Box, GraphicPair, VisualReport } from '../content/visual-check';
import type { WidgetAction, WidgetState } from '../content/widget';
import type { StyleContent } from './patches';

/** What the focus view is doing on this page right now. */
export type FocusStatus =
  | { state: 'off' }
  | { state: 'looking' }
  | { state: 'showing'; view: 'reader' | 'recipe'; title: string; fellBack: boolean }
  | { state: 'not-found'; mode: 'reader' | 'recipe' }
  | { state: 'closed'; view: 'reader' | 'recipe' };

/**
 * Typed requests from extension pages (the panel, the background) to the page agent content
 * script. Content scripts only *answer* messages: Dark Reader's library wraps
 * chrome.runtime.sendMessage in the content script world and drops its return
 * value, so request/response always flows extension page -> tab.
 */

export interface PageSummary {
  url: string;
  title: string;
  lang: string;
  viewport: { width: number; height: number };
  documentHeight: number;
  /** The page's declared color-scheme (meta tag or CSS), if any. */
  declaredColorScheme: string;
  prefersDark: boolean;
  colors: {
    rootBackground: string;
    bodyBackground: string;
    bodyText: string;
    /** Background actually visible behind the center of the viewport. */
    visibleBackground: string;
    visibleBackgroundLuminance: number;
  };
  /** CSS custom properties on :root whose values look like colors or sizes. */
  rootVariables: { name: string; value: string }[];
  landmarks: string[];
  frameworkHints: string[];
  elementCount: number;
  /** A password field is showing, focused, or filled in; scripts never run then (see the runtime). */
  passwordFieldInUse: boolean;
  /** Data the site has loaded that change scripts can read; null when Alter isn't capturing on this page. */
  pageData: PageDataSummary | null;
  /** What the focus views would find on this page. */
  focusAvailability: { article: { title: string; words: number } | null; recipe: { name: string } | null };
  alter: { savedPatchIds: string[]; previewActive: boolean; darkModeActive: boolean; paused: boolean; focus: FocusStatus };
}

export interface ElementSample {
  selectorHint: string;
  tag: string;
  attributes: Record<string, string>;
  text: string;
  visible: boolean;
  rect: { x: number; y: number; width: number; height: number };
  html: string;
}

export interface QueryResult {
  selector: string;
  count: number;
  samples: ElementSample[];
  error?: string;
}

export interface StylesResult {
  selector: string;
  count: number;
  elements: { selectorHint: string; styles: Record<string, string> }[];
  error?: string;
}

export type PageRequest =
  | { type: 'alter:ping' }
  | { type: 'alter:summary' }
  | { type: 'alter:snapshot'; focusTerms: string[]; maxChars: number }
  | { type: 'alter:query'; selector: string }
  | { type: 'alter:styles'; selector: string; properties: string[] }
  /** Search the data the site has loaded (see content/page-data.ts). */
  | { type: 'alter:pageData'; query: string }
  | { type: 'alter:preview'; content: StyleContent; replaces: string | null }
  | { type: 'alter:clearPreview' }
  /** While the user holds "compare", show the page without the preview (as it was before it). */
  | { type: 'alter:compare'; showOriginal: boolean }
  | { type: 'alter:health' }
  /** Readability and layout problems the current preview caused, compared with the page before the first preview. */
  | { type: 'alter:visualCheck' }
  /** Whether a preview is showing, so the panel knows when a new run of previews starts. */
  | { type: 'alter:previewActive' }
  /** Images and icons on screen before the first preview and at the last visual check, to compare in screenshots. */
  | { type: 'alter:graphics' }
  /** The floating panel: from the toolbar icon, menu, or shortcut (open/toggle), or the panel itself (minimize/close). */
  | { type: 'alter:widget'; action: WidgetAction; tabId: number }
  /**
   * Let the user drag a box over the page. Alter's panel stays hidden afterwards so the
   * caller can take a screenshot of the area; it then sends the 'reveal' widget action.
   */
  | { type: 'alter:selectArea' };

export interface PageResponses {
  /** pageKey identifies this page load (its document's creation time); it changes on reload or navigation. */
  'alter:ping': { ok: true; pageKey: string };
  'alter:summary': PageSummary;
  'alter:snapshot': { text: string; truncated: boolean; matchedFocus: number };
  'alter:query': QueryResult;
  'alter:styles': StylesResult;
  'alter:pageData': DataSearch;
  'alter:preview': PageSummary;
  'alter:clearPreview': { ok: true };
  'alter:compare': { ok: true };
  'alter:health': PageHealth;
  'alter:visualCheck': VisualReport | null;
  'alter:previewActive': { active: boolean };
  'alter:graphics': GraphicsLayout | null;
  'alter:widget': { state: WidgetState };
  'alter:selectArea': { selection: AreaSelection | null };
}

export interface GraphicsLayout {
  pairs: GraphicPair[];
  /** Screenshot pixels per CSS pixel. */
  scale: number;
  /** Parts of the window Alter's own panel covers. */
  covered: Box[];
}

export interface PageHealth {
  /** CSS health per rendered layer: saved patch ids, and 'preview'. Layers without CSS are absent. */
  css: Record<string, CssHealth>;
  darkModeActive: boolean;
  focus: FocusStatus;
  paused: boolean;
}

export type PageResponse<T extends PageRequest['type']> = PageResponses[T];

/** Wire envelope so failures inside the content script surface as real errors. */
export type Envelope<T> = { ok: true; value: T } | { ok: false; error: string };

export function isPageRequest(message: unknown): message is PageRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    typeof (message as { type?: unknown }).type === 'string' &&
    (message as { type: string }).type.startsWith('alter:')
  );
}
