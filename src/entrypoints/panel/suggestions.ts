import type { PageSummary } from '../../lib/messages';

const MAX = 4;
/** Below this, "just the article" isn't worth offering: the page is mostly not an article. */
const ARTICLE_WORDS = 250;

export const DEFAULT_SUGGESTIONS = ['Create a dark mode', 'Make the text bigger', 'Hide the sidebar', 'Use calmer colors'];

/**
 * Starting points that fit the page the user is on: the recipe or article view
 * when there is one, a light theme for pages that are already dark, and the
 * general ones after that.
 */
export function suggestionsFor(summary: Pick<PageSummary, 'colors' | 'focusAvailability' | 'landmarks'> | null): string[] {
  if (!summary) return DEFAULT_SUGGESTIONS;
  const picks: string[] = [];
  const { recipe, article } = summary.focusAvailability;
  if (recipe) picks.push('Show just the recipe');
  else if (article && article.words >= ARTICLE_WORDS) picks.push('Show just the article');

  const dark = summary.colors.visibleBackgroundLuminance < 0.2;
  picks.push(dark ? 'Make it a light theme' : 'Create a dark mode');
  picks.push('Make the text bigger');
  // Landmarks are selector hints like "main > aside.related (300×800)".
  const hasSidebar = summary.landmarks.some((l) => /(^|> )aside\b/.test(l));
  picks.push(hasSidebar ? 'Hide the sidebar' : 'Hide ads and pop-ups');
  picks.push('Use calmer colors');
  return picks.slice(0, MAX);
}
