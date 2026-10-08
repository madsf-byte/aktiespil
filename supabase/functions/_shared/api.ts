// Alle handlinger i appen. Kaldes fra Deno-funktionen (index.ts) og fra tests.
import { hashPin, laesNoegle, lavNoegle, tilfaeldigKode } from './auth.ts';
import {
  afslutSpil, ApiFejl, gemDagsvaerdier, gennemfoerVentende, justerSplit, laegOrdre, type Motor,
  type Position, rangliste, vaerdisaet,
} from './motor.ts';
import { datoKl, danskDato, boersstatus, kursErFrisk } from './tid.ts';
import type { Game, Order, Player, Satser } from './types.ts';
import { KursFejl, type ChartRange } from './yahoo.ts';

export { ApiFejl };

export interface Deps extends Motor {
  secret: string;
  cronSecret: string;
  /** Den indloggede bruger (Supabase Auth) ud fra Authorization-headeren, eller null. */
  laerer(authorization: string | null): Promise<{ id: string; email: string } | null>;
  /** Administratorer (små bogstaver) – må altid oprette spil og styrer lærerlisten. */
  admins: string[];
}

export interface Kald {
  action: string;
  body: Record<string, any>;
  authorization: string | null;
  cronSecret: string | null;
}

export type SpilInfo = Omit<Game, 'owner_id'>;
export interface Spiller { id: string; nickname: string; created_at: string }
export interface RangRaekke { id: string; nickname: string; value: number; returnPct: number }

const offentligtSpil = ({ owner_id: _, ...g }: Game): SpilInfo => g;
const offentligSpiller = (p: Player): Spiller => ({ id: p.id, nickname: p.nickname, created_at: p.created_at });

function str(x: unknown, navn: string, max = 100): string {
  if (typeof x !== 'string' || !x.trim()) throw new ApiFejl(`${navn} mangler.`);
  return x.trim().slice(0, max);
}

const normKode = (k: unknown) => str(k, 'Klassekoden', 20).toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function haandter(d: Deps, k: Kald): Promise<unknown> {
  const b = k.body ?? {};
  switch (k.action) {
    // ---------- Elev uden login ----------
    case 'info': {
      const g = await findSpil(d, b.code);
      return { name: g.name, joinLocked: g.join_locked, finished: !!g.finished_at || d.now() >= Date.parse(g.end_at) / 1000 };
    }
    case 'tilmeld': return tilmeld(d, b);
    case 'login': return login(d, b);

    // ---------- Elev med nøgle ----------
    case 'mig': {
      const { p, g } = await elev(d, b);
      const [holdings, orders, snapshots] = await Promise.all([d.store.holdings(p.id), d.store.orders(p.id), d.store.snapshots(p.id)]);
      const pending = orders.filter((o) => o.status === 'pending');
      return { game: offentligtSpil(g), player: offentligSpiller(p), vaerdi: await vaerdisaet(d, p, holdings, pending), pending, snapshots };
    }
    case 'rangliste': {
      const { g } = await elev(d, b);
      return { rows: (await rangliste(d, g)).map(tilRaekke), finished: !!g.finished_at };
    }
    case 'spiller': {
      const { g } = await elev(d, b);
      const p = await d.store.player(str(b.id, 'Spiller'));
      if (!p || p.removed || p.game_id !== g.id) throw new ApiFejl('Spilleren findes ikke.', 404);
      const [holdings, orders] = await Promise.all([d.store.holdings(p.id), d.store.orders(p.id)]);
      const v = await vaerdisaet(d, p, holdings, orders.filter((o) => o.status === 'pending'));
      return { player: offentligSpiller(p), vaerdi: v };
    }
    case 'historik': {
      const { p } = await elev(d, b);
      return d.store.orders(p.id);
    }
    case 'soeg': {
      await elev(d, b);
      const q = str(b.q, 'Søgeord', 50);
      return d.kurser.search(q);
    }
    case 'aktie': {
      const { p } = await elev(d, b);
      const symbol = str(b.symbol, 'Aktie', 30);
      const quote = await d.kurser.quote(symbol);
      const fx = await d.kurser.fx(quote.currency);
      const [holdings, orders] = await Promise.all([d.store.holdings(p.id), d.store.orders(p.id)]);
      const now = d.now();
      return {
        quote, fx, now,
        status: boersstatus(quote, now),
        frisk: kursErFrisk(quote, now),
        holding: holdings.find((h) => h.symbol === quote.symbol) ?? null,
        pendingEst: orders.filter((o) => o.status === 'pending' && o.side === 'buy' && o.symbol === quote.symbol)
          .reduce((s, o) => s + o.est_value_dkk, 0),
        cash: p.cash,
      };
    }
    case 'graf': {
      await elev(d, b);
      const range: ChartRange = ['1mo', '6mo', '1y'].includes(b.range) ? b.range : '6mo';
      return d.kurser.chart(str(b.symbol, 'Aktie', 30), range);
    }
    case 'ordre': {
      const { p, g } = await elev(d, b);
      return laegOrdre(d, g, p.id, str(b.symbol, 'Aktie', 30), b.side, Number(b.qty));
    }

    // ---------- Lærer ----------
    case 'laerer-info': {
      const u = await d.laerer(k.authorization);
      if (!u) throw new ApiFejl('Du skal logge ind som lærer.', 401);
      const admin = d.admins.includes(u.email);
      return { email: u.email, admin, adgang: admin || !!await d.store.teacher(u.email) };
    }
    case 'laerere': {
      await admin(d, k);
      return d.store.teachers();
    }
    case 'tilfoej-laerer': {
      const a = await admin(d, k);
      const email = str(b.email, 'E-mail', 200).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiFejl('Det ligner ikke en e-mailadresse.');
      await d.store.addTeacher({ email, added_by: a.email, created_at: new Date(d.now() * 1000).toISOString() });
      return d.store.teachers();
    }
    case 'fjern-laerer': {
      await admin(d, k);
      const email = str(b.email, 'E-mail', 200).toLowerCase();
      if (d.admins.includes(email)) throw new ApiFejl('En administrator kan ikke fjernes her.');
      await d.store.removeTeacher(email);
      return d.store.teachers();
    }
    case 'mine-spil': {
      const l = await laerer(d, k);
      return d.store.gamesByOwner(l.id);
    }
    case 'opret-spil': return opretSpil(d, await laerer(d, k), b);
    case 'ret-spil': return retSpil(d, await eget(d, k, b.id), b);
    case 'afslut-spil': {
      const g = await eget(d, k, b.id);
      if (!g.finished_at) {
        await d.store.updateGame(g.id, { end_at: new Date(d.now() * 1000).toISOString() });
        await afslutSpil(d, g);
      }
      return d.store.game(g.id);
    }
    case 'spil': {
      const g = await eget(d, k, b.id);
      const [liste, holdings, orders, hasOrders] = await Promise.all([
        rangliste(d, g), d.store.holdingsForGame(g.id), d.store.ordersForGame(g.id), d.store.hasOrders(g.id),
      ]);
      const rows = await Promise.all(liste.map(async (x) => {
        const mine = orders.filter((o) => o.player_id === x.player.id);
        const v = await vaerdisaet(d, x.player, holdings.filter((h) => h.player_id === x.player.id), mine.filter((o) => o.status === 'pending'));
        return { ...tilRaekke(x), created_at: x.player.created_at, positions: v.positions, cash: v.cash, reserved: v.reserved, orders: mine };
      }));
      return { game: g, hasOrders, rows };
    }
    case 'nulstil-pin': {
      const p = await egenSpiller(d, k, b.playerId);
      const pin = tilfaeldigKode(6);
      await d.store.updatePlayer(p.id, { pin_hash: await hashPin(d.secret, p.id, pin), pin_version: p.pin_version + 1 });
      return { pin };
    }
    case 'fjern-spiller': {
      const p = await egenSpiller(d, k, b.playerId);
      await d.store.updatePlayer(p.id, { removed: true });
      return { ok: true };
    }

    // ---------- Planlægger ----------
    case 'cron': {
      if (!d.cronSecret || k.cronSecret !== d.cronSecret) throw new ApiFejl('Ingen adgang.', 401);
      return planlaeg(d);
    }
  }
  throw new ApiFejl('Ukendt handling.', 404);
}

function tilRaekke(x: { player: Player; value: number; returnPct: number }): RangRaekke {
  return { id: x.player.id, nickname: x.player.nickname, value: x.value, returnPct: x.returnPct };
}

async function findSpil(d: Deps, code: unknown): Promise<Game> {
  const g = await d.store.gameByCode(normKode(code));
  if (!g) throw new ApiFejl('Der findes intet spil med den klassekode.', 404);
  return g;
}

async function elev(d: Deps, b: Record<string, any>): Promise<{ p: Player; g: Game }> {
  const n = await laesNoegle(d.secret, b.token);
  const p = n && await d.store.player(n.playerId);
  if (!p || p.removed || p.pin_version !== n!.pinVersion) throw new ApiFejl('Du er logget ud. Log ind igen.', 401);
  const g = await d.store.game(p.game_id);
  if (!g) throw new ApiFejl('Spillet findes ikke længere.', 404);
  return { p, g };
}

const KALDENAVN = /^[\p{L}\p{N} _.\-]{2,20}$/u;

async function tilmeld(d: Deps, b: Record<string, any>) {
  const g = await findSpil(d, b.code);
  if (g.finished_at || d.now() >= Date.parse(g.end_at) / 1000) throw new ApiFejl('Spillet er slut.');
  if (g.join_locked) throw new ApiFejl('Læreren har lukket for tilmelding til dette spil.');
  const nickname = str(b.nickname, 'Kaldenavn', 40).replace(/\s+/g, ' ');
  if (!KALDENAVN.test(nickname)) throw new ApiFejl('Kaldenavnet skal være 2–20 tegn: bogstaver, tal, mellemrum, punktum eller bindestreg.');
  if (await d.store.playerByNickname(g.id, nickname)) throw new ApiFejl('Det kaldenavn er taget – vælg et andet.');
  const id = crypto.randomUUID();
  const pin = tilfaeldigKode(6);
  await d.store.insertPlayer({
    id, game_id: g.id, nickname, pin_hash: await hashPin(d.secret, id, pin), pin_version: 1,
    cash: g.start_capital, version: 1, removed: false, final_value: null, created_at: new Date(d.now() * 1000).toISOString(),
  });
  return { token: await lavNoegle(d.secret, id, 1), pin };
}

async function login(d: Deps, b: Record<string, any>) {
  const g = await findSpil(d, b.code);
  const p = await d.store.playerByNickname(g.id, str(b.nickname, 'Kaldenavn', 40).replace(/\s+/g, ' '));
  const pin = str(b.pin, 'PIN', 20).replace(/\s/g, '');
  if (!p || await hashPin(d.secret, p.id, pin) !== p.pin_hash) {
    throw new ApiFejl('Kaldenavn eller PIN passer ikke. Spørg din lærer, hvis du har glemt din PIN.', 401);
  }
  return { token: await lavNoegle(d.secret, p.id, p.pin_version) };
}

async function laerer(d: Deps, k: Kald) {
  const l = await d.laerer(k.authorization);
  if (!l) throw new ApiFejl('Du skal logge ind som lærer.', 401);
  if (!d.admins.includes(l.email) && !await d.store.teacher(l.email)) {
    throw new ApiFejl('Din konto har ikke adgang endnu – bed en administrator om at tilføje dig.', 403);
  }
  return l;
}

async function admin(d: Deps, k: Kald) {
  const l = await d.laerer(k.authorization);
  if (!l) throw new ApiFejl('Du skal logge ind som lærer.', 401);
  if (!d.admins.includes(l.email)) throw new ApiFejl('Kun administratorer kan styre lærerlisten.', 403);
  return l;
}

async function eget(d: Deps, k: Kald, id: unknown): Promise<Game> {
  const l = await laerer(d, k);
  const g = await d.store.game(str(id, 'Spil'));
  if (!g || g.owner_id !== l.id) throw new ApiFejl('Spillet findes ikke.', 404);
  return g;
}

async function egenSpiller(d: Deps, k: Kald, playerId: unknown): Promise<Player> {
  const p = await d.store.player(str(playerId, 'Spiller'));
  if (!p) throw new ApiFejl('Spilleren findes ikke.', 404);
  await eget(d, k, p.game_id);
  return p;
}

const DATO = /^\d{4}-\d{2}-\d{2}$/;

function tjekSatser(x: Record<string, any>, gamle?: Satser): Satser {
  const tal = (navn: keyof Satser, min: number, max: number, label: string) => {
    const v = x[navn] === undefined && gamle ? gamle[navn] : Number(x[navn]);
    if (!Number.isFinite(v) || v < min || v > max) throw new ApiFejl(`${label} skal være mellem ${min} og ${max}.`);
    return v;
  };
  return {
    start_capital: tal('start_capital', 1000, 100_000_000, 'Startkapital'),
    fee_dk_pct: tal('fee_dk_pct', 0, 10, 'Kurtage (danske aktier) i %'),
    fee_dk_min: tal('fee_dk_min', 0, 10000, 'Minimumskurtage (danske aktier)'),
    fee_int_pct: tal('fee_int_pct', 0, 10, 'Kurtage (udenlandske aktier) i %'),
    fee_int_min: tal('fee_int_min', 0, 10000, 'Minimumskurtage (udenlandske aktier)'),
    fx_pct: tal('fx_pct', 0, 10, 'Valutatillæg i %'),
    max_pct: tal('max_pct', 1, 100, 'Grænse pr. aktie i %'),
  };
}

async function opretSpil(d: Deps, l: { id: string }, b: Record<string, any>) {
  const name = str(b.name, 'Navn', 60);
  if (!DATO.test(b.start) || !DATO.test(b.slut)) throw new ApiFejl('Vælg start- og slutdato.');
  const start_at = datoKl(b.start, 0);
  const end_at = datoKl(b.slut, 17);
  if (end_at <= start_at) throw new ApiFejl('Slutdatoen skal ligge efter startdatoen.');
  let code = '';
  for (let i = 0; i < 10 && !code; i++) {
    const c = tilfaeldigKode(6);
    if (!await d.store.gameByCode(c)) code = c;
  }
  const g: Game = {
    id: crypto.randomUUID(), owner_id: l.id, name, code, start_at, end_at, join_locked: false,
    finished_at: null, created_at: new Date(d.now() * 1000).toISOString(), ...tjekSatser(b),
  };
  await d.store.insertGame(g);
  return g;
}

async function retSpil(d: Deps, g: Game, b: Record<string, any>) {
  const patch: Partial<Game> = {};
  if (b.name !== undefined) patch.name = str(b.name, 'Navn', 60);
  if (b.join_locked !== undefined) patch.join_locked = !!b.join_locked;
  if (b.slut !== undefined) {
    if (g.finished_at) throw new ApiFejl('Spillet er afsluttet og kan ikke forlænges.');
    if (!DATO.test(b.slut)) throw new ApiFejl('Ugyldig slutdato.');
    patch.end_at = datoKl(b.slut, 17);
    if (patch.end_at <= g.start_at) throw new ApiFejl('Slutdatoen skal ligge efter startdatoen.');
    if (Date.parse(patch.end_at) / 1000 <= d.now()) throw new ApiFejl('Slutdatoen skal ligge i fremtiden. Brug "Afslut nu" for at stoppe spillet.');
  }
  if (b.satser !== undefined) {
    const ny = tjekSatser(b.satser, g);
    const aendret = (Object.keys(ny) as (keyof Satser)[]).some((n) => ny[n] !== g[n]);
    if (aendret && await d.store.hasOrders(g.id)) throw new ApiFejl('Satserne er låst, fordi der allerede er handlet i spillet.');
    if (ny.start_capital !== g.start_capital && (await d.store.players(g.id)).length) {
      throw new ApiFejl('Startkapitalen kan ikke ændres, når elever har meldt sig til.');
    }
    Object.assign(patch, ny);
  }
  await d.store.updateGame(g.id, patch);
  return d.store.game(g.id);
}

/** Køres hvert 5. minut: gennemfører ventende ordrer, afslutter spil, gemmer dagsværdier og justerer split. */
export async function planlaeg(d: Deps) {
  const log = { gennemfoert: 0, afvist: 0, venter: 0, fejl: 0, afsluttet: 0, dagsvaerdier: 0, split: 0 };
  const spil = new Map((await d.store.unfinishedGames()).map((g) => [g.id, g]));

  for (const o of await d.store.pendingOrders()) {
    const g = spil.get(o.game_id);
    if (!g) continue;
    try {
      const s = await gennemfoerVentende(d, g, o);
      if (s === 'executed') log.gennemfoert++; else if (s === 'rejected') log.afvist++; else log.venter++;
    } catch (e) {
      if (!(e instanceof KursFejl || e instanceof ApiFejl)) throw e;
      log.fejl++;
    }
  }

  const now = d.now();
  for (const g of spil.values()) {
    if (now >= Date.parse(g.end_at) / 1000) {
      await afslutSpil(d, g);
      log.afsluttet++;
    }
  }

  // Dagsværdier højst hver halve time.
  const sidst = Number(await d.store.stateGet('dagsvaerdier') ?? 0);
  if (now - sidst >= 1800) {
    for (const g of spil.values()) {
      if (now >= Date.parse(g.start_at) / 1000 && now < Date.parse(g.end_at) / 1000) {
        await gemDagsvaerdier(d, g);
        log.dagsvaerdier++;
      }
    }
    await d.store.stateSet('dagsvaerdier', String(now));
  }

  // Split én gang i døgnet.
  const idag = danskDato(now);
  if (await d.store.stateGet('split') !== idag) {
    const holdings = (await Promise.all([...spil.keys()].map((id) => d.store.holdingsForGame(id)))).flat();
    for (const symbol of new Set(holdings.map((h) => h.symbol))) {
      try {
        await justerSplit(d, symbol, holdings.filter((h) => h.symbol === symbol));
        log.split++;
      } catch (e) {
        if (!(e instanceof KursFejl)) throw e;
      }
    }
    await d.store.stateSet('split', idag);
  }
  return log;
}

export type { Order, Position };
