import { beforeEach, describe, expect, it, vi } from 'vitest';
import { currentMonth, getSpend, limitProblem, recordSpend } from '../../src/lib/spend';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  const later = <T>(value: () => T) => new Promise<T>((resolve) => setTimeout(() => resolve(value()), 0));
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: (key: string) => later(() => (key in store ? { [key]: structuredClone(store[key]) } : {})),
        set: (items: Record<string, unknown>) => later(() => void Object.assign(store, structuredClone(items))),
      },
    },
  });
});

const october = new Date(2026, 9, 11);
const november = new Date(2026, 10, 2);

describe('monthly spend', () => {
  it('adds up costs and requests, even when recorded at the same time', async () => {
    await Promise.all([recordSpend({ cost: 0.01, requests: 1 }, october), recordSpend({ cost: 0.02 }, october), recordSpend({ cost: 0.005, requests: 1 }, october)]);
    const spend = await getSpend(october);
    expect(spend.month).toBe('2026-10');
    expect(spend.cost).toBeCloseTo(0.035);
    expect(spend.requests).toBe(2);
  });

  it('starts from zero each month', async () => {
    await recordSpend({ cost: 1, requests: 3 }, october);
    expect(await getSpend(november)).toEqual({ month: '2026-11', cost: 0, requests: 0 });
    await recordSpend({ cost: 0.5, requests: 1 }, november);
    expect(await getSpend(november)).toEqual({ month: '2026-11', cost: 0.5, requests: 1 });
  });

  it('blocks requests once the limit is reached', () => {
    const spend = { month: currentMonth(october), cost: 5, requests: 10 };
    expect(limitProblem(spend, null)).toBeNull();
    expect(limitProblem(spend, 10)).toBeNull();
    expect(limitProblem(spend, 5)).toBe("You've reached your monthly limit of $5.00 for Alter. You can raise it in Settings.");
  });
});
