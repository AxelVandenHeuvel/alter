/**
 * What the user's own Anthropic key has spent through Alter this calendar month,
 * computed from the token usage of every response. Kept only in this browser.
 */

export interface MonthlySpend {
  /** "2026-10". */
  month: string;
  /** US dollars. */
  cost: number;
  /** Requests (messages the user sent), not individual model calls. */
  requests: number;
}

export const SPEND_KEY = 'spend';

export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export async function getSpend(now = new Date()): Promise<MonthlySpend> {
  const stored = (await chrome.storage.local.get(SPEND_KEY))[SPEND_KEY] as MonthlySpend | undefined;
  const month = currentMonth(now);
  return stored?.month === month ? stored : { month, cost: 0, requests: 0 };
}

let writes: Promise<unknown> = Promise.resolve();

/** Add to this month's total; a new month starts from zero. Serialized so quick calls can't lose each other's amounts. */
export function recordSpend(change: { cost?: number; requests?: number }, now = new Date()): Promise<void> {
  const run = writes.then(async () => {
    const spend = await getSpend(now);
    const next: MonthlySpend = {
      ...spend,
      cost: spend.cost + (change.cost ?? 0),
      requests: spend.requests + (change.requests ?? 0),
    };
    await chrome.storage.local.set({ [SPEND_KEY]: next });
  });
  writes = run.catch(() => undefined);
  return run;
}

/** Why a request can't be sent under the monthly limit, or null when it can. */
export function limitProblem(spend: MonthlySpend, limit: number | null): string | null {
  if (limit === null || spend.cost < limit) return null;
  return `You've reached your monthly limit of $${limit.toFixed(2)} for Alter. You can raise it in Settings.`;
}
