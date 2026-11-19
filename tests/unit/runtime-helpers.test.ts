import { afterEach, describe, expect, it } from 'vitest';
import type { ExchangeRates } from '../../src/lib/rates';
import { buildScript, type ScriptReport } from '../../src/lib/userscripts';

interface AlterGlobal {
  __alter?: { dispose(): void };
}

/** Evaluate an expression with the real injected runtime and return its JSON value. */
async function alter<T>(expression: string, rates: ExchangeRates | null = null): Promise<T> {
  const report = (await (0, eval)(buildScript('test', `alter.log(JSON.stringify(${expression}));`, { contain: false, rates }).code)) as ScriptReport;
  if (report.errors.length) throw new Error(report.errors.join('; '));
  return JSON.parse(report.logs[0]!) as T;
}

afterEach(() => {
  (globalThis as AlterGlobal).__alter?.dispose();
  document.body.innerHTML = '';
});

describe('alter.parsePrice', () => {
  it.each([
    ['$4.29', { amount: 4.29, currency: 'USD' }],
    ['Now $1,299.00 (was $1,499.00)', { amount: 1299, currency: 'USD' }],
    ['4,29 €', { amount: 4.29, currency: 'EUR' }],
    ['1.299,00 €', { amount: 1299, currency: 'EUR' }],
    ['£1.50 each', { amount: 1.5, currency: 'GBP' }],
    ['CA$12', { amount: 12, currency: 'CAD' }],
    ['USD 15.99', { amount: 15.99, currency: 'USD' }],
    ['89¢', { amount: 0.89, currency: 'USD' }],
    ['Out of stock', null],
  ])('%s', async (text, expected) => {
    expect(await alter(`alter.parsePrice(${JSON.stringify(text)})`)).toEqual(expected);
  });
});

describe('alter.parseQuantity', () => {
  it.each([
    ['Old Fashioned Oats, 18 oz', { value: 18, unit: 'oz', dimension: 'mass', base: 510.291 }],
    ['Orange Juice 52 fl oz', { value: 52, unit: 'fl oz', dimension: 'volume', base: 1537.822 }],
    ['Sparkling Water, 2 x 500 ml', { value: 1000, unit: 'ml', dimension: 'volume', base: 1000 }],
    ['Paper Towels 12-pack', { value: 12, unit: 'pack', dimension: 'count', base: 12 }],
    ['Ground Coffee 1.5 lb bag', { value: 1.5, unit: 'lb', dimension: 'mass', base: 680.388 }],
    ['Rice, 2kg', { value: 2, unit: 'kg', dimension: 'mass', base: 2000 }],
    ['Portable SSD 1 TB', { value: 1, unit: 'tb', dimension: 'data', base: 1e12 }],
    ['Gift card', null],
  ])('%s', async (text, expected) => {
    const result = await alter<{ base: number } | null>(`alter.parseQuantity(${JSON.stringify(text)})`);
    if (expected === null) return expect(result).toBeNull();
    expect({ ...result, base: Math.round(result!.base * 1000) / 1000 }).toEqual(expected);
  });
});

describe('alter.unitPrice', () => {
  it('computes price per unit across units of the same kind', async () => {
    const perOz = await alter<{ amount: number; unit: string; currency: string }>(`alter.unitPrice('$4.29', 'Oats, 18 oz', 'oz')`);
    expect(perOz.amount).toBeCloseTo(0.2383, 4);
    expect(perOz).toMatchObject({ unit: 'oz', currency: 'USD' });
    // 1.5 lb = 24 oz.
    expect((await alter<{ amount: number }>(`alter.unitPrice('$12.00', 'Coffee 1.5 lb', 'oz')`)).amount).toBeCloseTo(0.5, 6);
    expect((await alter<{ amount: number }>(`alter.unitPrice('3,00 €', '2 x 500 ml', 'l')`)).amount).toBeCloseTo(3, 6);
  });

  it('refuses to compare different kinds of units rather than guess', async () => {
    expect(await alter(`alter.unitPrice('$3.99', 'Juice 52 fl oz', 'oz')`)).toBeNull();
    expect(await alter(`alter.unitPrice('$3.99', 'Gift card', 'oz')`)).toBeNull();
    expect(await alter(`alter.unitPrice('Sold out', 'Oats 18 oz', 'oz')`)).toBeNull();
  });
});

describe('alter.badge', () => {
  it('adds a label beside the element that page styles cannot change, removed on dispose', async () => {
    document.body.innerHTML = '<style>span { color: red !important; font-size: 40px }</style><p class="price">$4.29</p>';
    await alter(`(alter.badge(document.querySelector('.price'), '$0.24/oz', { title: 'Price per ounce' }), true)`);
    const badge = document.querySelector('.price + alter-badge')!;
    expect(badge.getAttribute('title')).toBe('Price per ounce');
    expect(badge.shadowRoot!.querySelector('span')!.textContent).toBe('$0.24/oz');
    // The report counts labels showing on the page, so the model knows how many items got one.
    const added = () => ((globalThis as AlterGlobal).__alter as unknown as { report(): { added: number } }).report().added;
    expect(added()).toBe(1);
    badge.remove();
    expect(added()).toBe(0);
    (globalThis as AlterGlobal).__alter!.dispose();
    expect(document.querySelector('alter-badge')).toBeNull();
  });
});

describe('alter.formatPrice', () => {
  it('uses two decimals, and three for very small amounts', async () => {
    expect(await alter(`[alter.formatPrice(0.2383, 'USD'), alter.formatPrice(0.5, 'USD'), alter.formatPrice(0.0421, 'USD'), alter.formatPrice(12, 'USD')]`)).toEqual([
      '$0.24',
      '$0.50',
      '$0.042',
      '$12.00',
    ]);
  });
});

describe('alter.formatPrice in other currencies', () => {
  it('uses each currency’s own decimals', async () => {
    expect(await alter(`[alter.formatPrice(18450.4, 'JPY'), alter.formatPrice(129, 'EUR'), alter.formatPrice(0.04, 'USD')]`)).toEqual(['¥18,450', '€129.00', '$0.040']);
  });
});

const RATES: ExchangeRates = {
  date: '2026-11-06',
  source: 'European Central Bank reference rates',
  perEuro: { USD: 1.1165, JPY: 176.77, GBP: 0.83415, CAD: 1.5705 },
  fetchedAt: 0,
};

describe('alter.convert', () => {
  it('converts price text and amounts through the euro rates', async () => {
    const yen = await alter<{ amount: number; currency: string; text: string; date: string }>(`alter.convert('$129.00', 'jpy')`, RATES);
    expect(yen.amount).toBeCloseTo((129 / 1.1165) * 176.77, 6);
    expect(yen).toMatchObject({ currency: 'JPY', text: '¥20,424', date: '2026-11-06' });
    expect((await alter<{ text: string }>(`alter.convert({ amount: 50, currency: 'CAD' }, 'USD')`, RATES)).text).toBe('$35.55');
    expect((await alter<{ text: string }>(`alter.convert('£10', 'EUR')`, RATES)).text).toBe('€11.99');
  });

  it('returns null without rates, for currencies without a rate, and for text that isn’t a price', async () => {
    expect(await alter(`alter.convert('$129.00', 'JPY')`)).toBeNull();
    expect(await alter(`alter.convert('$129.00', 'XYZ')`, RATES)).toBeNull();
    expect(await alter(`alter.convert('Sold out', 'JPY')`, RATES)).toBeNull();
  });

  it('says where the rates come from and which day they are for', async () => {
    expect(await alter(`alter.rates`, RATES)).toEqual({ date: '2026-11-06', source: 'European Central Bank reference rates' });
    expect(await alter(`alter.rates`)).toBeNull();
  });
});
