/**
 * Provider-neutral model interface. Each session owns its own transcript in the
 * vendor's native format, so vendor-specific blocks (thinking, fallbacks) are
 * replayed untouched and the agent loop never needs to know about them.
 */

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool input (strict-compatible: no numeric/string constraints). */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolOutcome {
  id: string;
  content: string;
  isError: boolean;
}

export interface ImageInput {
  mediaType: 'image/png' | 'image/jpeg';
  /** Base64 image data, without the data: URL prefix. */
  data: string;
}

export type TurnInput = { kind: 'user'; text: string; images?: ImageInput[] } | { kind: 'tool_results'; results: ToolOutcome[] };

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';

/** Tokens one model call used, for showing what it cost. */
export interface TokenUsage {
  /** The model that actually answered (a server-side fallback can differ from the one asked for). */
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Prompt tokens written to and read from the prompt cache, billed at their own rates. */
  cacheWriteTokens: number;
  cacheReadTokens: number;
}

export interface TurnResult {
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  /** Null when the provider doesn't report usage. */
  usage: TokenUsage | null;
}

export interface TurnCallbacks {
  /** Short progress notes the model writes while it works. */
  onProgress?: (text: string) => void;
}

export interface ModelSession {
  send(input: TurnInput, signal: AbortSignal, callbacks?: TurnCallbacks): Promise<TurnResult>;
  /** The transcript as plain JSON, so the conversation can continue after the panel reopens. */
  export(): unknown;
}

export interface ModelProvider {
  /** Which API the provider speaks; transcripts only continue with the same kind and model. */
  readonly kind: string;
  readonly model: string;
  /** `saved` is a previous session's export(), to continue that conversation. */
  createSession(config: { system: string; tools: ToolSpec[] }, saved?: unknown): ModelSession;
}

/** Errors the UI should show as-is (bad key, rate limit) rather than as a crash. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate_limit' | 'overloaded' | 'bad_request' | 'network' | 'unknown',
  ) {
    super(message);
  }
}
