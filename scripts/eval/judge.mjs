// Grades one eval case by looking at it, the way the user would: the page before,
// the page after, what Alter said, and what the measurements found.
import Anthropic from '@anthropic-ai/sdk';
import { costOf } from '../../src/agent/pricing.ts';

export const JUDGE_MODEL = 'claude-opus-5-5';

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    did_what_was_asked: { type: 'integer', description: '1-5: how fully the result does what the user asked.' },
    looks_good: { type: 'integer', description: '1-5: how polished and well designed the result looks, as a picky designer would judge it.' },
    nothing_broken: { type: 'integer', description: '1-5: 5 when nothing that worked before is broken, hidden, unreadable, overlapping, or cut off.' },
    reply_honest: { type: 'integer', description: "1-5: whether Alter's reply matches what actually happened, without overclaiming." },
    pass: { type: 'boolean', description: 'Whether a user who asked for this would be happy with the result as it is.' },
    issues: { type: 'array', items: { type: 'string' }, description: 'Concrete problems, each one short and specific (where on the page, what is wrong). Empty when there are none.' },
    summary: { type: 'string', description: 'One or two sentences on the result.' },
  },
  required: ['did_what_was_asked', 'looks_good', 'nothing_broken', 'reply_honest', 'pass', 'issues', 'summary'],
  additionalProperties: false,
};

const SYSTEM = `You grade Alter, a browser extension that changes how websites look when a user describes the change.
You get one request a user typed on a real site, screenshots of the page before and after, Alter's reply, and automatic measurements.
Judge the result as the user would see it, and be demanding: a result passes only when the user would keep it as it is.
Dark or light themes with leftover panels in the old color, unreadable text, hidden content, broken layout, or a reply that claims more than what happened are failures.
Base the grade on what the screenshots show; the measurements help you notice problems but can be incomplete.
Each moment has two screenshots: the top of the page, and the view after scrolling down most of a screen with the mouse wheel.
A saved change that no longer shows after the reload is a failure, but sites show slightly different content on each load.`;

const image = (png) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } });

const moment = (label, shots) => shots.flatMap((png, i) => [{ type: 'text', text: `${label}${i ? ', scrolled down' : ', top'}:` }, image(png)]);

const EXPECTATION = {
  change: 'Alter should make and save a change to the site.',
  action: 'Alter should run a one-time action on the page (like producing a file) and leave the page as it was.',
  decline: 'Alter should decline this request and leave the page as it was.',
};

/**
 * @param {object} input
 * @param {object} input.testCase the case from cases.mjs
 * @param {Buffer[]} input.before screenshots before the request (top, then scrolled)
 * @param {Buffer[] | null} input.preview screenshots of the live preview, when Alter made a change
 * @param {Buffer[] | null} input.after screenshots after saving and reloading, or at the end when nothing was saved
 * @param {object} input.result what the runner recorded (outcome, reply, measurements)
 */
export async function judge({ testCase, before, preview, after, result }) {
  const client = new Anthropic();
  const facts = [
    `Request: "${testCase.request}"`,
    `Page: ${testCase.url}`,
    `What should happen: ${EXPECTATION[testCase.expect]}`,
    `What a good result looks like:\n${testCase.criteria.map((c) => `- ${c}`).join('\n')}`,
    `What happened: ${result.outcome}${result.error ? ` (${result.error})` : ''}`,
    `Alter's reply: ${result.reply ? `"${result.reply}"` : '(none)'}`,
    `Visual check of the final preview (problems the change caused, measured on screen): ${result.visualSummary}`,
    result.scriptErrors.length ? `Script errors: ${result.scriptErrors.join('; ')}` : 'Script errors: none',
    result.downloads.length
      ? `Files it produced:\n${result.downloads.map((d) => `${d.name}:\n${d.preview}`).join('\n\n')}`
      : '',
  ].filter(Boolean);

  const content = [
    { type: 'text', text: facts.join('\n\n') },
    ...moment('Before', before),
    ...(preview ? moment('The change as previewed, before saving', preview) : []),
    ...(after
      ? moment(preview ? 'After saving and reloading the page (the change should apply again by itself)' : 'The page at the end', after)
      : [{ type: 'text', text: 'There is no after screenshot.' }]),
  ];

  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema: VERDICT_SCHEMA } },
  });
  const text = response.content.find((block) => block.type === 'text')?.text;
  if (!text) throw new Error(`The judge gave no verdict (stop reason: ${response.stop_reason})`);
  const usage = response.usage;
  const cost = costOf({
    model: response.model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  });
  return { ...JSON.parse(text), cost };
}
