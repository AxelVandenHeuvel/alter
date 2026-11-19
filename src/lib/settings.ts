/** Non-secret preferences. Readable by content scripts, so never store the API key here. */

export const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'Recommended' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', hint: 'Fastest, cheapest' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'Most capable' },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];

/** A short name for a model that answered: "Sonnet 5.5" for Claude (with or without a date suffix), else as given. */
export function modelName(model: string): string {
  const known = MODELS.find((m) => model === m.id || model.startsWith(`${m.id}-`));
  return known ? known.label.replace(/^Claude /, '') : model;
}

export interface Settings {
  model: ModelId;
  /** Stop sending requests to Anthropic once this month's spending reaches this many US dollars. Null for no limit. */
  monthlyLimit: number | null;
  /** Global kill switch: when true, no saved patch renders on any site. */
  paused: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  model: 'claude-sonnet-5-5',
  monthlyLimit: null,
  paused: false,
};

export const SETTINGS_KEY = 'settings';

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = (result[SETTINGS_KEY] as Partial<Settings> | undefined) ?? {};
  // Only the settings Alter still has: an older version also stored a model on the user's computer.
  const { model = DEFAULT_SETTINGS.model, monthlyLimit = DEFAULT_SETTINGS.monthlyLimit, paused = DEFAULT_SETTINGS.paused } = stored;
  return { model, monthlyLimit, paused };
}

export async function updateSettings(changes: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...changes };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
