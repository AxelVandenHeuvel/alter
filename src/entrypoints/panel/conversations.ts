import { useSyncExternalStore } from 'react';
import {
  AlterAgent,
  type Action,
  type ActionResult,
  type AgentState,
  type PageTools,
  type PreviewResult,
  type Proposal,
  type ProposalStatus,
} from '../../agent/agent';
import { costOf } from '../../agent/pricing';
import type { ModelProvider } from '../../agent/provider';
import { checkJs, type JsCheck } from '../../lib/js-safety';
import { askPageIfPresent, sendToPage } from '../../lib/page-client';
import { addPatch, DARK_MODE_OFF, FOCUS_OFF, getPatches, updatePatch } from '../../lib/patches';
import { registrationsSettled } from '../../lib/registration';
import { getSettings } from '../../lib/settings';
import { getSpend, limitProblem, recordSpend } from '../../lib/spend';
import { loadConversation, removeConversation, storeConversation } from '../../lib/tab-session';
import { runAction, type ScriptReport } from '../../lib/userscripts';
import { base64Of, type Attachment } from './attachments';
import { deliverOutputs } from './outputs';
import { applyPreview, clearPreview } from './preview';

export type ProposalState = 'review' | 'applying' | 'preview' | 'declined' | 'saved' | 'discarded' | 'replaced' | 'ran';

export interface ProposalRecord {
  id: string;
  /** A change is previewed and can be saved for the site; an action runs once and is done. */
  kind: 'change' | 'action';
  proposal: Proposal;
  state: ProposalState;
  /** The user message that produced it, kept as the saved change's intent. */
  request: string;
  /** What the script does, for the approval card. Null for CSS-only proposals. */
  scriptCheck: JsCheck | null;
  /** For actions that ran: what the script reported and produced. */
  report: ScriptReport | null;
}

/** Which model answered a request, and what it cost (null when nothing was billed or the price is unknown). */
export interface RunUsage {
  model: string;
  cost: number | null;
}

export type ChatItem =
  | { id: string; kind: 'user'; text: string; attachments?: Attachment[] }
  | { id: string; kind: 'assistant'; text: string; proposalId: string | null; usage?: RunUsage }
  | { id: string; kind: 'error'; text: string; usage?: RunUsage };

export interface Conversation {
  key: string;
  tabId: number;
  hostname: string;
  /** The page load this conversation belongs to; a reload or navigation starts a new one. */
  pageKey: string | null;
  items: ChatItem[];
  proposals: Record<string, ProposalRecord>;
  /** The proposal currently previewed in the page, if any. */
  previewId: string | null;
  /** The newest proposal of the run in progress, shown live (it may be waiting for approval). */
  runProposalId: string | null;
  running: boolean;
  status: string;
  progress: string;
}

export function conversationKey(tabId: number, hostname: string): string {
  return `${tabId}:${hostname}`;
}

const newId = () => crypto.randomUUID();

interface Run {
  abort: AbortController;
  request: string;
}

/** What survives closing the panel: the chat, its proposals, and the model's side of the conversation. */
interface StoredConversation {
  conversation: Conversation;
  agent: AgentState | null;
}

/**
 * One conversation per tab, tied to the page load it started on. It survives
 * closing and reopening the panel (kept in session storage, as is its preview on
 * the page) and ends when the page reloads, navigates to a new document, or closes.
 */
class ConversationStore {
  private conversations = new Map<string, Conversation>();
  private agents = new Map<string, AlterAgent>();
  /** Model state restored from storage, used when the conversation's agent is next needed. */
  private agentStates = new Map<string, AgentState>();
  private persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private runs = new Map<string, Run>();
  /** Resolvers for proposals waiting on the user's approval to run a script. */
  private approvals = new Map<string, (approved: boolean) => void>();
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  get(key: string): Conversation | undefined {
    return this.conversations.get(key);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * Apply a change and save it. The panel can close at any moment, so changes are saved
   * right away; only the frequent progress text ('Thinking', model notes) is batched.
   */
  private update(key: string, change: (c: Conversation) => Partial<Conversation>, progressOnly = false): void {
    const current = this.conversations.get(key);
    if (!current) return;
    this.conversations.set(key, { ...current, ...change(current) });
    this.notify();
    this.persist(key, progressOnly ? 500 : 0);
  }

  /** Save to session storage, so the conversation outlives the panel. */
  private persist(key: string, delayMs = 0): void {
    clearTimeout(this.persistTimers.get(key));
    const write = () => {
      this.persistTimers.delete(key);
      const conversation = this.conversations.get(key);
      if (!conversation?.pageKey) return;
      const agent = this.agents.get(key)?.export() ?? this.agentStates.get(key) ?? null;
      const stored: StoredConversation = { conversation, agent };
      void storeConversation(conversation.tabId, stored);
    };
    if (delayMs === 0) write();
    else this.persistTimers.set(key, setTimeout(write, delayMs));
  }

  /**
   * Bring back the tab's conversation after the panel reopens, if it belongs to the
   * page that's open now. A run that was in progress when the panel closed has stopped.
   */
  async restore(tabId: number, hostname: string): Promise<void> {
    const key = conversationKey(tabId, hostname);
    if (this.conversations.has(key)) return;
    const stored = await loadConversation<StoredConversation>(tabId);
    if (!stored || stored.conversation.hostname !== hostname || this.conversations.has(key)) return;
    const page = await askPageIfPresent(tabId, { type: 'alter:ping' });
    if (!page || page.pageKey !== stored.conversation.pageKey) {
      await removeConversation(tabId);
      return;
    }

    const conversation = stored.conversation;
    const proposals = { ...conversation.proposals };
    let items = conversation.items;
    if (conversation.running) {
      for (const record of Object.values(proposals)) {
        if (record.state === 'review' || (record.state === 'applying' && record.id !== conversation.previewId)) {
          proposals[record.id] = { ...record, state: 'declined' };
        }
      }
      // Like a stopped run: the stop notice carries the run's card, so it stays visible (and savable if previewed).
      const text = 'Stopped because Alter was closed.';
      items = [
        ...items,
        conversation.runProposalId
          ? { id: newId(), kind: 'assistant', text, proposalId: conversation.runProposalId }
          : { id: newId(), kind: 'error', text },
      ];
    }
    this.conversations.set(key, { ...conversation, proposals, items, running: false, runProposalId: null, status: '', progress: '' });
    if (stored.agent) this.agentStates.set(key, stored.agent);
    this.notify();
    this.persist(key);
  }

  private setState(key: string, proposalId: string, state: ProposalState): void {
    this.update(key, (c) => {
      const record = c.proposals[proposalId];
      return record ? { proposals: { ...c.proposals, [proposalId]: { ...record, state } } } : {};
    });
  }

  private ensure(tabId: number, hostname: string): Conversation {
    const key = conversationKey(tabId, hostname);
    let conversation = this.conversations.get(key);
    if (!conversation) {
      conversation = {
        key,
        tabId,
        hostname,
        pageKey: null,
        items: [],
        proposals: {},
        previewId: null,
        runProposalId: null,
        running: false,
        status: '',
        progress: '',
      };
      this.conversations.set(key, conversation);
    }
    return conversation;
  }

  private pageTools(key: string, tabId: number, hostname: string): PageTools {
    return {
      summary: () => sendToPage(tabId, { type: 'alter:summary' }),
      snapshot: (focusTerms, maxChars) => sendToPage(tabId, { type: 'alter:snapshot', focusTerms, maxChars }),
      query: (selector) => sendToPage(tabId, { type: 'alter:query', selector }),
      pageData: (query) => sendToPage(tabId, { type: 'alter:pageData', query }),
      styles: (selector, properties) => sendToPage(tabId, { type: 'alter:styles', selector, properties }),
      preview: (proposal) => this.preview(key, tabId, hostname, proposal),
      savedPatches: () => getPatches(hostname),
      proposalStatus: (proposalId) => this.proposalStatus(key, proposalId),
      runAction: (action) => this.runAction(key, tabId, action),
    };
  }

  /** Add a record for the run in progress and show it as the live card. */
  private addRecord(key: string, record: Omit<ProposalRecord, 'id' | 'request'>): string {
    const run = this.runs.get(key);
    if (!run) throw new Error('No run in progress.');
    const id = newId();
    this.update(key, (c) => ({
      runProposalId: id,
      proposals: { ...c.proposals, [id]: { ...record, id, request: run.request } },
    }));
    return id;
  }

  /** Wait for the user to answer an approval card; stopping the run counts as no. */
  private async approval(key: string, id: string): Promise<boolean> {
    const run = this.runs.get(key);
    if (!run) return false;
    this.update(key, () => ({ status: 'Waiting for your OK', progress: '' }));
    const approved = await new Promise<boolean>((resolve) => {
      this.approvals.set(id, resolve);
      run.abort.signal.addEventListener('abort', () => resolve(false), { once: true });
    });
    this.approvals.delete(id);
    if (!approved) this.setState(key, id, 'declined');
    return approved;
  }

  private async runAction(key: string, tabId: number, action: Action): Promise<ActionResult> {
    const proposal: Proposal = { ...action, css: '', darkMode: DARK_MODE_OFF, focus: FOCUS_OFF, revises: null };
    const id = this.addRecord(key, { kind: 'action', proposal, state: 'review', scriptCheck: checkJs(action.js), report: null });
    if (!(await this.approval(key, id))) return { status: 'declined' };

    this.setState(key, id, 'applying');
    this.update(key, () => ({ status: 'Running the action' }));
    const report = await runAction(tabId, action.js);
    // Delivered from the panel, which has focus right after the user's click.
    const problems = await deliverOutputs(report.outputs);
    const final = { ...report, errors: [...report.errors, ...problems] };
    this.update(key, (c) => ({
      proposals: { ...c.proposals, [id]: { ...c.proposals[id]!, state: 'ran', report: final } },
    }));
    return { status: 'ran', report: final };
  }

  private proposalStatus(key: string, proposalId: string): ProposalStatus {
    switch (this.get(key)?.proposals[proposalId]?.state) {
      case 'preview':
        return 'previewing';
      case 'saved':
        return 'saved';
      case 'discarded':
        return 'discarded';
      default:
        return 'other';
    }
  }

  /** Called by the agent for every proposal. Scripts wait here for the user's approval. */
  private async preview(key: string, tabId: number, hostname: string, proposal: Proposal): Promise<PreviewResult> {
    const needsApproval = proposal.js !== '';
    const id = this.addRecord(key, {
      kind: 'change',
      proposal,
      state: needsApproval ? 'review' : 'applying',
      scriptCheck: needsApproval ? checkJs(proposal.js) : null,
      report: null,
    });

    if (needsApproval) {
      if (!(await this.approval(key, id))) return { status: 'declined' };
      this.update(key, () => ({ status: 'Running the script' }));
    }

    const result = await applyPreview(tabId, hostname, proposal);
    this.update(key, (c) => {
      const proposals = { ...c.proposals };
      // The earlier preview (from this run or a previous one) is now replaced on the page.
      if (c.previewId && proposals[c.previewId]?.state === 'preview') {
        proposals[c.previewId] = { ...proposals[c.previewId]!, state: 'replaced' };
      }
      proposals[id] = { ...proposals[id]!, state: 'preview' };
      return { proposals, previewId: id };
    });
    return { ...result, proposalId: id };
  }

  /** The user's answer to a script approval card. */
  answer(proposalId: string, approved: boolean): void {
    this.approvals.get(proposalId)?.(approved);
  }

  async send(
    tabId: number,
    hostname: string,
    text: string,
    createProvider: () => Promise<ModelProvider>,
    attachments: Attachment[] = [],
  ): Promise<void> {
    const conversation = this.ensure(tabId, hostname);
    const key = conversation.key;
    if (conversation.running) return;

    const run: Run = { abort: new AbortController(), request: text };
    this.runs.set(key, run);
    this.update(key, (c) => ({
      items: [...c.items, { id: newId(), kind: 'user', text, ...(attachments.length ? { attachments } : {}) }],
      running: true,
      runProposalId: null,
      status: 'Starting',
      progress: '',
    }));

    let reply: ChatItem;
    let usage: RunUsage | undefined;
    try {
      // Tie the conversation to this page load, so it ends when the page reloads.
      const { pageKey } = await sendToPage(tabId, { type: 'alter:ping' });
      if (!this.get(key)?.pageKey) this.update(key, () => ({ pageKey }));
      // A fresh provider every time, so a new key or model in Settings applies right away.
      // The conversation carries over (the agent decides whether its transcript can continue).
      const provider = await createProvider();
      const agent = new AlterAgent(provider, this.pageTools(key, tabId, hostname), this.agents.get(key)?.export() ?? this.agentStates.get(key));
      this.agentStates.delete(key);
      this.agents.set(key, agent);
      usage = { model: provider.model, cost: null };
      const runUsage = usage;

      const screenshots = attachments.map((a) => ({ image: { mediaType: a.mediaType, data: base64Of(a.dataUrl) }, selection: a.selection }));
      const result = await agent.run(text, {
        signal: run.abort.signal,
        screenshots,
        // Requests to Anthropic stop once this month's spending reaches the user's limit.
        beforeTurn: async () => {
          const [spend, settings] = await Promise.all([getSpend(), getSettings()]);
          const problem = limitProblem(spend, settings.monthlyLimit);
          if (problem) throw new Error(problem);
        },
        onEvent: (event) => {
          if (event.type === 'status') this.update(key, () => ({ status: event.text }), true);
          else if (event.type === 'progress') this.update(key, () => ({ progress: event.text }), true);
          else {
            const cost = costOf(event.usage);
            const firstCall = runUsage.cost === null;
            runUsage.model = event.usage.model;
            if (cost !== null) runUsage.cost = (runUsage.cost ?? 0) + cost;
            void recordSpend({ cost: cost ?? 0, requests: firstCall ? 1 : 0 });
          }
        },
      });
      reply = { id: newId(), kind: 'assistant', text: result.text, proposalId: this.get(key)?.runProposalId ?? null, usage };
    } catch (error) {
      const message = run.abort.signal.aborted ? 'Stopped.' : error instanceof Error ? error.message : String(error);
      // A preview may already be on the page; keep its card so it can still be saved or discarded.
      const proposalId = this.get(key)?.runProposalId ?? null;
      reply = proposalId
        ? { id: newId(), kind: 'assistant', text: message, proposalId, usage }
        : { id: newId(), kind: 'error', text: message, usage };
    } finally {
      this.runs.delete(key);
    }
    this.update(key, (c) => ({ items: [...c.items, reply], running: false, runProposalId: null, status: '', progress: '' }));
    this.persist(key);
  }

  stop(key: string): void {
    this.runs.get(key)?.abort.abort();
  }

  async save(key: string, proposalId: string): Promise<void> {
    const conversation = this.get(key);
    const record = conversation?.proposals[proposalId];
    if (!conversation || !record) return;
    const { proposal } = record;
    const model = this.agents.get(key)?.model ?? 'unknown';
    const content = {
      title: proposal.title,
      summary: proposal.summary,
      css: proposal.css,
      darkMode: proposal.darkMode,
      focus: proposal.focus,
      js: proposal.js,
    };

    // The revised change may have been deleted from the list since; then save as new.
    const existing = await getPatches(conversation.hostname);
    if (proposal.revises && existing.some((p) => p.id === proposal.revises)) {
      await updatePatch(conversation.hostname, proposal.revises, { ...content, enabled: true, model });
    } else {
      await addPatch({
        ...content,
        id: newId(),
        hostname: conversation.hostname,
        intent: record.request,
        enabled: true,
        model,
        createdAt: Date.now(),
      });
    }
    await registrationsSettled();
    // The saved copy now runs from storage; drop the preview layer.
    if (conversation.previewId === proposalId) await clearPreview(conversation.tabId, conversation.hostname);
    this.update(key, (c) => ({
      previewId: c.previewId === proposalId ? null : c.previewId,
      proposals: { ...c.proposals, [proposalId]: { ...c.proposals[proposalId]!, state: 'saved' } },
    }));
  }

  async discard(key: string, proposalId: string): Promise<void> {
    const conversation = this.get(key);
    if (!conversation) return;
    if (conversation.previewId === proposalId) await clearPreview(conversation.tabId, conversation.hostname);
    this.update(key, (c) => ({ previewId: c.previewId === proposalId ? null : c.previewId }));
    this.setState(key, proposalId, 'discarded');
  }

  /**
   * The tab loaded a new page (reload or navigation) or closed: the conversation and its
   * preview belonged to the old page and are gone with it.
   */
  pageChanged(tabId: number): void {
    for (const [key, conversation] of this.conversations) {
      if (conversation.tabId !== tabId) continue;
      this.stop(key);
      this.drop(key);
    }
    void removeConversation(tabId);
  }

  private drop(key: string): void {
    clearTimeout(this.persistTimers.get(key));
    this.persistTimers.delete(key);
    this.conversations.delete(key);
    this.agents.delete(key);
    this.agentStates.delete(key);
    this.notify();
  }
}

export const conversations = new ConversationStore();

export function useConversation(key: string | null): Conversation | undefined {
  return useSyncExternalStore(conversations.subscribe, () => (key ? conversations.get(key) : undefined));
}
