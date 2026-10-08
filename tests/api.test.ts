import { beforeEach, describe, expect, it } from 'vitest';
import { ApiFejl, type Deps, haandter } from '../supabase/functions/_shared/api.ts';
import { Kurser } from '../supabase/functions/_shared/kurser.ts';
import type { Game, Order, Quote } from '../supabase/functions/_shared/types.ts';
import { KursFejl, type KursKilde, type Split } from '../supabase/functions/_shared/yahoo.ts';
import { MemoryStore } from './memory-store.ts';

const sek = (iso: string) => Date.parse(iso) / 1000;
// Tirsdag 6. okt. 2026. København åben 07:00–15:00Z, New York 13:30–20:00Z.
const DAG = '2026-10-06';
const cphSession = { sessionStart: sek(`${DAG}T07:00:00Z`), sessionEnd: sek(`${DAG}T15:00:00Z`), timezone: 'Europe/Copenhagen' };
const nySession = { sessionStart: sek(`${DAG}T13:30:00Z`), sessionEnd: sek(`${DAG}T20:00:00Z`), timezone: 'America/New_York' };

class FakeKilde implements KursKilde {
  priser: Record<string, number> = { 'NOVO-B.CO': 500, AAPL: 200, 'USDDKK=X': 6.5 };
  fejl = false;
  kald = 0;
  splitListe: Record<string, Split[]> = {};
  constructor(private now: () => number) {}
  async quote(symbol: string): Promise<Quote> {
    this.kald++;
    if (this.fejl) throw new KursFejl('Kursen kunne ikke hentes – prøv igen om lidt.');
    const price = this.priser[symbol];
    if (price === undefined) throw new KursFejl('Aktien blev ikke fundet.');
    const dansk = symbol.endsWith('.CO');
    const fx = symbol.endsWith('=X');
    const sess = fx ? { sessionStart: 0, sessionEnd: 4e9, timezone: 'UTC' } : dansk ? cphSession : nySession;
    // Kursen er 15 min. forsinket, men aldrig fra før åbning.
    return {
      symbol, name: dansk ? 'Novo Nordisk B' : symbol, currency: dansk || fx ? (fx ? 'DKK' : 'DKK') : 'USD',
      price, prevClose: price, time: Math.max(Math.min(this.now(), sess.sessionEnd) - 900, sess.sessionStart),
      exchange: dansk ? 'Copenhagen' : 'NasdaqGS', ...sess,
    };
  }
  async search() { return [{ symbol: 'NOVO-B.CO', name: 'Novo Nordisk B', exchange: 'Copenhagen', type: 'EQUITY' }]; }
  async chart() { return [{ t: 1, close: 1 }]; }
  async splits(symbol: string) { return this.splitListe[symbol] ?? []; }
}

let tid: number;
let store: MemoryStore;
let kilde: FakeKilde;
let d: Deps;
let laererToken: string | null;

const kald = (action: string, body: Record<string, any> = {}) =>
  haandter(d, { action, body, authorization: laererToken, cronSecret: null }) as Promise<any>;
const cron = () => haandter(d, { action: 'cron', body: {}, authorization: null, cronSecret: 'cron' }) as Promise<any>;

async function fejl(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { if (e instanceof ApiFejl || e instanceof KursFejl) return e.message; throw e; }
  throw new Error('forventede en fejl');
}

async function nytSpil(extra: Record<string, any> = {}): Promise<Game> {
  return kald('opret-spil', {
    name: '10.A', start: '2026-10-01', slut: '2027-04-06', start_capital: 100000,
    fee_dk_pct: 0.1, fee_dk_min: 29, fee_int_pct: 0.15, fee_int_min: 49, fx_pct: 0.25, max_pct: 20, ...extra,
  });
}

beforeEach(() => {
  tid = sek(`${DAG}T10:00:00Z`);
  store = new MemoryStore();
  kilde = new FakeKilde(() => tid);
  laererToken = 'Bearer laerer';
  d = {
    store, now: () => tid, secret: 'hemmelig', cronSecret: 'cron',
    kurser: new Kurser(store, kilde, () => tid),
    laerer: async (a) => (a === 'Bearer laerer' ? { id: 'L1', email: 'l@x.dk' } : null),
  };
});

describe('tilmelding og login', () => {
  it('elev melder sig til med kode og kaldenavn, får PIN og kan logge ind igen', async () => {
    const g = await nytSpil();
    expect(g.code).toMatch(/^[A-Z2-9]{6}$/);
    const t = await kald('tilmeld', { code: g.code.toLowerCase(), nickname: 'Aktie-Anna' });
    expect(t.pin).toMatch(/^[A-Z2-9]{6}$/);
    const mig = await kald('mig', { token: t.token });
    expect(mig.player.nickname).toBe('Aktie-Anna');
    expect(mig.vaerdi.total).toBe(100000);
    const l = await kald('login', { code: g.code, nickname: 'aktie-anna', pin: t.pin.toLowerCase() });
    expect(l.token).toBe(t.token);
    expect(await fejl(kald('login', { code: g.code, nickname: 'Aktie-Anna', pin: 'XXXXXX' }))).toMatch(/PIN passer ikke/);
  });

  it('afviser dobbelte kaldenavne og låst tilmelding', async () => {
    const g = await nytSpil();
    await kald('tilmeld', { code: g.code, nickname: 'Bo' });
    expect(await fejl(kald('tilmeld', { code: g.code, nickname: 'bo' }))).toMatch(/taget/);
    await kald('ret-spil', { id: g.id, join_locked: true });
    expect(await fejl(kald('tilmeld', { code: g.code, nickname: 'Ida' }))).toMatch(/lukket for tilmelding/);
  });

  it('nulstillet PIN logger eleven ud, og ny PIN virker', async () => {
    const g = await nytSpil();
    const t = await kald('tilmeld', { code: g.code, nickname: 'Bo' });
    const p = store.playerRows[0];
    const { pin } = await kald('nulstil-pin', { playerId: p.id });
    expect(await fejl(kald('mig', { token: t.token }))).toMatch(/logget ud/);
    const l = await kald('login', { code: g.code, nickname: 'Bo', pin });
    expect((await kald('mig', { token: l.token })).player.nickname).toBe('Bo');
  });

  it('andre lærere kan ikke se spillet', async () => {
    const g = await nytSpil();
    laererToken = 'Bearer anden';
    expect(await fejl(kald('spil', { id: g.id }))).toMatch(/logge ind som lærer/);
  });
});

describe('handel mens børsen er åben', () => {
  let token: string;
  beforeEach(async () => {
    const g = await nytSpil();
    token = (await kald('tilmeld', { code: g.code, nickname: 'Bo' })).token;
  });

  it('køb gennemføres straks med kurtage', async () => {
    const o: Order = await kald('ordre', { token, symbol: 'NOVO-B.CO', side: 'buy', qty: 10 });
    expect(o).toMatchObject({ status: 'executed', price: 500, value_dkk: 5000, fee_dkk: 29, total_dkk: 5029 });
    const mig = await kald('mig', { token });
    expect(mig.vaerdi.cash).toBe(94971);
    expect(mig.vaerdi.total).toBe(99971);
  });

  it('udenlandsk køb omregnes og får valutatillæg', async () => {
    const o: Order = await kald('ordre', { token, symbol: 'AAPL', side: 'buy', qty: 5 });
    // Klokken 10Z er New York lukket → venter.
    expect(o.status).toBe('pending');
    tid = sek(`${DAG}T15:00:00Z`);
    const o2: Order = await kald('ordre', { token, symbol: 'AAPL', side: 'buy', qty: 10 });
    expect(o2).toMatchObject({ status: 'executed', fx_rate: 6.5, value_dkk: 13000, fee_dkk: 49, fx_fee_dkk: 32.5, total_dkk: 13081.5 });
  });

  it('grænsen pr. aktie regnes af startkapitalen og gennemsnitlig købspris', async () => {
    await kald('ordre', { token, symbol: 'NOVO-B.CO', side: 'buy', qty: 40 }); // 20.000 kr.
    expect(await fejl(kald('ordre', { token, symbol: 'NOVO-B.CO', side: 'buy', qty: 1 }))).toMatch(/højst have 20\.000,00 kr\./);
    await kald('ordre', { token, symbol: 'NOVO-B.CO', side: 'sell', qty: 10 });
    kilde.priser['NOVO-B.CO'] = 1000; // kursen stiger – investeret beløb er stadig købsprisen
    store.cache.clear();
    expect((await kald('ordre', { token, symbol: 'NOVO-B.CO', side: 'buy', qty: 5 })).status).toBe('executed');
  });

  it('salg kræver ejede aktier og giver kontanter', async () => {
    expect(await fejl(kald('ordre', { token, symbol: 'NOVO-B.CO', side: 'sell', qty: 1 }))).toMatch(/ingen ledige/);
    await kald('ordre', { token, symbol: 'NOVO-B.CO', side: 'buy', qty: 10 });
    const s: Order = await kald('ordre', { token, symbol: 'NOVO-B.CO', side: 'sell', qty: 10 });
    expect(s.total_dkk).toBe(4971);
    const mig = await kald('mig', { token });
    expect(mig.vaerdi.positions).toHaveLength(0);
    expect(mig.vaerdi.cash).toBe(99942);
  });

  it('afviser handel uden ny kurs, og når kursen ikke kan hentes', async () => {
    tid = sek(`${DAG}T10:00:00Z`);
    kilde.fejl = true;
    expect(await fejl(kald('ordre', { token, symbol: 'NOVO-B.CO', side: 'buy', qty: 1 }))).toMatch(/kunne ikke hentes/);
  });

  it('cacher kurser i 2 minutter', async () => {
    await kald('aktie', { token, symbol: 'NOVO-B.CO' });
    await kald('aktie', { token, symbol: 'NOVO-B.CO' });
    expect(kilde.kald).toBe(1);
    tid += 121;
    await kald('aktie', { token, symbol: 'NOVO-B.CO' });
    expect(kilde.kald).toBe(2);
  });
});

describe('ordrer mens børsen er lukket', () => {
  let token: string;
  let g: Game;
  beforeEach(async () => {
    g = await nytSpil();
    token = (await kald('tilmeld', { code: g.code, nickname: 'Bo' })).token;
    tid = sek(`${DAG}T18:00:00Z`); // København lukket
  });

  it('køb venter, reserverer pris + 10 % og gennemføres ved åbning', async () => {
    const o: Order = await kald('ordre', { token, symbol: 'NOVO-B.CO', side: 'buy', qty: 10 });
    expect(o).toMatchObject({ status: 'pending', earliest_at: '2026-10-07T07:00:00.000Z', reserved_dkk: 5531.9 });
    let mig = await kald('mig', { token });
    expect(mig.vaerdi.cash).toBe(94468.1);
    expect(mig.vaerdi.total).toBe(100000);

    // Næste morgen: ny handelsperiode, kursen er steget.
    tid = sek('2026-10-07T07:20:00Z');
    Object.assign(cphSession, { sessionStart: sek('2026-10-07T07:00:00Z'), sessionEnd: sek('2026-10-07T15:00:00Z') });
    kilde.priser['NOVO-B.CO'] = 510;
    store.cache.clear();
    const log = await cron();
    expect(log.gennemfoert).toBe(1);
    mig = await kald('mig', { token });
    expect(mig.pending).toHaveLength(0);
    expect(mig.vaerdi.cash).toBe(100000 - 5129);
    Object.assign(cphSession, { sessionStart: sek(`${DAG}T07:00:00Z`), sessionEnd: sek(`${DAG}T15:00:00Z`) });
  });

  it('venter hvis kursen er fra før ordren blev lagt', async () => {
    await kald('ordre', { token, symbol: 'NOVO-B.CO', side: 'buy', qty: 10 });
    tid = sek(`${DAG}T19:00:00Z`);
    expect((await cron()).venter).toBe(1);
  });

  it('afviser ved åbning hvis prisen er steget så meget, at pengene ikke rækker', async () => {
    const t2 = (await kald('tilmeld', { code: g.code, nickname: 'Ida' })).token;
    tid = sek(`${DAG}T10:00:00Z`);
    await kald('ordre', { token: t2, symbol: 'AAPL', side: 'buy', qty: 1 }); // lukket i NY → venter
    // Ida har ingen ledige kontanter tilbage ud over det reserverede.
    const reserveret = store.orderRows[0].reserved_dkk;
    expect(reserveret).toBeGreaterThan(0);
    store.playerRows.find((p) => p.nickname === 'Ida')!.cash = 0;
    tid = sek(`${DAG}T14:00:00Z`);
    kilde.priser.AAPL = 400;
    store.cache.clear();
    const log = await cron();
    expect(log.afvist).toBe(1);
    const h: Order[] = await kald('historik', { token: t2 });
    expect(h[0].status).toBe('rejected');
    expect(h[0].reason).toMatch(/Afvist ved børsåbning: Du har ikke nok kontanter/);
    expect(store.playerRows.find((p) => p.nickname === 'Ida')!.cash).toBe(reserveret);
  });

  it('salg reserverer aktierne så de ikke kan sælges to gange', async () => {
    tid = sek(`${DAG}T10:00:00Z`);
    await kald('ordre', { token, symbol: 'NOVO-B.CO', side: 'buy', qty: 10 });
    tid = sek(`${DAG}T18:00:00Z`);
    await kald('ordre', { token, symbol: 'NOVO-B.CO', side: 'sell', qty: 6 });
    expect(await fejl(kald('ordre', { token, symbol: 'NOVO-B.CO', side: 'sell', qty: 5 }))).toMatch(/højst sælge 4/);
  });

  it('afvises hvis børsen først åbner efter spillets slut', async () => {
    tid = sek('2026-10-09T18:00:00Z'); // fredag aften; børsen åbner mandag
    await kald('ret-spil', { id: g.id, slut: '2026-10-10' });
    expect(await fejl(kald('ordre', { token, symbol: 'NOVO-B.CO', side: 'buy', qty: 1 }))).toMatch(/Spillet er slut|efter spillets afslutning/);
  });
});

describe('spillets afslutning og lærerens satser', () => {
  it('afslut nu annullerer ventende ordrer og fryser ranglisten', async () => {
    const g = await nytSpil();
    const a = (await kald('tilmeld', { code: g.code, nickname: 'Anna' })).token;
    const b = (await kald('tilmeld', { code: g.code, nickname: 'Bo' })).token;
    await kald('ordre', { token: a, symbol: 'NOVO-B.CO', side: 'buy', qty: 40 });
    tid = sek(`${DAG}T18:00:00Z`);
    await kald('ordre', { token: b, symbol: 'NOVO-B.CO', side: 'buy', qty: 1 });
    await kald('afslut-spil', { id: g.id });
    const bo = await kald('mig', { token: b });
    expect(bo.pending).toHaveLength(0);
    expect(bo.vaerdi.cash).toBe(100000);
    kilde.priser['NOVO-B.CO'] = 1000;
    store.cache.clear();
    const r = await kald('rangliste', { token: a });
    expect(r.finished).toBe(true);
    expect(r.rows.map((x: any) => x.nickname)).toEqual(['Bo', 'Anna']);
    expect(r.rows[1].value).toBe(99971);
    expect(await fejl(kald('ordre', { token: a, symbol: 'NOVO-B.CO', side: 'sell', qty: 1 }))).toMatch(/slut/);
  });

  it('satser låses når der er handlet', async () => {
    const g = await nytSpil();
    await kald('ret-spil', { id: g.id, satser: { max_pct: 50 } });
    expect((await store.game(g.id))!.max_pct).toBe(50);
    const t = (await kald('tilmeld', { code: g.code, nickname: 'Bo' })).token;
    await kald('ordre', { token: t, symbol: 'NOVO-B.CO', side: 'buy', qty: 1 });
    expect(await fejl(kald('ret-spil', { id: g.id, satser: { max_pct: 30 } }))).toMatch(/låst/);
  });

  it('planlæggeren afslutter spil på slutdatoen og gemmer dagsværdier', async () => {
    const g = await nytSpil({ slut: '2026-10-07' });
    await kald('tilmeld', { code: g.code, nickname: 'Bo' });
    expect((await cron()).dagsvaerdier).toBe(1);
    expect(store.snaps).toEqual([{ player_id: store.playerRows[0].id, day: DAG, value: 100000 }]);
    tid = sek('2026-10-07T15:00:00Z');
    expect((await cron()).afsluttet).toBe(1);
    expect((await store.game(g.id))!.finished_at).not.toBeNull();
    expect(store.playerRows[0].final_value).toBe(100000);
  });

  it('aktiesplit ganger antallet op', async () => {
    const g = await nytSpil();
    const t = (await kald('tilmeld', { code: g.code, nickname: 'Bo' })).token;
    await kald('ordre', { token: t, symbol: 'NOVO-B.CO', side: 'buy', qty: 10 });
    kilde.splitListe['NOVO-B.CO'] = [{ date: tid + 3600, numerator: 2, denominator: 1 }];
    tid += 7200;
    await cron();
    expect(store.holdingRows[0]).toMatchObject({ qty: 20, invested_dkk: 5000 });
    await store.stateSet('split', '');
    await cron();
    expect(store.holdingRows[0].qty).toBe(20);
  });
});
