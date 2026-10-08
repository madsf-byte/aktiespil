// Demo-tilstand (VITE_DEMO=1): hele serverlogikken kører i browseren med opdigtede kurser.
// Bruges til at prøve appen uden Supabase og til test i browseren.
import { haandter } from '../../supabase/functions/_shared/api.ts';
import { Kurser } from '../../supabase/functions/_shared/kurser.ts';
import { tzOffset } from '../../supabase/functions/_shared/tid.ts';
import type { ChartPoint, Quote, SearchHit } from '../../supabase/functions/_shared/types.ts';
import { KursFejl, type KursKilde } from '../../supabase/functions/_shared/yahoo.ts';
import { MemoryStore } from './memory-store.ts';

interface DemoAktie { symbol: string; name: string; currency: string; price: number; exchange: string; tz: string; open: [number, number]; close: [number, number] }

const CPH = { exchange: 'Copenhagen', tz: 'Europe/Copenhagen', open: [9, 0], close: [17, 0] } as const;
const NY = { exchange: 'NasdaqGS', tz: 'America/New_York', open: [9, 30], close: [16, 0] } as const;
const LON = { exchange: 'LSE', tz: 'Europe/London', open: [8, 0], close: [16, 30] } as const;

const AKTIER: DemoAktie[] = [
  { symbol: 'NOVO-B.CO', name: 'Novo Nordisk A/S', currency: 'DKK', price: 249.4, ...CPH, open: [9, 0], close: [17, 0] },
  { symbol: 'MAERSK-B.CO', name: 'A.P. Møller - Mærsk A/S', currency: 'DKK', price: 11250, ...CPH, open: [9, 0], close: [17, 0] },
  { symbol: 'CARL-B.CO', name: 'Carlsberg A/S', currency: 'DKK', price: 812, ...CPH, open: [9, 0], close: [17, 0] },
  { symbol: 'VWS.CO', name: 'Vestas Wind Systems A/S', currency: 'DKK', price: 121.5, ...CPH, open: [9, 0], close: [17, 0] },
  { symbol: 'AAPL', name: 'Apple Inc.', currency: 'USD', price: 231.2, ...NY, open: [9, 30], close: [16, 0] },
  { symbol: 'TSLA', name: 'Tesla, Inc.', currency: 'USD', price: 412.8, ...NY, open: [9, 30], close: [16, 0] },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', currency: 'USD', price: 178.4, ...NY, open: [9, 30], close: [16, 0] },
  { symbol: 'SHEL.L', name: 'Shell plc', currency: 'GBP', price: 27.15, ...LON, open: [8, 0], close: [16, 30] },
];
const FX: Record<string, number> = { USD: 6.42, GBP: 8.55 };

/** Deterministisk "tilfældig" kurs der bevæger sig langsomt. */
function kurs(a: DemoAktie, t: number): number {
  const h = [...a.symbol].reduce((s, c) => s + c.charCodeAt(0), 0);
  const dage = t / 86400;
  return Math.round(a.price * (1 + 0.08 * Math.sin(dage / 25 + h) + 0.03 * Math.sin(dage / 4 + h * 2) + 0.006 * Math.sin(t / 2000 + h)) * 100) / 100;
}

/** Dagens handelsperiode i børsens tidszone; i weekenden fredagens. */
function session(a: DemoAktie, now: number) {
  let t = now;
  for (let i = 0; i < 3; i++) {
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: a.tz, weekday: 'short' }).format(new Date(t * 1000));
    if (wd !== 'Sat' && wd !== 'Sun') break;
    t -= 86400;
  }
  const dato = new Intl.DateTimeFormat('sv-SE', { timeZone: a.tz }).format(new Date(t * 1000));
  const [y, m, d] = dato.split('-').map(Number);
  const lokal = (hm: readonly [number, number]) => {
    const g = Date.UTC(y, m - 1, d, hm[0], hm[1]) / 1000;
    return g - tzOffset(a.tz, g);
  };
  return { sessionStart: lokal(a.open), sessionEnd: lokal(a.close) };
}

const demoKilde: KursKilde = {
  async quote(symbol): Promise<Quote> {
    const now = Date.now() / 1000;
    const fx = symbol.match(/^([A-Z]{3})DKK=X$/);
    if (fx && FX[fx[1]]) {
      return { symbol, name: symbol, currency: 'DKK', price: FX[fx[1]], prevClose: FX[fx[1]], time: now - 60, exchange: 'CCY', timezone: 'UTC', sessionStart: 0, sessionEnd: 4e9 };
    }
    const a = AKTIER.find((x) => x.symbol === symbol);
    if (!a) throw new KursFejl('Aktien blev ikke fundet.');
    const s = session(a, now);
    // Før åbning: gårsdagens lukkekurs.
    const time = now < s.sessionStart ? s.sessionEnd - 86400 : Math.max(s.sessionStart, Math.min(now, s.sessionEnd) - 900);
    return {
      symbol, name: a.name, currency: a.currency, price: kurs(a, time), prevClose: kurs(a, s.sessionStart - 3600 * 7),
      time, exchange: a.exchange, timezone: a.tz, ...s,
    };
  },
  async search(q): Promise<SearchHit[]> {
    const l = q.toLowerCase();
    return AKTIER.filter((a) => a.name.toLowerCase().includes(l) || a.symbol.toLowerCase().includes(l))
      .map((a) => ({ symbol: a.symbol, name: a.name, exchange: a.exchange, type: 'EQUITY' }));
  },
  async chart(symbol, range): Promise<ChartPoint[]> {
    const a = AKTIER.find((x) => x.symbol === symbol);
    if (!a) return [];
    const dage = range === '1mo' ? 30 : range === '6mo' ? 182 : 365;
    const now = Date.now() / 1000;
    return Array.from({ length: dage }, (_, i) => {
      const t = now - (dage - i) * 86400;
      return { t, close: kurs(a, t) };
    });
  },
  async splits() { return []; },
};

const NOEGLE = 'aktiespil.demo-db';
const store = new MemoryStore();
try {
  const gemt = localStorage.getItem(NOEGLE);
  if (gemt) store.load(gemt);
} catch { /* ingen lagring */ }

const now = () => Date.now() / 1000;
const deps = {
  store, now, kurser: new Kurser(store, demoKilde, now), secret: 'demo', cronSecret: 'demo',
  laerer: async (a: string | null) => (a ? { id: 'demo-laerer', email: 'demo@skole.dk' } : null),
};

// Planlæggeren kører hvert minut i demoen.
setInterval(() => { void demoKald('cron', {}, null, 'demo'); }, 60_000);

export async function demoKald(action: string, data: unknown, laererToken: string | null, cronSecret: string | null = null) {
  const svar = await haandter(deps, { action, body: data as Record<string, unknown>, authorization: laererToken ? `Bearer ${laererToken}` : null, cronSecret });
  try { localStorage.setItem(NOEGLE, store.dump()); } catch { /* ingen lagring */ }
  return JSON.parse(JSON.stringify(svar ?? null));
}
