import type { TokenUsage } from './provider';

/** US dollars per million tokens. */
interface Rates {
  input: number;
  output: number;
  cacheRead: number;
}

/** Writing to the prompt cache (5-minute entries, which Alter uses) costs 1.25x the input rate. */
const CACHE_WRITE_MULTIPLIER = 1.25;

/** Anthropic's published prices for the models Alter offers. */
const PRICES: Record<string, Rates | ((promptTokens: number) => Rates)> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  // Haiku 5.5 costs more per token once a prompt is over 100K tokens.
  'claude-haiku-5-5': (promptTokens) =>
    promptTokens <= 100_000 ? { input: 0.1, output: 0.5, cacheRead: 0.01 } : { input: 0.5, output: 2.5, cacheRead: 0.05 },
};

/** Responses name the model with or without a date suffix ("claude-sonnet-5-5-20260815"). */
function ratesFor(model: string, promptTokens: number): Rates | null {
  const id = Object.keys(PRICES).find((known) => model === known || model.startsWith(`${known}-`));
  if (!id) return null;
  const price = PRICES[id]!;
  return typeof price === 'function' ? price(promptTokens) : price;
}

/** What one model call cost in US dollars, or null for a model Alter has no prices for. */
export function costOf(usage: TokenUsage): number | null {
  const promptTokens = usage.inputTokens + usage.cacheWriteTokens + usage.cacheReadTokens;
  const rates = ratesFor(usage.model, promptTokens);
  if (!rates) return null;
  const dollars =
    usage.inputTokens * rates.input +
    usage.cacheWriteTokens * rates.input * CACHE_WRITE_MULTIPLIER +
    usage.cacheReadTokens * rates.cacheRead +
    usage.outputTokens * rates.output;
  return dollars / 1_000_000;
}

/** "$0.004", "$0.12", "$3.40": enough precision to be useful at every size. */
export function formatCost(dollars: number): string {
  if (dollars === 0) return '$0.00';
  if (dollars < 0.001) return '<$0.001';
  if (dollars < 0.1) return `$${dollars.toFixed(3)}`;
  return `$${dollars.toFixed(2)}`;
}
