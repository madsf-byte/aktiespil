// Kursleverandør: Yahoo Finance (uofficielt API). Kan udskiftes – resten af koden kender kun KursKilde.
// NB: Yahoo afviser nogle standard-User-Agents (fx Deno's og falske Chrome fra Node) med 429,
// men accepterer en ærlig, egen User-Agent – både fra Supabase og lokalt.
import type { ChartPoint, Quote, SearchHit } from './types.ts';

export interface KursKilde {
  quote(symbol: string): Promise<Quote>;
  search(q: string): Promise<SearchHit[]>;
  chart(symbol: string, range: ChartRange): Promise<ChartPoint[]>;
  splits(symbol: string): Promise<Split[]>;
}

export type ChartRange = '1mo' | '6mo' | '1y';

export interface Split {
  /** Epoch sek. */
  date: number;
  numerator: number;
  denominator: number;
}

export class KursFejl extends Error {}

const BASE = 'https://query2.finance.yahoo.com';
const UA = 'Mozilla/5.0 (compatible; Aktiespil/1.0)';

/** Valutaer der noteres i underenhed (pence, cent, agorot). */
const UNDERENHED: Record<string, string> = { GBp: 'GBP', GBX: 'GBP', ZAc: 'ZAR', ILA: 'ILS' };

async function hent(url: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
  } catch {
    throw new KursFejl('Kursen kunne ikke hentes – prøv igen om lidt.');
  }
  if (res.status === 404) throw new KursFejl('Aktien blev ikke fundet.');
  if (!res.ok) throw new KursFejl('Kursen kunne ikke hentes – prøv igen om lidt.');
  return res.json();
}

/** Normaliserer chart-metadata fra Yahoo til en Quote. Eksporteret for test. */
export function tilQuote(meta: any): Quote {
  const reg = meta?.currentTradingPeriod?.regular;
  if (typeof meta?.regularMarketPrice !== 'number' || !reg || !meta.currency) {
    throw new KursFejl('Der findes ingen kurs for denne aktie.');
  }
  const under = UNDERENHED[meta.currency];
  const faktor = under ? 100 : 1;
  return {
    symbol: meta.symbol,
    name: meta.longName ?? meta.shortName ?? meta.symbol,
    currency: under ?? String(meta.currency).toUpperCase(),
    price: meta.regularMarketPrice / faktor,
    prevClose: typeof meta.chartPreviousClose === 'number' ? meta.chartPreviousClose / faktor : null,
    time: meta.regularMarketTime,
    exchange: meta.fullExchangeName ?? meta.exchangeName ?? '',
    timezone: meta.exchangeTimezoneName ?? 'UTC',
    sessionStart: reg.start,
    sessionEnd: reg.end,
  };
}

export const yahoo: KursKilde = {
  async quote(symbol) {
    const data = await hent(`${BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`);
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta) throw new KursFejl('Aktien blev ikke fundet.');
    return tilQuote(meta);
  },

  async search(q) {
    const data = await hent(
      `${BASE}/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=15&newsCount=0&listsCount=0&lang=da-DK`,
    );
    return (data?.quotes ?? [])
      .filter((x: any) => x.symbol && (x.quoteType === 'EQUITY' || x.quoteType === 'ETF'))
      .map((x: any) => ({
        symbol: x.symbol,
        name: x.longname ?? x.shortname ?? x.symbol,
        exchange: x.exchDisp ?? x.exchange ?? '',
        type: x.quoteType,
      }));
  },

  async chart(symbol, range) {
    const data = await hent(`${BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`);
    const r = data?.chart?.result?.[0];
    const faktor = UNDERENHED[r?.meta?.currency] ? 100 : 1;
    const ts: number[] = r?.timestamp ?? [];
    const closes: (number | null)[] = r?.indicators?.quote?.[0]?.close ?? [];
    return ts
      .map((t, i) => ({ t, close: closes[i] }))
      .filter((p): p is ChartPoint => typeof p.close === 'number')
      .map((p) => ({ t: p.t, close: p.close / faktor }));
  },

  async splits(symbol) {
    const data = await hent(
      `${BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d&events=split`,
    );
    const s = data?.chart?.result?.[0]?.events?.splits ?? {};
    return Object.values(s).map((x: any) => ({ date: x.date, numerator: x.numerator, denominator: x.denominator }));
  },
};
