// Kurser med cache i databasen, så mange elever ikke giver mange opslag hos leverandøren.
import type { Store } from './store.ts';
import type { ChartPoint, Quote, SearchHit } from './types.ts';
import { type ChartRange, KursFejl, type KursKilde, type Split } from './yahoo.ts';

export class Kurser {
  constructor(private store: Store, private kilde: KursKilde, private now: () => number) {}

  private async cached<T>(key: string, maxAge: number, hent: () => Promise<T>, staleOk = false): Promise<T> {
    const c = await this.store.cacheGet(key);
    if (c && this.now() - c.fetchedAt <= maxAge) return c.data as T;
    try {
      const data = await hent();
      await this.store.cachePut(key, data, this.now());
      return data;
    } catch (e) {
      if (staleOk && c) return c.data as T;
      throw e;
    }
  }

  /** Kurs højst `maxAge` sek. gammel (fra cachen). Med staleOk bruges en ældre kurs, hvis den ikke kan hentes. */
  quote(symbol: string, maxAge = 120, staleOk = false): Promise<Quote> {
    return this.cached(`q:${symbol}`, maxAge, () => this.kilde.quote(symbol), staleOk);
  }

  /** Kroner pr. enhed af valutaen. */
  async fx(currency: string, staleOk = false): Promise<number> {
    if (currency === 'DKK') return 1;
    const q = await this.quote(`${currency}DKK=X`, 600, staleOk);
    if (!(q.price > 0)) throw new KursFejl('Valutakursen kunne ikke hentes – prøv igen om lidt.');
    return q.price;
  }

  search(q: string): Promise<SearchHit[]> {
    return this.cached(`s:${q.toLowerCase()}`, 86400, () => this.kilde.search(q));
  }

  chart(symbol: string, range: ChartRange): Promise<ChartPoint[]> {
    return this.cached(`c:${symbol}:${range}`, range === '1mo' ? 1800 : 3600 * 6, () => this.kilde.chart(symbol, range));
  }

  splits(symbol: string): Promise<Split[]> {
    return this.kilde.splits(symbol);
  }
}
