import { describe, expect, it } from 'vitest';
import { costOf, formatCost } from '../../src/agent/pricing';

const usage = (model: string, tokens: Partial<{ input: number; output: number; write: number; read: number }>) => ({
  model,
  inputTokens: tokens.input ?? 0,
  outputTokens: tokens.output ?? 0,
  cacheWriteTokens: tokens.write ?? 0,
  cacheReadTokens: tokens.read ?? 0,
});

describe('costOf', () => {
  it('prices input, output, and cache reads and writes', () => {
    // Sonnet 5.5: $2 in, $10 out, $0.20 cache reads, cache writes at 1.25x input.
    expect(costOf(usage('claude-sonnet-5-5', { input: 1_000_000 }))).toBeCloseTo(2);
    expect(costOf(usage('claude-sonnet-5-5', { output: 1_000_000 }))).toBeCloseTo(10);
    expect(costOf(usage('claude-sonnet-5-5', { read: 1_000_000 }))).toBeCloseTo(0.2);
    expect(costOf(usage('claude-sonnet-5-5', { write: 1_000_000 }))).toBeCloseTo(2.5);
    expect(costOf(usage('claude-opus-5-5', { input: 1000, output: 1000 }))).toBeCloseTo(0.024);
  });

  it('uses Haiku 5.5\'s higher rates only for prompts over 100K tokens', () => {
    expect(costOf(usage('claude-haiku-5-5', { input: 100_000 }))).toBeCloseTo(0.01);
    expect(costOf(usage('claude-haiku-5-5', { input: 60_000, read: 60_000 }))).toBeCloseTo(60_000 * 0.5e-6 + 60_000 * 0.05e-6);
  });

  it('recognizes dated model names, and knows nothing about others', () => {
    expect(costOf(usage('claude-sonnet-5-5-20260815', { input: 1_000_000 }))).toBeCloseTo(2);
    expect(costOf(usage('qwen3:14b', { input: 1000 }))).toBeNull();
  });
});

describe('formatCost', () => {
  it('shows enough precision at every size', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.0004)).toBe('<$0.001');
    expect(formatCost(0.0123)).toBe('$0.012');
    expect(formatCost(3.4)).toBe('$3.40');
  });
});
