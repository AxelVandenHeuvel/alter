import { isProbablyReaderable, Readability } from '@mozilla/readability';
import { pageTitle } from '../dom-utils';

/** The main article of a page, as found by Mozilla Readability (Firefox's Reader View). */
export interface Article {
  title: string;
  byline: string | null;
  siteName: string | null;
  /** Readability's cleaned HTML; still page content, so it is sanitized before display. */
  html: string;
  words: number;
}

export function extractArticle(doc: Document): Article | null {
  // Readability edits the document it reads, so give it a copy.
  const parsed = new Readability(doc.cloneNode(true) as Document, { charThreshold: 300 }).parse();
  if (!parsed?.content || !parsed.textContent?.trim()) return null;
  return {
    title: parsed.title?.trim() || pageTitle(doc),
    byline: parsed.byline?.trim() || null,
    siteName: parsed.siteName?.trim() || null,
    html: parsed.content,
    words: parsed.textContent.trim().split(/\s+/).length,
  };
}

/** Cheap check, without a full parse, for the page summary. */
export function looksReadable(doc: Document): boolean {
  return isProbablyReaderable(doc);
}

export interface Recipe {
  name: string;
  description: string | null;
  image: string | null;
  author: string | null;
  yield: string | null;
  times: { label: string; value: string }[];
  ingredients: string[];
  /** Steps, grouped when the recipe has sections ("For the sauce"). */
  instructions: { section: string | null; steps: string[] }[];
}

type Json = Record<string, unknown>;

const asArray = <T>(value: T | T[] | undefined | null): T[] => (value == null ? [] : Array.isArray(value) ? value : [value]);

function text(value: unknown): string | null {
  if (typeof value === 'string') return decodeEntities(value).replace(/\s+/g, ' ').trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
}

/** JSON-LD strings often carry HTML entities ("&amp;", "&#39;"); decode without parsing markup. */
function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function isRecipe(node: Json): boolean {
  return asArray(node['@type'] as string | string[]).some((t) => typeof t === 'string' && t.toLowerCase() === 'recipe');
}

/** Find Recipe objects anywhere in a JSON-LD value (top level, arrays, @graph, nested). */
function findRecipes(value: unknown, out: Json[], depth = 0): void {
  if (depth > 6 || value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) findRecipes(item, out, depth + 1);
    return;
  }
  const node = value as Json;
  if (isRecipe(node)) out.push(node);
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    if (key in node) findRecipes(node[key], out, depth + 1);
  }
}

/** "PT1H30M" -> "1 hr 30 min". */
export function formatDuration(iso: unknown): string | null {
  const match = typeof iso === 'string' ? iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i) : null;
  if (!match) return text(iso);
  const [, days, hours, minutes] = match.map((part) => (part ? Number(part) : 0));
  const totalHours = (days ?? 0) * 24 + (hours ?? 0);
  const parts = [totalHours ? `${totalHours} hr` : '', minutes ? `${minutes} min` : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

function imageUrl(value: unknown): string | null {
  const first = asArray(value as unknown[])[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object') return text((first as Json).url) ?? text((first as Json).contentUrl);
  return null;
}

function authorName(value: unknown): string | null {
  const first = asArray(value as unknown[])[0];
  if (typeof first === 'string') return text(first);
  if (first && typeof first === 'object') return text((first as Json).name);
  return null;
}

function stepText(step: unknown): string | null {
  if (typeof step === 'string') return text(step);
  if (step && typeof step === 'object') return text((step as Json).text) ?? text((step as Json).name);
  return null;
}

function parseInstructions(value: unknown): Recipe['instructions'] {
  if (typeof value === 'string') {
    const steps = value
      .split(/\n+|(?<=\.)\s+(?=\d+[.)]\s)/)
      .map((s) => text(s.replace(/^\d+[.)]\s*/, '')))
      .filter((s): s is string => s !== null);
    return steps.length ? [{ section: null, steps }] : [];
  }
  const groups: Recipe['instructions'] = [];
  let loose: string[] = [];
  for (const item of asArray(value as unknown[])) {
    const node = item as Json;
    const types = asArray(node?.['@type'] as string | string[]);
    if (types.includes('HowToSection')) {
      if (loose.length) groups.push({ section: null, steps: loose });
      loose = [];
      const steps = asArray(node.itemListElement as unknown[]).map(stepText).filter((s): s is string => s !== null);
      if (steps.length) groups.push({ section: text(node.name), steps });
    } else {
      const step = stepText(item);
      if (step) loose.push(step);
    }
  }
  if (loose.length) groups.push({ section: null, steps: loose });
  return groups;
}

/** The page's schema.org Recipe (JSON-LD), which most recipe sites publish for search engines. */
export function extractRecipe(doc: Document): Recipe | null {
  const found: Json[] = [];
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      findRecipes(JSON.parse(script.textContent ?? ''), found);
    } catch {
      // Malformed JSON-LD is common; skip it.
    }
  }
  const node = found.find((r) => asArray(r.recipeIngredient as unknown[]).length > 0) ?? found[0];
  if (!node) return null;

  const ingredients = asArray(node.recipeIngredient as unknown[])
    .map(text)
    .filter((s): s is string => s !== null);
  const instructions = parseInstructions(node.recipeInstructions);
  if (!ingredients.length && !instructions.length) return null;

  const times = [
    { label: 'Prep', value: formatDuration(node.prepTime) },
    { label: 'Cook', value: formatDuration(node.cookTime) },
    { label: 'Total', value: formatDuration(node.totalTime) },
  ].filter((t): t is { label: string; value: string } => t.value !== null);
  const servings = asArray(node.recipeYield as unknown[]).map(text).filter(Boolean);

  return {
    name: text(node.name) ?? pageTitle(doc),
    description: text(node.description),
    image: imageUrl(node.image),
    author: authorName(node.author),
    yield: servings.sort((a, b) => b!.length - a!.length)[0] ?? null,
    times,
    ingredients,
    instructions,
  };
}
