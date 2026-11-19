import { z } from 'zod';
import type { DarkMode, FocusSettings } from '../lib/patches';
import type { ToolSpec } from './provider';

/**
 * Tool input schemas. Zod is the source of truth: it generates the JSON Schema
 * sent to the model and validates every input on the way back, including the
 * numeric bounds strict tool use can't express.
 */

const DarkModeSchema = z.strictObject({
  enabled: z.boolean(),
  brightness: z.number().min(50).max(150),
  contrast: z.number().min(50).max(150),
  sepia: z.number().min(0).max(100),
}) satisfies z.ZodType<DarkMode>;

const FocusSchema = z.strictObject({
  mode: z.enum(['off', 'reader', 'recipe']),
  theme: z.enum(['auto', 'light', 'sepia', 'dark']),
  text_size: z.enum(['normal', 'large']),
});

export function toFocusSettings(input: z.infer<typeof FocusSchema>): FocusSettings {
  return { mode: input.mode, theme: input.theme, textSize: input.text_size };
}

export const GetSnapshotInput = z.strictObject({
  focus_terms: z
    .array(z.string())
    .describe('Words to expand in the snapshot: visible text, attribute values, tag or class fragments (e.g. ["shorts", "reel"]).'),
});

export const QuerySelectorInput = z.strictObject({
  selector: z.string().describe('A CSS selector to test against the live page.'),
});

export const GetComputedStylesInput = z.strictObject({
  selector: z.string().describe('A CSS selector; the first few matches are reported.'),
  properties: z.array(z.string()).describe('CSS property names to read, e.g. ["background-color", "color", "font-size"].'),
});

export const FindPageDataInput = z.strictObject({
  query: z
    .string()
    .describe('A key name or text to look for, e.g. "followers_count", "followers", or a username. Matches keys containing it and text values containing it.'),
});

export const ProposePatchInput = z.strictObject({
  title: z.string().describe('2-5 word name for the change, e.g. "Dark mode" or "Hide Shorts".'),
  summary: z.string().describe('One or two plain sentences telling the user what changed.'),
  css: z
    .string()
    .describe('The complete CSS for this change (replaces any earlier proposal in this conversation). Empty string if dark_mode alone is enough.'),
  js: z
    .string()
    .describe(
      'Script body using the alter runtime, for behavior CSS cannot express. Empty string when CSS is enough. The user must approve every script before it runs.',
    ),
  revises: z
    .string()
    .nullable()
    .describe('The id of the saved change this updates (from <saved_changes>), or null for a new, separate change.'),
  focus: FocusSchema.describe(
    "Built-in focus view that covers the page with a clean reading view: 'reader' shows the main article as plain text (Firefox Reader View's engine); 'recipe' shows just the recipe from the page's structured data (falls back to the reader view if the page has none). 'off' for everything else. theme 'auto' follows the user's system.",
  ),
  dark_mode: DarkModeSchema.describe(
    'Built-in dark theme engine. enabled=true runs it before your CSS. brightness/contrast 50-150 (100 = neutral), sepia 0-100.',
  ),
});
export type ProposePatchInput = z.infer<typeof ProposePatchInput>;

export const RunActionInput = z.strictObject({
  title: z.string().describe('2-5 word name for the action, e.g. "Download post as text".'),
  summary: z.string().describe('One or two plain sentences telling the user what the action produces.'),
  js: z
    .string()
    .describe('Script body using the alter runtime. Deliver results with alter.download(filename, text, mimeType) or alter.copy(text).'),
});

/** Constraint keywords strict tool use rejects; Zod still enforces them client-side. */
const UNSUPPORTED_KEYWORDS = new Set([
  '$schema',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'pattern',
]);

function stripUnsupported(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUnsupported);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !UNSUPPORTED_KEYWORDS.has(key))
        .map(([key, v]) => [key, stripUnsupported(v)]),
    );
  }
  return value;
}

export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return stripUnsupported(z.toJSONSchema(schema)) as Record<string, unknown>;
}

export const TOOL_INPUTS = {
  get_snapshot: GetSnapshotInput,
  query_selector: QuerySelectorInput,
  get_computed_styles: GetComputedStylesInput,
  find_page_data: FindPageDataInput,
  propose_patch: ProposePatchInput,
  run_action: RunActionInput,
} as const;

export type ToolName = keyof typeof TOOL_INPUTS;

const DESCRIPTIONS: Record<ToolName, string> = {
  get_snapshot:
    'Re-read the page outline with different focus terms. Use when the initial snapshot did not show the elements you need.',
  query_selector:
    'Test a CSS selector on the live page. Returns the match count and samples (attributes, text, size, visibility, trimmed HTML). Use it to confirm selectors before proposing CSS, and after a preview to confirm targets are hidden or restyled.',
  get_computed_styles:
    'Read computed CSS properties for elements matching a selector. Use it to learn real colors, fonts, and sizes before overriding them.',
  find_page_data:
    "Search the data the site has loaded (the JSON its own code received, which often holds more than the page shows, like a post author's follower count or exact timestamps). Returns where matches are, grouped by path, with an example value and the record around it, so a script can read them through alter.data.",
  propose_patch:
    'Apply a change to the page as a live preview the user can see right away. Each call replaces your previous proposal. The result reports the page colors after the change so you can check your work.',
  run_action:
    'Run a script once on the current page, after the user approves it, to produce something from it: a file to download or text to copy. Nothing is saved for the site and the page is left as it was.',
};

export const TOOL_SPECS: ToolSpec[] = (Object.keys(TOOL_INPUTS) as ToolName[]).map((name) => ({
  name,
  description: DESCRIPTIONS[name],
  inputSchema: toJsonSchema(TOOL_INPUTS[name]),
}));
