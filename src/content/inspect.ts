import type { ElementSample, PageSummary, QueryResult, StylesResult } from '../lib/messages';
import { extractArticle, extractRecipe } from './focus/extract';
import { listPageData, summarizePageData } from './page-data';
import { collapseWhitespace, isHidden, luminance, parseColor, redact, selectorHint, truncate } from './dom-utils';

const MAX_SAMPLES = 5;
const MAX_STYLE_ELEMENTS = 3;
const MAX_VARIABLES = 60;

function isTransparent(color: string): boolean {
  const parsed = parseColor(color);
  return parsed === null || parsed.a < 0.05;
}

/** First opaque background found walking up from the element at the viewport center. */
function visibleBackground(doc: Document): string {
  const win = doc.defaultView!;
  let el: Element | null = doc.elementFromPoint(win.innerWidth / 2, win.innerHeight / 2);
  while (el) {
    const bg = win.getComputedStyle(el).backgroundColor;
    if (!isTransparent(bg)) return bg;
    el = el.parentElement;
  }
  // Nothing painted: the canvas color follows the used color-scheme.
  return win.getComputedStyle(doc.documentElement).colorScheme.includes('dark') ? 'rgb(18, 18, 18)' : 'rgb(255, 255, 255)';
}

function collectRootVariables(doc: Document): { name: string; value: string }[] {
  const names = new Set<string>();
  const scan = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (names.size >= 400) return;
      if (rule instanceof CSSStyleRule) {
        if (!/(^|,|\s)(:root|html|body)\b/.test(rule.selectorText)) continue;
        for (const prop of rule.style) if (prop.startsWith('--')) names.add(prop);
      } else if ('cssRules' in rule) {
        scan((rule as CSSGroupingRule).cssRules);
      }
    }
  };
  for (const sheet of doc.styleSheets) {
    try {
      scan(sheet.cssRules);
    } catch {
      // Cross-origin stylesheet without CORS: rules aren't readable.
    }
  }
  const style = doc.defaultView!.getComputedStyle(doc.documentElement);
  const colorish = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\(/i;
  const entries = Array.from(names, (name) => ({ name, value: style.getPropertyValue(name).trim() }))
    .filter((e) => e.value !== '' && e.value.length < 80);
  // Color tokens first: they are what theming requests need.
  entries.sort((a, b) => Number(colorish.test(b.value)) - Number(colorish.test(a.value)));
  return entries.slice(0, MAX_VARIABLES);
}

function frameworkHints(doc: Document): string[] {
  const hints: string[] = [];
  if (doc.getElementById('__next')) hints.push('Next.js');
  if (doc.querySelector('[data-reactroot], #root, #app')) hints.push('SPA root container');
  if (doc.querySelector('[ng-version]')) hints.push('Angular');
  if (doc.querySelector('[data-v-app], [data-server-rendered]')) hints.push('Vue');
  const customTags = new Set<string>();
  for (const el of doc.querySelectorAll('body *')) {
    if (el.tagName.includes('-')) customTags.add(el.tagName.toLowerCase().split('-')[0]!);
    if (customTags.size > 5) break;
  }
  if (customTags.size) hints.push(`custom elements (${Array.from(customTags).join(', ')}-*)`);
  if (doc.querySelector('[class*="dark"], [data-theme], [data-color-mode], [data-bs-theme]')) {
    hints.push('page has its own theme hooks (data-theme / dark classes)');
  }
  return hints;
}

function landmarks(doc: Document): string[] {
  const out: string[] = [];
  const selector = 'header, nav, main, aside, footer, [role="banner"], [role="navigation"], [role="main"], [role="complementary"], [role="contentinfo"]';
  for (const el of doc.querySelectorAll(selector)) {
    if (isHidden(el)) continue;
    const rect = el.getBoundingClientRect();
    out.push(`${selectorHint(el)} (${Math.round(rect.width)}×${Math.round(rect.height)})`);
    if (out.length >= 12) break;
  }
  return out;
}

function focusAvailability(doc: Document): PageSummary['focusAvailability'] {
  const recipe = extractRecipe(doc);
  let article: PageSummary['focusAvailability']['article'] = null;
  try {
    const found = extractArticle(doc);
    if (found) article = { title: found.title, words: found.words };
  } catch {
    // Readability can fail on unusual documents; then there is simply no article.
  }
  return { article, recipe: recipe ? { name: recipe.name } : null };
}

/** The same rule the script runtime applies: a hidden sign-in form doesn't count until it opens. */
function passwordFieldInUse(doc: Document): boolean {
  return Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="password" i]')).some(
    (field) => field === doc.activeElement || field.value !== '' || field.checkVisibility({ visibilityProperty: true }),
  );
}

export function pageSummary(doc: Document, alter: PageSummary['alter']): PageSummary {
  const win = doc.defaultView!;
  const rootStyle = win.getComputedStyle(doc.documentElement);
  const bodyStyle = doc.body ? win.getComputedStyle(doc.body) : rootStyle;
  const visible = visibleBackground(doc);
  const metaScheme = doc.querySelector('meta[name="color-scheme"]')?.getAttribute('content') ?? '';
  return {
    url: doc.location.href,
    title: doc.title,
    lang: doc.documentElement.lang,
    viewport: { width: win.innerWidth, height: win.innerHeight },
    documentHeight: doc.documentElement.scrollHeight,
    declaredColorScheme: [metaScheme, rootStyle.colorScheme].filter((s) => s && s !== 'normal').join(' / '),
    prefersDark: win.matchMedia('(prefers-color-scheme: dark)').matches,
    colors: {
      rootBackground: rootStyle.backgroundColor,
      bodyBackground: bodyStyle.backgroundColor,
      bodyText: bodyStyle.color,
      visibleBackground: visible,
      visibleBackgroundLuminance: Math.round(luminance(parseColor(visible) ?? { r: 255, g: 255, b: 255, a: 1 }) * 100) / 100,
    },
    rootVariables: collectRootVariables(doc),
    landmarks: landmarks(doc),
    frameworkHints: frameworkHints(doc),
    elementCount: doc.getElementsByTagName('*').length,
    passwordFieldInUse: passwordFieldInUse(doc),
    pageData: ((list) => (list ? summarizePageData(list) : null))(listPageData(doc)),
    focusAvailability: focusAvailability(doc),
    alter,
  };
}

function sample(el: Element): ElementSample {
  const rect = el.getBoundingClientRect();
  const attributes: Record<string, string> = {};
  for (const attr of el.attributes) {
    if (attr.name === 'style' || attr.name === 'value' || attr.name.startsWith('on')) continue;
    attributes[attr.name] = redact(truncate(attr.value, 80));
    if (Object.keys(attributes).length >= 10) break;
  }
  const clone = el.cloneNode(true) as Element;
  // Never send what the user typed into forms.
  for (const field of clone.querySelectorAll('input, textarea')) field.removeAttribute('value');
  for (const field of clone.querySelectorAll('textarea')) field.textContent = '';
  for (const heavy of clone.querySelectorAll('script, style, svg path')) heavy.remove();
  return {
    selectorHint: selectorHint(el),
    tag: el.tagName.toLowerCase(),
    attributes,
    text: redact(truncate(collapseWhitespace(el.textContent ?? ''), 120)),
    visible: !isHidden(el) && rect.width > 0 && rect.height > 0,
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    html: redact(truncate(collapseWhitespace(clone.outerHTML), 400)),
  };
}

export function queryElements(doc: Document, selector: string): QueryResult {
  try {
    const matches = doc.querySelectorAll(selector);
    return { selector, count: matches.length, samples: Array.from(matches).slice(0, MAX_SAMPLES).map(sample) };
  } catch (error) {
    return { selector, count: 0, samples: [], error: `Invalid selector: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function computedStyles(doc: Document, selector: string, properties: string[]): StylesResult {
  try {
    const matches = Array.from(doc.querySelectorAll(selector));
    const win = doc.defaultView!;
    return {
      selector,
      count: matches.length,
      elements: matches.slice(0, MAX_STYLE_ELEMENTS).map((el) => {
        const style = win.getComputedStyle(el);
        const styles: Record<string, string> = {};
        for (const prop of properties.slice(0, 30)) styles[prop] = style.getPropertyValue(prop);
        return { selectorHint: selectorHint(el), styles };
      }),
    };
  } catch (error) {
    return { selector, count: 0, elements: [], error: `Invalid selector: ${error instanceof Error ? error.message : String(error)}` };
  }
}
