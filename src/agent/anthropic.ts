import Anthropic from '@anthropic-ai/sdk';
import type { ModelSession, ModelProvider, StopReason, ToolSpec, TurnCallbacks, TurnInput, TurnResult } from './provider';
import { ProviderError } from './provider';

/** Models that accept server-side refusal fallbacks and progress-update thinking display. */
const SUPPORTS_FALLBACK_AND_UPDATES = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

export function createAnthropicClient(apiKey: string): Anthropic {
  // A user's own key in their own browser profile; it is never shipped to anyone else.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

/** Cheap call that verifies the key works and the model is available to it. */
export async function verifyApiKey(apiKey: string, model: string): Promise<void> {
  try {
    await createAnthropicClient(apiKey).models.retrieve(model);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new ProviderError('Anthropic rejected this key. Check that you copied all of it.', 'auth');
    }
    throw toProviderError(error);
  }
}

export function toProviderError(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError('Your Anthropic API key was rejected. Check it in Settings.', 'auth');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new ProviderError('Anthropic rate limit reached. Wait a moment and try again.', 'rate_limit');
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new ProviderError('That model is not available for your API key. Pick another in Settings.', 'bad_request');
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new ProviderError(`Anthropic rejected the request: ${error.message}`, 'bad_request');
  }
  if (error instanceof Anthropic.InternalServerError) {
    return new ProviderError('Anthropic is overloaded or having trouble right now. Try again shortly.', 'overloaded');
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderError('Could not reach Anthropic. Check your connection.', 'network');
  }
  if (isDroppedStream(error)) {
    return new ProviderError('The connection to Anthropic dropped in the middle of a reply. Try again.', 'network');
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** The browser lost the response while it was streaming in ("network error" in Chrome). */
function isDroppedStream(error: unknown): boolean {
  return error instanceof TypeError && /network|fetch/i.test(error.message);
}

/**
 * Worth sending again: the connection failed, or the API was briefly overloaded. The SDK retries
 * these itself only until a reply starts; a reply can still break off while it streams in.
 */
function isTransient(error: unknown): boolean {
  return (
    error instanceof Anthropic.APIConnectionError ||
    error instanceof Anthropic.InternalServerError ||
    (error instanceof Anthropic.APIError && /overloaded/i.test(error.message)) ||
    isDroppedStream(error)
  );
}

/** Waits before each new attempt after a transient failure. */
const RETRY_DELAYS_MS = [1000, 3000];

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case 'end_turn':
    case 'tool_use':
    case 'max_tokens':
    case 'refusal':
      return reason;
    default:
      return 'other';
  }
}

class AnthropicSession implements ModelSession {
  /** Append-only transcript: assistant turns are stored exactly as returned. */
  private readonly messages: Anthropic.Beta.BetaMessageParam[];
  private readonly tools: Anthropic.Beta.BetaTool[];

  constructor(
    private readonly client: Anthropic,
    private readonly model: string,
    private readonly system: string,
    tools: ToolSpec[],
    saved?: unknown,
  ) {
    this.messages = Array.isArray(saved) ? (saved as Anthropic.Beta.BetaMessageParam[]) : [];
    this.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
      strict: true,
    }));
  }

  export(): unknown {
    return this.messages;
  }

  /**
   * If the previous run was stopped (or the panel closed) after the model asked for tools,
   * those calls never got results. The API requires an answer to every tool call, so
   * report them as not run, in the same user turn as the new input.
   */
  private unansweredToolResults(): Anthropic.Beta.BetaToolResultBlockParam[] {
    const last = this.messages[this.messages.length - 1];
    if (!last || last.role !== 'assistant' || typeof last.content === 'string') return [];
    return last.content
      .filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use')
      .map((block) => ({ type: 'tool_result', tool_use_id: block.id, content: 'Not run: the request was stopped.', is_error: true }));
  }

  async send(input: TurnInput, signal: AbortSignal, callbacks: TurnCallbacks = {}): Promise<TurnResult> {
    const pending = this.unansweredToolResults();
    const images: Anthropic.Beta.BetaImageBlockParam[] =
      input.kind === 'user'
        ? (input.images ?? []).map((image) => ({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } }))
        : [];
    this.messages.push(
      input.kind === 'user'
        ? {
            role: 'user',
            content: pending.length || images.length ? [...pending, ...images, { type: 'text', text: input.text }] : input.text,
          }
        : {
            role: 'user',
            content: input.results.map((r) => ({
              type: 'tool_result' as const,
              tool_use_id: r.id,
              content: r.content,
              is_error: r.isError,
            })),
          },
    );

    const richModel = SUPPORTS_FALLBACK_AND_UPDATES.has(this.model);
    const request = () => {
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: 32000,
          system: this.system,
          tools: this.tools,
          messages: this.messages,
          cache_control: { type: 'ephemeral' },
          thinking: { type: 'adaptive', ...(richModel ? { display: 'updates' as const } : {}) },
          output_config: { effort: 'medium' },
          ...(richModel
            ? { betas: ['server-side-fallback-2026-07-01', 'thinking-display-updates-2026-08-18'], fallbacks: 'default' as const }
            : {}),
        },
        { signal },
      );
      stream.on('thinking', (delta) => {
        if (delta.trim()) callbacks.onProgress?.(delta);
      });
      return stream.finalMessage();
    };

    let message: Anthropic.Beta.BetaMessage | undefined;
    for (let attempt = 0; !message; attempt++) {
      try {
        message = await request();
      } catch (error) {
        if (!signal.aborted && isTransient(error) && attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]!, signal).catch(() => undefined);
          if (!signal.aborted) continue;
        }
        // Drop the unanswered input so the transcript stays valid for a retry.
        this.messages.pop();
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        throw toProviderError(error);
      }
    }

    this.messages.push({ role: 'assistant', content: message.content });

    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const toolCalls = message.content
      .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));
    const usage = {
      model: message.model,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    };
    return { text, toolCalls, stopReason: mapStopReason(message.stop_reason), usage };
  }
}

export class AnthropicProvider implements ModelProvider {
  readonly kind = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = createAnthropicClient(apiKey);
  }

  createSession(config: { system: string; tools: ToolSpec[] }, saved?: unknown): ModelSession {
    return new AnthropicSession(this.client, this.model, config.system, config.tools, saved);
  }
}
