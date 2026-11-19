/**
 * Exchange rates for scripts that convert prices (alter.convert). Scripts can't reach the
 * internet, so Alter downloads the European Central Bank's daily reference rates itself,
 * only when a script that converts prices runs, and hands them to it. The request asks
 * only for the rates; it carries nothing about the user's pages.
 *
 * The rates come through Frankfurter (open source, ECB data only with providers=ECB),
 * because the ECB's own feed doesn't allow requests from extensions.
 */

export interface ExchangeRates {
  /** The day the rates are for (the ECB publishes once each working day). */
  date: string;
  source: string;
  /** Units of each currency one euro buys. */
  perEuro: Record<string, number>;
  /** When Alter downloaded them. */
  fetchedAt: number;
}

export const RATES_KEY = 'exchange-rates';
export const RATES_URL = 'https://api.frankfurter.dev/v2/rates?providers=ECB';
export const RATES_SOURCE = 'European Central Bank reference rates';
/** The ECB publishes once a day; rates are downloaded again when the ones Alter has are older than this. */
export const RATES_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

/** Whether a script converts currencies, and so needs rates. */
export function usesRates(js: string): boolean {
  return /\b(?:alter|vb)\s*\.\s*(?:convert|rates)\b/.test(js);
}

/** Frankfurter's response: [{ date, base: 'EUR', quote: 'JPY', rate: 176.77 }, ...]. */
export function parseRates(json: unknown, fetchedAt: number): ExchangeRates | null {
  if (!Array.isArray(json)) return null;
  const perEuro: Record<string, number> = {};
  let date = '';
  for (const entry of json as Record<string, unknown>[]) {
    const { base, quote, rate } = entry ?? {};
    if (base !== 'EUR' || typeof quote !== 'string' || !/^[A-Z]{3}$/.test(quote)) continue;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) continue;
    if (typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) continue;
    perEuro[quote] = rate;
    if (entry.date > date) date = entry.date;
  }
  // A handful of currencies means a broken or partial response, not today's rates.
  if (Object.keys(perEuro).length < 10 || !perEuro.USD) return null;
  return { date, source: RATES_SOURCE, perEuro, fetchedAt };
}

/** The rates Alter has, however old, or null if it never got any. */
export async function getRates(): Promise<ExchangeRates | null> {
  const stored = (await chrome.storage.local.get(RATES_KEY))[RATES_KEY] as ExchangeRates | undefined;
  return stored ?? null;
}

/** Download new rates when the ones Alter has are old. Returns the newest rates it has, or null. */
export async function refreshRates(fetcher: typeof fetch = fetch, now = Date.now()): Promise<ExchangeRates | null> {
  const current = await getRates();
  if (current && now - current.fetchedAt < RATES_MAX_AGE_MS) return current;
  try {
    const response = await fetcher(RATES_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), credentials: 'omit' });
    if (!response.ok) return current;
    const fresh = parseRates(await response.json(), now);
    if (!fresh) return current;
    await chrome.storage.local.set({ [RATES_KEY]: fresh });
    return fresh;
  } catch {
    // Offline or slow: keep using what Alter has.
    return current;
  }
}
