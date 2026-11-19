import type { z } from 'zod';
import type { CssHealth } from '../content/health';
import type { AreaSelection } from '../content/select-area';
import { hasProblems, type VisualReport } from '../content/visual-check';
import { checkCss } from '../lib/css-safety';
import { hostnameOf } from '../lib/host';
import { checkJs } from '../lib/js-safety';
import type { DataSearch } from '../content/page-data';
import type { PageSummary, QueryResult, StylesResult } from '../lib/messages';
import type { Patch, PatchContent } from '../lib/patches';
import { isSensitiveHost } from '../lib/sensitive';
import type { ScriptReport } from '../lib/userscripts';
import { focusTermsFor, formatPageContext, formatSavedChanges, formatScreenshots, SYSTEM_PROMPT } from './prompt';
import type { ImageInput, ModelProvider, ModelSession, TokenUsage, ToolCall, ToolOutcome, TurnInput } from './provider';
import { actionReport, DECLINED_ACTION, DECLINED_SCRIPT, pageDataReport, previewReport } from './reports';
import { toFocusSettings, TOOL_INPUTS, TOOL_SPECS, type ToolName } from './tools';

/** What the agent needs from the page. Implemented over content-script messaging. */
export interface PageTools {
  summary(): Promise<PageSummary>;
  snapshot(focusTerms: string[], maxChars: number): Promise<{ text: string; truncated: boolean; matchedFocus: number }>;
  query(selector: string): Promise<QueryResult>;
  styles(selector: string, properties: string[]): Promise<StylesResult>;
  /** Search the data the site has loaded. */
  pageData(query: string): Promise<DataSearch>;
  /**
   * Show the proposal as a live preview, replacing any earlier preview. While it
   * shows, the saved patch it revises (if any) is turned off. Proposals with a
   * script wait for the user to approve running it.
   */
  preview(proposal: Proposal): Promise<PreviewResult>;
  /** Changes the user has saved for this site. */
  savedPatches(): Promise<Patch[]>;
  /** What the user has done with a previewed proposal since (by the id preview() returned). */
  proposalStatus(proposalId: string): ProposalStatus;
  /** Run a one-time action after the user approves it, and deliver what it produced. */
  runAction(action: Action): Promise<ActionResult>;
}

export type ProposalStatus = 'previewing' | 'saved' | 'discarded' | 'other';

/** A script run once on the current page to produce a file or clipboard text. */
export interface Action {
  title: string;
  summary: string;
  js: string;
}

export type ActionResult = { status: 'ran'; report: ScriptReport } | { status: 'declined' };

export type PreviewResult =
  | {
      status: 'applied';
      proposalId: string;
      summary: PageSummary;
      css: CssHealth | null;
      script: ScriptReport | null;
      /** Readability and layout problems the change caused, or null when the page couldn't be checked. */
      visual: VisualReport | null;
    }
  | { status: 'declined' };

export interface Proposal extends PatchContent {
  title: string;
  summary: string;
  /** The saved patch this proposal updates, or null for a new change. */
  revises: string | null;
}

/** An image the user attached: a selected area of the page (with what's in it) or a pasted screenshot. */
export interface Screenshot {
  image: ImageInput;
  selection: AreaSelection | null;
}

export interface AgentState {
  session: unknown;
  /** The provider and model the session's transcript was written by ("anthropic:claude-sonnet-5-5"). */
  sessionOwner: string;
  lastUrl: string | null;
  lastSaved: string | null;
  latest: Proposal | null;
  latestId: string | null;
  reportedStatus: ProposalStatus;
}

export type AgentEvent =
  | { type: 'status'; text: string }
  | { type: 'progress'; text: string }
  /** After every model call, what it used (for showing what the request cost). */
  | { type: 'usage'; usage: TokenUsage };

export interface RunOptions {
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  /** What the user pointed at, attached to this request. */
  screenshots?: Screenshot[];
  /** Runs before every model call; throw to stop the run (e.g. a spending limit was reached). */
  beforeTurn?: () => void | Promise<void>;
}

export interface AgentReply {
  text: string;
  proposal: Proposal | null;
}

const SNAPSHOT_CHARS = 24_000;
const MAX_TURNS = 14;
/** Times per request the model is asked to fix problems the visual check found, before it tells the user instead. */
const MAX_FIX_ROUNDS = 2;

const STATUS: Record<ToolName, string> = {
  get_snapshot: 'Reading the page',
  query_selector: 'Checking elements',
  get_computed_styles: 'Reading styles',
  find_page_data: 'Looking through the site’s data',
  propose_patch: 'Applying preview',
  run_action: 'Preparing the action',
};

/**
 * One conversation about one tab. Runs the tool loop: the model inspects the
 * page, proposes a patch, sees the measured result, and refines until done.
 */
export class AlterAgent {
  private session: ModelSession | null = null;
  private lastUrl: string | null = null;
  private lastSaved: string | null = null;
  private saved: Patch[] = [];
  private scriptsAllowed = true;
  private latest: Proposal | null = null;
  private latestId: string | null = null;
  /** The status of `latest` the model was last told about. */
  private reportedStatus: ProposalStatus = 'previewing';
  /** A saved session to continue, until the session is first needed. */
  private savedSession: unknown;
  /** Previews in this run that the visual check found problems with. */
  private flaggedPreviews = 0;

  constructor(
    private readonly provider: ModelProvider,
    private readonly page: PageTools,
    state?: AgentState,
  ) {
    if (state) {
      // A transcript only continues with the provider and model that wrote it (formats differ, and
      // Claude's thinking is tied to its model). Otherwise start a new one, re-sending the page context.
      if (state.sessionOwner === sessionOwner(provider)) {
        this.savedSession = state.session;
        this.lastUrl = state.lastUrl;
        this.lastSaved = state.lastSaved;
      }
      this.latest = state.latest;
      this.latestId = state.latestId;
      this.reportedStatus = state.reportedStatus;
    }
  }

  get model(): string {
    return this.provider.model;
  }

  /** Everything needed to continue this conversation later, as plain JSON. */
  export(): AgentState {
    return {
      session: this.session ? this.session.export() : this.savedSession,
      sessionOwner: sessionOwner(this.provider),
      lastUrl: this.lastUrl,
      lastSaved: this.lastSaved,
      latest: this.latest,
      latestId: this.latestId,
      reportedStatus: this.reportedStatus,
    };
  }

  async run(request: string, { signal, onEvent, screenshots = [], beforeTurn }: RunOptions): Promise<AgentReply> {
    this.session ??= this.provider.createSession({ system: SYSTEM_PROMPT, tools: TOOL_SPECS }, this.savedSession);
    const proposalBefore = this.latest;
    this.flaggedPreviews = 0;

    onEvent({ type: 'status', text: 'Reading the page' });
    const [summary, saved] = await Promise.all([this.page.summary(), this.page.savedPatches()]);
    this.saved = saved;
    const hostname = hostnameOf(summary.url) ?? '';
    this.scriptsAllowed = !isSensitiveHost(hostname) && !summary.passwordFieldInUse;
    const parts: string[] = [];
    if (summary.url !== this.lastUrl) {
      // First turn, or the user navigated: give the model a fresh look at the page.
      const focusTerms = focusTermsFor(request);
      const snapshot = await this.page.snapshot(focusTerms, SNAPSHOT_CHARS);
      parts.push(formatPageContext(summary, snapshot, focusTerms, this.scriptsAllowed));
      this.lastUrl = summary.url;
    }
    // Saved changes are re-sent whenever the user saved, edited, or toggled one.
    const savedBlock = formatSavedChanges(saved);
    if (savedBlock !== this.lastSaved) {
      parts.push(savedBlock);
      this.lastSaved = savedBlock;
    }
    // The user acts on proposals in the panel (save, discard) without the model seeing it.
    const statusNote = this.latestStatusNote();
    if (statusNote) parts.push(`<preview_status>${statusNote}</preview_status>`);
    // What the user pointed at: selected areas (with the elements inside) and pasted screenshots.
    if (screenshots.length) parts.push(formatScreenshots(screenshots));
    parts.push(`<request>${request}</request>`);
    const text = parts.join('\n\n');

    let input: TurnInput = { kind: 'user', text, images: screenshots.map((s) => s.image) };
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      await beforeTurn?.();
      onEvent({ type: 'status', text: turn === 0 ? 'Thinking' : 'Working' });
      const result = await this.session.send(input, signal, {
        onProgress: (note) => onEvent({ type: 'progress', text: note }),
      });
      if (result.usage) onEvent({ type: 'usage', usage: result.usage });

      if (result.stopReason === 'refusal') {
        return { text: 'Claude declined this request.', proposal: this.changedSince(proposalBefore) };
      }
      if (result.stopReason === 'max_tokens') {
        throw new Error('The response was cut off before it finished. Try a smaller change.');
      }
      if (result.toolCalls.length === 0) {
        return { text: result.text || 'Done.', proposal: this.changedSince(proposalBefore) };
      }

      const results: ToolOutcome[] = [];
      for (const call of result.toolCalls) {
        onEvent({ type: 'status', text: STATUS[call.name as ToolName] ?? 'Working' });
        results.push(await this.execute(call));
      }
      input = { kind: 'tool_results', results };
    }
    throw new Error('Alter took too many steps without finishing. Try rephrasing the request.');
  }

  private latestStatusNote(): string | null {
    if (!this.latest || !this.latestId) return null;
    const status = this.page.proposalStatus(this.latestId);
    if (status === this.reportedStatus) return null;
    this.reportedStatus = status;
    const title = `"${this.latest.title}"`;
    switch (status) {
      case 'discarded':
        return `The user discarded your last proposal, ${title}. It is no longer on the page. Leave it out unless they ask for it again.`;
      case 'saved':
        return `The user saved your last proposal, ${title}. It is listed in <saved_changes>; to adjust it, set revises to its id.`;
      case 'previewing':
        return `Your last proposal, ${title}, is still previewed and not saved.`;
      case 'other':
        return `Your last proposal, ${title}, is no longer previewed.`;
    }
  }

  private async runAction(call: ToolCall, input: { title: string; summary: string; js: string }): Promise<ToolOutcome> {
    const fail = (content: string): ToolOutcome => ({ id: call.id, content, isError: true });
    const js = input.js.trim();
    if (!this.scriptsAllowed) return fail('Scripts are not allowed on this page (a sensitive site, or a password field is showing).');
    const jsCheck = checkJs(js);
    if (!jsCheck.ok) return fail(`Action rejected, nothing ran:\n- ${jsCheck.problems.join('\n- ')}`);

    const result = await this.page.runAction({ title: input.title.trim(), summary: input.summary.trim(), js });
    return ok(call, result.status === 'declined' ? DECLINED_ACTION : actionReport(result.report));
  }

  private changedSince(before: Proposal | null): Proposal | null {
    return this.latest !== before ? this.latest : null;
  }

  private async execute(call: ToolCall): Promise<ToolOutcome> {
    const fail = (content: string): ToolOutcome => ({ id: call.id, content, isError: true });
    if (!Object.hasOwn(TOOL_INPUTS, call.name)) return fail(`Unknown tool ${call.name}.`);
    const name = call.name as ToolName;
    const parsed = TOOL_INPUTS[name].safeParse(call.input);
    if (!parsed.success) return fail(`Invalid input: ${parsed.error.message}`);

    type Handlers = { [K in ToolName]: (input: z.infer<(typeof TOOL_INPUTS)[K]>) => Promise<ToolOutcome> };
    const handlers: Handlers = {
      get_snapshot: async (input) => {
        const snapshot = await this.page.snapshot(input.focus_terms, SNAPSHOT_CHARS);
        return ok(call, `<page_data>\n${snapshot.text}\n</page_data>\n(${snapshot.matchedFocus} focus matches)`);
      },
      query_selector: async (input) =>
        ok(call, `<page_data>\n${JSON.stringify(await this.page.query(input.selector))}\n</page_data>`),
      get_computed_styles: async (input) =>
        ok(call, `<page_data>\n${JSON.stringify(await this.page.styles(input.selector, input.properties))}\n</page_data>`),
      find_page_data: async (input) => {
        // Its data is only useful to scripts, and sensitive pages shouldn't have theirs sent anywhere.
        if (!this.scriptsAllowed) return fail('Scripts are not allowed on this page (a sensitive site, or a password field is showing), so its data is not available.');
        return ok(call, `<page_data>\n${pageDataReport(input.query, await this.page.pageData(input.query))}\n</page_data>`);
      },
      propose_patch: async (input) => {
        const check = checkCss(input.css);
        if (!check.ok) return fail(`Patch rejected, nothing was applied:\n- ${check.problems.join('\n- ')}`);
        if (input.revises !== null && !this.saved.some((p) => p.id === input.revises)) {
          return fail(`No saved change has id "${input.revises}". Use an id from <saved_changes>, or null for a new change.`);
        }
        const js = input.js.trim();
        if (js) {
          if (!this.scriptsAllowed) {
            return fail('Scripts are not allowed on this page (a sensitive site, or a password field is showing). Use CSS only.');
          }
          const jsCheck = checkJs(js);
          if (!jsCheck.ok) return fail(`Script rejected, nothing was applied:\n- ${jsCheck.problems.join('\n- ')}`);
        }
        const proposal: Proposal = {
          title: input.title.trim(),
          summary: input.summary.trim(),
          css: input.css,
          darkMode: input.dark_mode,
          focus: toFocusSettings(input.focus),
          js,
          revises: input.revises,
        };
        const result = await this.page.preview(proposal);
        if (result.status === 'declined') return ok(call, DECLINED_SCRIPT);
        this.latest = proposal;
        this.latestId = result.proposalId;
        this.reportedStatus = 'previewing';
        if (hasProblems(result.visual)) this.flaggedPreviews++;
        return ok(call, previewReport(proposal, result, { canFix: this.flaggedPreviews <= MAX_FIX_ROUNDS }));
      },
      run_action: (input) => this.runAction(call, input),
    };

    try {
      return await (handlers[name] as (input: unknown) => Promise<ToolOutcome>)(parsed.data);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  }
}

export function sessionOwner(provider: ModelProvider): string {
  return `${provider.kind}:${provider.model}`;
}

function ok(call: ToolCall, content: string): ToolOutcome {
  return { id: call.id, content, isError: false };
}
