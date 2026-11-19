import { describe, expect, it } from 'vitest';
import { extractArticle, extractRecipe, formatDuration } from '../../src/content/focus/extract';
import { sanitizeArticleHtml } from '../../src/content/focus/sanitize';
import { headlineFor } from '../../src/content/focus/view';

function load(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

const ldJson = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

describe('extractRecipe', () => {
  it('reads a recipe inside an @graph, with sections, times, and entities', () => {
    const doc = load(
      ldJson({
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebSite', name: 'Blog' },
          {
            '@type': ['Recipe', 'NewsArticle'],
            name: 'Lemon Pasta',
            author: [{ '@type': 'Person', name: 'Sam Lee' }],
            prepTime: 'PT10M',
            cookTime: 'PT1H5M',
            recipeYield: ['4', '4 servings'],
            image: [{ '@type': 'ImageObject', url: 'https://img.example/pasta.jpg' }],
            recipeIngredient: ['200 g spaghetti', 'Salt &amp; pepper'],
            recipeInstructions: [
              { '@type': 'HowToSection', name: 'Pasta', itemListElement: [{ '@type': 'HowToStep', text: 'Boil it.' }] },
              { '@type': 'HowToStep', text: 'Serve.' },
            ],
          },
        ],
      }),
    );
    expect(extractRecipe(doc)).toEqual({
      name: 'Lemon Pasta',
      description: null,
      image: 'https://img.example/pasta.jpg',
      author: 'Sam Lee',
      yield: '4 servings',
      times: [
        { label: 'Prep', value: '10 min' },
        { label: 'Cook', value: '1 hr 5 min' },
      ],
      ingredients: ['200 g spaghetti', 'Salt & pepper'],
      instructions: [
        { section: 'Pasta', steps: ['Boil it.'] },
        { section: null, steps: ['Serve.'] },
      ],
    });
  });

  it('handles plain-string instructions and skips malformed JSON-LD', () => {
    const doc = load(
      `<script type="application/ld+json">{ not json</script>` +
        ldJson([{ '@type': 'Recipe', name: 'Toast', recipeIngredient: ['Bread'], recipeInstructions: 'Toast the bread.\nButter it.' }]),
    );
    expect(extractRecipe(doc)?.instructions).toEqual([{ section: null, steps: ['Toast the bread.', 'Butter it.'] }]);
  });

  it('returns null without recipe data', () => {
    expect(extractRecipe(load(ldJson({ '@type': 'NewsArticle', headline: 'News' })))).toBeNull();
  });

  it('formats ISO 8601 durations', () => {
    expect(formatDuration('PT45M')).toBe('45 min');
    expect(formatDuration('PT2H')).toBe('2 hr');
    expect(formatDuration('P1DT2H')).toBe('26 hr');
    expect(formatDuration('about an hour')).toBe('about an hour');
  });
});

describe('extractArticle', () => {
  it('finds the main article and leaves the site chrome behind', () => {
    const paragraphs = Array.from({ length: 8 }, (_, i) => `<p>Story paragraph ${i + 1}, with enough words to read like a real article about the river path and the city.</p>`).join('');
    const doc = load(
      `<title>River Path | Daily Paper</title><nav><a href="/">Home</a></nav><aside>Sign up for our newsletter!</aside><article><h1>River Path Opens</h1>${paragraphs}</article><footer>Copyright</footer>`,
    );
    const article = extractArticle(doc)!;
    expect(article.html).toContain('Story paragraph 8');
    expect(article.html).not.toContain('newsletter');
    expect(article.words).toBeGreaterThan(100);
  });
});

describe('sanitizeArticleHtml', () => {
  const clean = (html: string) => {
    const host = document.createElement('div');
    host.append(sanitizeArticleHtml(html, 'https://news.example/story', document));
    return host.innerHTML;
  };

  it('keeps text structure, links, and images, with absolute URLs', () => {
    expect(clean('<div><p>Hi <a href="/more" title="t">more</a></p><img src="/a.jpg" alt="A"></div>')).toBe(
      '<p>Hi <a href="https://news.example/more" title="t" target="_blank" rel="noopener noreferrer">more</a></p>' +
        '<img src="https://news.example/a.jpg" alt="A" loading="lazy" referrerpolicy="no-referrer">',
    );
  });

  it('drops scripts, handlers, styles, embeds, forms, and unsafe URLs', () => {
    const out = clean(
      '<p style="color:red" onclick="x()">Text<script>alert(1)</script></p><iframe title="embed"></iframe>' +
        '<a href="javascript:alert(1)">bad</a><img src="javascript:alert(1)"><form><input value="x"></form><svg><a href="#"></a></svg>',
    );
    expect(out).toBe('<p>Text</p><a>bad</a>');
  });
});

describe('headlineFor', () => {
  const article = (title: string, siteName: string | null = 'Daily Paper') => ({ title, byline: null, siteName, html: '', words: 0 });
  const body = (html: string) => {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el;
  };

  it('uses the article heading instead of the tab title, and shows it once', () => {
    const content = body('<h1>River Path Opens to Walkers and Cyclists</h1><p>Text</p>');
    expect(headlineFor(article('River Path Opens to Walkers and Cyclists | Daily Paper'), content)).toBe(
      'River Path Opens to Walkers and Cyclists',
    );
    expect(content.querySelector('h1')).toBeNull();
  });

  it('strips the site name from the tab title when the body has no matching heading', () => {
    expect(headlineFor(article('Budget Passes - Daily Paper'), body('<p>Text</p>'))).toBe('Budget Passes');
    expect(headlineFor(article('Budget Passes | Daily Paper'), body('<h2>Related stories</h2><p>x</p>'))).toBe('Budget Passes');
  });

  it('keeps titles whose parts are all part of the story', () => {
    expect(headlineFor(article('Rust vs Go: A Practical Comparison', null), body('<p>Text</p>'))).toBe('Rust vs Go: A Practical Comparison');
  });
});
