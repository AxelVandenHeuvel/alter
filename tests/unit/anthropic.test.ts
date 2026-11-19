import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { AnthropicProvider } from '../../src/agent/anthropic';

/** Replaces the SDK client with one that records requests and returns scripted messages. */
function providerWith(responses: (Partial<Anthropic.Beta.BetaMessage> | Error)[]) {
  const requests: Anthropic.Beta.MessageCreateParams[] = [];
  const provider = new AnthropicProvider('sk-test', 'claude-sonnet-5-5');
  (provider as unknown as { client: unknown }).client = {
    beta: {
      messages: {
        stream: (params: Anthropic.Beta.MessageCreateParams) => {
          requests.push(structuredClone(params));
          const next = responses.shift();
          if (next instanceof Error) return { on: () => undefined, finalMessage: () => Promise.reject(next) };
          const message = {
            model: 'claude-sonnet-5-5',
            stop_reason: 'end_turn',
            content: [],
            usage: { input_tokens: 12, output_tokens: 34, cache_creation_input_tokens: 56, cache_read_input_tokens: 78 },
            ...next,
          };
          return { on: () => undefined, finalMessage: async () => message };
        },
      },
    },
  };
  return { provider, requests };
}

describe('AnthropicSession', () => {
  it('answers tool calls left unanswered by a stopped run before sending the next message', async () => {
    const { provider, requests } = providerWith([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_1', name: 'query_selector', input: { selector: 'a' } }] as never },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi', citations: null }] as never },
    ]);
    const session = provider.createSession({ system: 'sys', tools: [] });
    await session.send({ kind: 'user', text: 'first' }, new AbortController().signal);
    // The user stopped the run here: the tool call never got a result. Then they send something new.
    await session.send({ kind: 'user', text: 'second' }, new AbortController().signal);

    const last = requests[1]!.messages.at(-1)!;
    expect(last).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: 'Not run: the request was stopped.', is_error: true },
        { type: 'text', text: 'second' },
      ],
    });
  });

  it('continues from an exported transcript', async () => {
    const { provider, requests } = providerWith([
      { content: [{ type: 'text', text: 'One', citations: null }] as never },
      { content: [{ type: 'text', text: 'Two', citations: null }] as never },
    ]);
    const first = provider.createSession({ system: 'sys', tools: [] });
    await first.send({ kind: 'user', text: 'hello' }, new AbortController().signal);
    const second = provider.createSession({ system: 'sys', tools: [] }, JSON.parse(JSON.stringify(first.export())));
    await second.send({ kind: 'user', text: 'again' }, new AbortController().signal);
    expect(requests[1]!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('sends attached screenshots as image blocks before the text', async () => {
    const { provider, requests } = providerWith([{ content: [{ type: 'text', text: 'Ok', citations: null }] as never }]);
    const session = provider.createSession({ system: 'sys', tools: [] });
    await session.send({ kind: 'user', text: 'fix this', images: [{ mediaType: 'image/png', data: 'AAAA' }] }, new AbortController().signal);
    expect(requests[0]!.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
        { type: 'text', text: 'fix this' },
      ],
    });
  });

  it('reports the tokens each call used, including the prompt cache', async () => {
    const { provider } = providerWith([{ stop_reason: 'end_turn', content: [] }]);
    const result = await provider.createSession({ system: 'sys', tools: [] }).send({ kind: 'user', text: 'x' }, new AbortController().signal);
    expect(result.usage).toEqual({ model: 'claude-sonnet-5-5', inputTokens: 12, outputTokens: 34, cacheWriteTokens: 56, cacheReadTokens: 78 });
  });

  it('sends again when the reply breaks off while streaming in, and says so plainly when it keeps failing', async () => {
    vi.useFakeTimers();
    try {
      const dropped = () => new TypeError('network error');
      const { provider, requests } = providerWith([dropped(), { content: [{ type: 'text', text: 'Done', citations: null }] as never }]);
      const session = provider.createSession({ system: 'sys', tools: [] });
      const reply = session.send({ kind: 'user', text: 'hi' }, new AbortController().signal);
      await vi.runAllTimersAsync();
      expect((await reply).text).toBe('Done');
      expect(requests).toHaveLength(2);
      // The retry sends the same transcript, not the message twice.
      expect(requests[1]!.messages).toEqual(requests[0]!.messages);

      const failing = providerWith([dropped(), dropped(), dropped()]);
      const again = failing.provider.createSession({ system: 'sys', tools: [] });
      const failed = again.send({ kind: 'user', text: 'hi' }, new AbortController().signal).catch((error: Error) => error.message);
      await vi.runAllTimersAsync();
      expect(await failed).toBe('The connection to Anthropic dropped in the middle of a reply. Try again.');
      expect(failing.requests).toHaveLength(3);
      expect(again.export()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
