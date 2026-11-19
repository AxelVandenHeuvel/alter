import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRates, parseRates, RATES_MAX_AGE_MS, RATES_URL, refreshRates, usesRates } from '../../src/lib/rates';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: structuredClone(store[key]) } : {}),
        set: async (items: Record<string, unknown>) => void Object.assign(store, structuredClone(items)),
      },
    },
  });
});

const CURRENCIES = ['USD', 'JPY', 'GBP', 'CAD', 'AUD', 'CHF', 'CNY', 'SEK', 'NOK', 'DKK', 'PLN', 'KRW'];
const response = (date = '2026-11-06', extra: unknown[] = []) => [
  ...CURRENCIES.map((quote, i) => ({ date, base: 'EUR', quote, rate: quote === 'JPY' ? 176.77 : 1 + i / 10 })),
  ...extra,
];
const fetcher = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response);

describe('parseRates', () => {
  it('reads the ECB rates per euro and the day they are for', () => {
    const rates = parseRates(response(), 1000)!;
    expect(rates).toMatchObject({ date: '2026-11-06', source: 'European Central Bank reference rates', fetchedAt: 1000 });
    expect(rates.perEuro.JPY).toBe(176.77);
    expect(Object.keys(rates.perEuro)).toHaveLength(CURRENCIES.length);
  });

  it('skips entries that are not plain currency rates', () => {
    const rates = parseRates(
      response('2026-11-06', [
        { date: '2026-11-06', base: 'USD', quote: 'MXN', rate: 18 },
        { date: '2026-11-06', base: 'EUR', quote: 'btc', rate: 0.00001 },
        { date: '2026-11-06', base: 'EUR', quote: 'XAU', rate: -1 },
        { date: 'soon', base: 'EUR', quote: 'INR', rate: 104 },
        null,
      ]),
      0,
    )!;
    expect(Object.keys(rates.perEuro).sort()).toEqual([...CURRENCIES].sort());
  });

  it('refuses responses that are not a full set of rates', () => {
    expect(parseRates({ error: 'rate limited' }, 0)).toBeNull();
    expect(parseRates(response().slice(0, 3), 0)).toBeNull();
  });
});

describe('refreshRates', () => {
  it('downloads rates when Alter has none, and keeps them', async () => {
    const download = fetcher(response());
    const rates = await refreshRates(download, 5000);
    expect(download).toHaveBeenCalledWith(RATES_URL, expect.objectContaining({ credentials: 'omit' }));
    expect(rates?.date).toBe('2026-11-06');
    expect(await getRates()).toEqual(rates);
  });

  it('uses the rates it has until they are old', async () => {
    await refreshRates(fetcher(response()), 0);
    const download = fetcher(response('2026-11-07'));
    expect((await refreshRates(download, RATES_MAX_AGE_MS - 1))?.date).toBe('2026-11-06');
    expect(download).not.toHaveBeenCalled();
    expect((await refreshRates(download, RATES_MAX_AGE_MS))?.date).toBe('2026-11-07');
  });

  it('keeps the old rates when the download fails or is broken', async () => {
    await refreshRates(fetcher(response()), 0);
    const later = RATES_MAX_AGE_MS * 2;
    expect((await refreshRates(vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))), later))?.date).toBe('2026-11-06');
    expect((await refreshRates(fetcher({}, false), later))?.date).toBe('2026-11-06');
    expect((await refreshRates(fetcher({ error: 'x' }), later))?.date).toBe('2026-11-06');
  });

  it('returns null when it never got rates', async () => {
    expect(await refreshRates(vi.fn(async () => Promise.reject(new TypeError('offline'))), 0)).toBeNull();
  });
});

describe('usesRates', () => {
  it('is true only for scripts that convert prices or read the rates', () => {
    expect(usesRates("el.textContent = alter.convert(alter.text(el), 'JPY').text;")).toBe(true);
    expect(usesRates('alter.log(alter.rates.date);')).toBe(true);
    expect(usesRates("alter.badge(el, alter.unitPrice(a, b, 'oz').text);")).toBe(false);
    expect(usesRates('const convert = (x) => x * 2; convert(2);')).toBe(false);
  });
});
