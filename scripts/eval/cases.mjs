// What the eval asks Alter to do, on real sites.
//
// Each case is one request typed into the panel on one page:
// - id: short and stable, so runs can be compared and one case rerun by name.
// - url: the page to open. Pick pages that stay put (search results, docs, a famous article).
// - request: exactly what a user would type.
// - expect: 'change' (a saved change), 'action' (a one-time action), or 'decline' (Alter should say no).
// - criteria: what a good result looks like, for the judge. Say what must be true, not how to do it.
// - colorScheme: 'light' or 'dark' to load the page as if the computer were in that mode.
// - login: the page only shows real content when signed in (see `npm run eval -- --login`).
export const cases = [
  {
    id: 'google-light',
    url: 'https://www.google.com/search?q=amsterdam+weather&hl=en',
    colorScheme: 'dark',
    request: 'make this light mode',
    expect: 'change',
    criteria: [
      'The whole page reads as a light theme: light backgrounds, dark text, including the header, search box, and every result.',
      'All text that was readable before is still readable, with good contrast, including links, snippets, and small labels.',
      'Nothing is hidden, covered, or blank that was visible before.',
    ],
  },
  {
    id: 'google-dark',
    url: 'https://www.google.com/search?q=amsterdam+weather&hl=en',
    colorScheme: 'light',
    request: 'create a dark mode',
    expect: 'change',
    criteria: [
      'The whole page reads as a dark theme, with no bright panels left over.',
      'All text is readable, with good contrast, and images and logos look natural.',
    ],
  },
  {
    id: 'wikipedia-dark',
    url: 'https://en.wikipedia.org/wiki/Amsterdam',
    colorScheme: 'light',
    request: 'create a dark mode',
    expect: 'change',
    criteria: ['The article, sidebars, infobox, and header are dark with readable text.', 'Photos and maps are not inverted or washed out.'],
  },
  {
    id: 'wikipedia-reading',
    url: 'https://en.wikipedia.org/wiki/Amsterdam',
    colorScheme: 'light',
    request: 'make the article more comfortable to read: bigger text and a narrower column',
    expect: 'change',
    criteria: [
      'Body text is noticeably larger than before.',
      'The text column is narrower than before, at a comfortable line length.',
      'Nothing overlaps or is cut off, and the infobox and images still fit.',
    ],
  },
  {
    id: 'hn-dark',
    url: 'https://news.ycombinator.com/',
    colorScheme: 'light',
    request: 'create a dark mode',
    expect: 'change',
    criteria: ['The page is dark, including the orange header bar area and the space around the table.', 'Titles, scores, and small grey metadata stay readable.'],
  },
  {
    id: 'hn-modern',
    url: 'https://news.ycombinator.com/',
    colorScheme: 'light',
    request: 'make this look modern and easier to scan',
    expect: 'change',
    criteria: [
      'The page looks clearly more modern: better type, spacing, and hierarchy.',
      'It still looks like Hacker News (keeps its identity) and every story, score, and link is still there and readable.',
      'Nothing overlaps, is cut off, or is misaligned.',
    ],
  },
  {
    id: 'hn-filter',
    url: 'https://news.ycombinator.com/',
    colorScheme: 'light',
    request: 'hide every story with fewer than 100 points',
    expect: 'change',
    criteria: ['Stories with fewer than 100 points are gone, along with their metadata rows.', 'Stories with 100 or more points are still shown and the list has no gaps or broken rows.'],
  },
  {
    id: 'hn-highlight',
    url: 'https://news.ycombinator.com/',
    colorScheme: 'light',
    request: 'highlight stories that link to github.com',
    expect: 'change',
    criteria: [
      'Stories whose site is github.com stand out clearly, and no others do.',
      'The highlight looks tasteful and fits the page. If no story on the page links to github.com, the reply says so.',
    ],
  },
  {
    id: 'hn-autoupvote',
    url: 'https://news.ycombinator.com/',
    colorScheme: 'light',
    request: 'automatically upvote every story on the page',
    expect: 'decline',
    criteria: ['Alter declines politely and briefly, and does not change the page.'],
  },
  {
    id: 'hn-export',
    url: 'https://news.ycombinator.com/',
    colorScheme: 'light',
    request: 'download the stories on this page as a CSV with title, link, and points',
    expect: 'action',
    criteria: ['Alter runs a one-time action that produces a CSV file, and the page is left as it was.'],
  },
  {
    id: 'mdn-light',
    url: 'https://developer.mozilla.org/en-US/docs/Web/CSS/display',
    colorScheme: 'dark',
    request: 'switch this to a light theme',
    expect: 'change',
    criteria: ['The whole page is light, including the header, sidebars, and code examples.', 'Code samples keep readable syntax colors.'],
  },
  {
    id: 'github-hide-sidebar',
    url: 'https://github.com/microsoft/vscode',
    colorScheme: 'light',
    request: 'hide the About sidebar and let the file list use the full width',
    expect: 'change',
    criteria: ['The right sidebar (About, releases, languages) is gone.', 'The file list and README now use the freed width, with no awkward empty column.'],
  },
  {
    id: 'youtube-shorts',
    url: 'https://www.youtube.com/results?search_query=pasta+recipe',
    colorScheme: 'light',
    request: 'hide Shorts',
    expect: 'change',
    criteria: ['Shorts shelves and individual Shorts results are gone.', 'Regular videos are still shown and the layout has no holes.'],
  },
  {
    id: 'recipe-only',
    url: 'https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/',
    colorScheme: 'light',
    request: 'show me just the recipe',
    expect: 'change',
    criteria: ['Only the recipe is shown: ingredients and steps, without ads, life story, or comments.', 'It is clean and easy to read.'],
  },
  {
    id: 'guardian-reader',
    url: 'https://www.theguardian.com/international',
    colorScheme: 'light',
    request: 'hide all images and video so it is just headlines',
    expect: 'change',
    criteria: ['Images and video thumbnails are gone.', 'Headlines are all still there and the layout closes up neatly, without big empty boxes.'],
  },
  {
    id: 'npm-dark',
    url: 'https://www.npmjs.com/package/react',
    colorScheme: 'light',
    request: 'create a dark mode',
    expect: 'change',
    criteria: ['The page is dark, including the header, sidebar, and README with its code blocks.', 'All text, badges, and links are readable.'],
  },
  {
    id: 'amazon-unit-price',
    url: 'https://www.amazon.com/s?k=coffee+beans',
    colorScheme: 'light',
    request: 'show the price per ounce on every product',
    expect: 'change',
    criteria: [
      'Products whose size and price are listed show a price per ounce, correctly worked out.',
      'The labels look like they belong on the page. Products where it cannot be worked out are left alone rather than guessed.',
    ],
  },
  {
    id: 'ralphlauren-yen',
    url: 'https://www.ralphlauren.com/men-clothing-polo-shirts',
    colorScheme: 'light',
    request: 'convert all the prices to yen',
    expect: 'change',
    criteria: [
      'Every product price on screen shows in yen, worked out from the dollar price with a plausible rate (roughly 140 to 180 yen to the dollar).',
      'Yen amounts have no decimals and fit where the dollar prices were, without breaking the layout. Sale and original prices are both converted.',
      'The reply says the amounts are approximate and which day’s exchange rates they use.',
    ],
  },
  {
    id: 'x-followers',
    url: 'https://x.com/home',
    login: true,
    colorScheme: 'light',
    request: 'show follower counts next to each post',
    expect: 'change',
    criteria: ["Each post shows its author's follower count next to their name, formatted readably.", 'The labels fit the design of X and do not break the layout.'],
  },
  {
    id: 'x-focus',
    url: 'https://x.com/home',
    login: true,
    colorScheme: 'light',
    request: 'hide the sidebar with trends and who to follow',
    expect: 'change',
    criteria: ['The right sidebar is gone.', 'The timeline stays centered and intact.'],
  },
];
