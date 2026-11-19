import { describe, expect, it } from 'vitest';
import { DEFAULT_SUGGESTIONS, suggestionsFor } from '../../src/entrypoints/panel/suggestions';

const page = (changes: { luminance?: number; article?: number; recipe?: boolean; landmarks?: string[] } = {}) => ({
  colors: {
    rootBackground: '',
    bodyBackground: '',
    bodyText: '',
    visibleBackground: '',
    visibleBackgroundLuminance: changes.luminance ?? 1,
  },
  focusAvailability: {
    article: changes.article === undefined ? null : { title: 'Story', words: changes.article },
    recipe: changes.recipe ? { name: 'Soup' } : null,
  },
  landmarks: changes.landmarks ?? [],
});

describe('suggestionsFor', () => {
  it('falls back to general ideas while the page is unknown', () => {
    expect(suggestionsFor(null)).toEqual(DEFAULT_SUGGESTIONS);
  });

  it('offers the recipe view first on recipe pages', () => {
    expect(suggestionsFor(page({ recipe: true, article: 900 }))[0]).toBe('Show just the recipe');
  });

  it('offers the article view only for real articles', () => {
    expect(suggestionsFor(page({ article: 900 }))[0]).toBe('Show just the article');
    expect(suggestionsFor(page({ article: 40 }))).not.toContain('Show just the article');
  });

  it('suggests a light theme on dark pages instead of a dark mode', () => {
    expect(suggestionsFor(page({ luminance: 0.05 }))).toContain('Make it a light theme');
    expect(suggestionsFor(page({ luminance: 0.05 }))).not.toContain('Create a dark mode');
  });

  it('offers to hide a sidebar only when there is one', () => {
    expect(suggestionsFor(page({ landmarks: ['main > aside.related (300×800)'] }))).toContain('Hide the sidebar');
    expect(suggestionsFor(page())).toEqual(['Create a dark mode', 'Make the text bigger', 'Hide ads and pop-ups', 'Use calmer colors']);
  });
});
