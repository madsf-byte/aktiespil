// Handelsmotoren: det eneste sted kontanter og beholdninger ændres.
import type { Kurser } from './kurser.ts';
import {
  beregnHandel, efterKoeb, efterSalg, RESERVE_BUFFER, round2, tjekKoeb, tjekSalg,
} from './regler.ts';
import type { Aendring, Store } from './store.ts';
import { boersstatus, danskDato, kursErFrisk } from './tid.ts';
import { tidspunkt } from './format.ts';
import type { Game, Holding, Order, Player, Quote, Side, Snapshot } from './types.ts';
import { KursFejl } from './yahoo.ts';

export class ApiFejl extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface Motor {
  store: Store;
  kurser: Kurser;
  /** Nu, epoch sek. */
  now: () => number;
}

const iso = (sek: number) => new Date(sek * 1000).toISOString();
const sek = (s: string) => Date.parse(s) / 1000;

function tomBeholdning(p: Player, q: Quote, now: number): Holding {
  return {
    player_id: p.id, game_id: p.game_id, symbol: q.symbol, name: q.name, currency: q.currency,
    exchange: q.exchange, qty: 0, qty_reserved: 0, invested_dkk: 0, split_ts: Math.floor(now),
  };
}

function nyOrdre(p: Player, q: Quote, side: Side, qty: number, now: number): Order {
  return {
    id: crypto.randomUUID(), player_id: p.id, game_id: p.game_id, symbol: q.symbol, name: q.name,
    currency: q.currency, exchange: q.exchange, side, qty, status: 'pending', created_at: iso(now),
    earliest_at: null, executed_at: null, price: null, fx_rate: null, value_dkk: null, fee_dkk: null,
    fx_fee_dkk: null, total_dkk: null, reserved_dkk: 0, est_value_dkk: 0, reason: null,
  };
}

function ventendeKoeb(pending: Order[], symbol: string, undtagen?: string): number {
  return round2(pending
    .filter((o) => o.side === 'buy' && o.symbol === symbol && o.id !== undtagen)
    .reduce((s, o) => s + o.est_value_dkk, 0));
}

/** Beholdning med 0 aktier og intet reserveret slettes. */
function gemBeholdning(a: Aendring, h: Holding) {
  if (h.qty === 0 && h.qty_reserved === 0) a.holdings_delete.push(h.symbol);
  else a.holdings_upsert.push(h);
}

function tomAendring(p: Player): Aendring {
  return {
    player_id: p.id, expected_version: p.version, cash: p.cash,
    holdings_upsert: [], holdings_delete: [], orders_insert: [], orders_update: [],
  };
}

/** Kører `fn` med frisk spillerdata og gemmer; prøver igen hvis en anden ændring kom først. */
async function medSpiller<T>(
  m: Motor, playerId: string,
  fn: (p: Player, holdings: Holding[], pending: Order[]) => Promise<{ aendring: Aendring | null; svar: T }>,
): Promise<T> {
  for (let forsoeg = 0; forsoeg < 4; forsoeg++) {
    const p = await m.store.player(playerId);
    if (!p || p.removed) throw new ApiFejl('Spilleren findes ikke.', 404);
    const [holdings, orders] = await Promise.all([m.store.holdings(playerId), m.store.orders(playerId)]);
    const { aendring, svar } = await fn(p, holdings, orders.filter((o) => o.status === 'pending'));
    if (!aendring || await m.store.commit(aendring)) return svar;
  }
  throw new ApiFejl('Der skete for mange ting på én gang – prøv igen.', 409);
}

export function spilAktivt(g: Game, now: number): string | null {
  if (g.finished_at || now >= sek(g.end_at)) return 'Spillet er slut – der kan ikke længere handles.';
  if (now < sek(g.start_at)) return `Spillet er ikke begyndt endnu. Det starter ${tidspunkt(g.start_at)}.`;
  return null;
}

/** Lægger en ordre: gennemføres straks hvis børsen er åben, ellers venter den til åbning. */
export async function laegOrdre(
  m: Motor, game: Game, playerId: string, symbol: string, side: Side, qty: number,
): Promise<Order> {
  if (!Number.isInteger(qty) || qty < 1 || qty > 1_000_000) throw new ApiFejl('Antal skal være et helt tal over 0.');
  if (side !== 'buy' && side !== 'sell') throw new ApiFejl('Ukendt ordretype.');
  const lukket = spilAktivt(game, m.now());
  if (lukket) throw new ApiFejl(lukket);

  const q = await m.kurser.quote(symbol);
  const fx = await m.kurser.fx(q.currency);

  return medSpiller(m, playerId, async (p, holdings, pending) => {
    const now = m.now();
    const status = boersstatus(q, now);
    const h = holdings.find((x) => x.symbol === q.symbol) ?? tomBeholdning(p, q, now);
    const a = tomAendring(p);
    const o = nyOrdre(p, q, side, qty, now);
    const b = beregnHandel(game, side, qty, q.price, fx, q.currency);

    if (status.open) {
      if (!kursErFrisk(q, now)) {
        throw new ApiFejl('Der er ingen ny kurs på aktien lige nu – prøv igen senere.');
      }
      let ny: Holding;
      if (side === 'buy') {
        const fejl = tjekKoeb(game, { cash: p.cash, invested: h.invested_dkk, pendingEst: ventendeKoeb(pending, q.symbol) }, b.total);
        if (fejl) throw new ApiFejl(fejl);
        ny = efterKoeb(h, qty, b.total);
        a.cash = round2(p.cash - b.total);
      } else {
        const fejl = tjekSalg(h.qty - h.qty_reserved, qty, b.total);
        if (fejl) throw new ApiFejl(fejl);
        ny = efterSalg(h, qty);
        a.cash = round2(p.cash + b.total);
      }
      Object.assign(o, {
        status: 'executed', executed_at: iso(now), price: q.price, fx_rate: fx,
        value_dkk: b.valueDkk, fee_dkk: b.fee, fx_fee_dkk: b.fxFee, total_dkk: b.total,
      });
      gemBeholdning(a, ny);
    } else {
      if (!status.nextOpen) throw new ApiFejl('Børsens åbningstid kendes ikke – prøv igen senere.');
      if (status.nextOpen >= sek(game.end_at)) throw new ApiFejl('Børsen åbner først efter spillets afslutning.');
      o.earliest_at = iso(status.nextOpen);
      if (side === 'buy') {
        const reserve = round2(b.total * RESERVE_BUFFER);
        const fejl = tjekKoeb(game, { cash: p.cash, invested: h.invested_dkk, pendingEst: ventendeKoeb(pending, q.symbol) }, b.total, reserve);
        if (fejl) throw new ApiFejl(fejl);
        o.reserved_dkk = reserve;
        o.est_value_dkk = b.total;
        a.cash = round2(p.cash - reserve);
      } else {
        const fejl = tjekSalg(h.qty - h.qty_reserved, qty, b.total);
        if (fejl) throw new ApiFejl(fejl);
        gemBeholdning(a, { ...h, qty_reserved: h.qty_reserved + qty });
      }
    }
    a.orders_insert.push(o);
    return { aendring: a, svar: o };
  });
}

/** Ventende ordre afvises/annulleres: reserverede kontanter eller aktier frigives. */
function frigiv(p: Player, holdings: Holding[], o: Order, status: 'rejected' | 'cancelled', reason: string, now: number): Aendring {
  const a = tomAendring(p);
  if (o.side === 'buy') {
    a.cash = round2(p.cash + o.reserved_dkk);
  } else {
    const h = holdings.find((x) => x.symbol === o.symbol);
    if (h) gemBeholdning(a, { ...h, qty_reserved: Math.max(0, h.qty_reserved - o.qty) });
  }
  a.orders_update.push({ ...o, status, reason, executed_at: iso(now) });
  return a;
}

/** Forsøger at gennemføre en ventende ordre. Returnerer ordrens nye status. */
export async function gennemfoerVentende(m: Motor, game: Game, order: Order): Promise<Order['status']> {
  if (spilAktivt(game, m.now())) return 'pending';
  const q = await m.kurser.quote(order.symbol);
  const now = m.now();
  if (!boersstatus(q, now).open || q.time < q.sessionStart || q.time <= sek(order.created_at) || !kursErFrisk(q, now)) {
    return 'pending';
  }
  const fx = await m.kurser.fx(q.currency);

  return medSpiller(m, order.player_id, async (p, holdings, pending) => {
    const o = pending.find((x) => x.id === order.id);
    if (!o) return { aendring: null, svar: 'executed' as const }; // allerede behandlet
    const b = beregnHandel(game, o.side, o.qty, q.price, fx, q.currency);
    const h = holdings.find((x) => x.symbol === o.symbol) ?? tomBeholdning(p, q, now);
    let fejl: string | null;
    let ny: Holding;
    let cash: number;
    if (o.side === 'buy') {
      const st = { cash: round2(p.cash + o.reserved_dkk), invested: h.invested_dkk, pendingEst: ventendeKoeb(pending, o.symbol, o.id) };
      fejl = tjekKoeb(game, st, b.total);
      ny = efterKoeb(h, o.qty, b.total);
      cash = round2(st.cash - b.total);
    } else {
      const fri = { ...h, qty_reserved: Math.max(0, h.qty_reserved - o.qty) };
      fejl = tjekSalg(fri.qty - fri.qty_reserved, o.qty, b.total);
      ny = efterSalg(fri, o.qty);
      cash = round2(p.cash + b.total);
    }
    if (fejl) {
      return { aendring: frigiv(p, holdings, o, 'rejected', `Afvist ved børsåbning: ${fejl}`, now), svar: 'rejected' as const };
    }
    const a = tomAendring(p);
    a.cash = cash;
    gemBeholdning(a, ny);
    a.orders_update.push({
      ...o, status: 'executed', executed_at: iso(now), price: q.price, fx_rate: fx,
      value_dkk: b.valueDkk, fee_dkk: b.fee, fx_fee_dkk: b.fxFee, total_dkk: b.total,
    });
    return { aendring: a, svar: 'executed' as const };
  });
}

export async function annullerVentende(m: Motor, order: Order, reason: string): Promise<void> {
  await medSpiller(m, order.player_id, async (p, holdings, pending) => {
    const o = pending.find((x) => x.id === order.id);
    if (!o) return { aendring: null, svar: undefined };
    return { aendring: frigiv(p, holdings, o, 'cancelled', reason, m.now()), svar: undefined };
  });
}

export interface Position {
  holding: Holding;
  quote: Quote | null;
  /** Kurs i kr. */
  priceDkk: number | null;
  value: number;
  /** Gevinst/tab i kr. i forhold til investeret beløb. */
  gain: number;
}

export interface Vaerdi {
  cash: number;
  reserved: number;
  positions: Position[];
  total: number;
}

/** Værdisætter en spiller. Bruger kurser op til 10 min. gamle; kan en kurs ikke hentes, bruges købsprisen. */
export async function vaerdisaet(m: Motor, p: Player, holdings: Holding[], pending: Order[]): Promise<Vaerdi> {
  const positions = await Promise.all(holdings.filter((h) => h.qty > 0).map(async (h): Promise<Position> => {
    try {
      const q = await m.kurser.quote(h.symbol, 600, true);
      const priceDkk = q.price * await m.kurser.fx(q.currency, true);
      const value = round2(h.qty * priceDkk);
      return { holding: h, quote: q, priceDkk, value, gain: round2(value - h.invested_dkk) };
    } catch (e) {
      if (!(e instanceof KursFejl)) throw e;
      return { holding: h, quote: null, priceDkk: null, value: h.invested_dkk, gain: 0 };
    }
  }));
  const reserved = round2(pending.filter((o) => o.side === 'buy').reduce((s, o) => s + o.reserved_dkk, 0));
  const total = round2(p.cash + reserved + positions.reduce((s, x) => s + x.value, 0));
  return { cash: p.cash, reserved, positions, total };
}

export interface Placering {
  player: Player;
  value: number;
  returnPct: number;
}

/** Rangliste for et spil. Afsluttede spil bruger de frosne slutværdier. */
export async function rangliste(m: Motor, game: Game): Promise<Placering[]> {
  const [players, holdings, orders] = await Promise.all([
    m.store.players(game.id), m.store.holdingsForGame(game.id), m.store.ordersForGame(game.id),
  ]);
  const liste = await Promise.all(players.map(async (p) => {
    const value = game.finished_at && p.final_value !== null
      ? p.final_value
      : (await vaerdisaet(m, p, holdings.filter((h) => h.player_id === p.id),
        orders.filter((o) => o.player_id === p.id && o.status === 'pending'))).total;
    return { player: p, value, returnPct: round2(((value - game.start_capital) / game.start_capital) * 100) };
  }));
  return liste.sort((a, b) => b.value - a.value || a.player.nickname.localeCompare(b.player.nickname, 'da'));
}

/** Gemmer dagens værdi for alle spillere i spillet. */
export async function gemDagsvaerdier(m: Motor, game: Game, liste?: Placering[]): Promise<void> {
  const l = liste ?? await rangliste(m, game);
  const day = danskDato(m.now());
  const rows: Snapshot[] = l.map((x) => ({ player_id: x.player.id, day, value: x.value }));
  if (rows.length) await m.store.upsertSnapshots(rows);
}

/** Afslutter spillet: ventende ordrer annulleres og slutværdierne fryses. */
export async function afslutSpil(m: Motor, game: Game): Promise<void> {
  const ventende = (await m.store.ordersForGame(game.id)).filter((o) => o.status === 'pending');
  for (const o of ventende) await annullerVentende(m, o, 'Annulleret – spillet sluttede.');
  const liste = await rangliste(m, { ...game, finished_at: null });
  for (const x of liste) await m.store.updatePlayer(x.player.id, { final_value: x.value });
  await gemDagsvaerdier(m, game, liste);
  await m.store.updateGame(game.id, { finished_at: iso(m.now()) });
}

/** Justerer antal aktier efter aktiesplit siden købet. */
export async function justerSplit(m: Motor, symbol: string, holdings: Holding[]): Promise<void> {
  const splits = (await m.kurser.splits(symbol)).sort((a, b) => a.date - b.date);
  for (const h0 of holdings) {
    const nye = splits.filter((s) => s.date > h0.split_ts && s.numerator > 0 && s.denominator > 0);
    if (!nye.length) continue;
    const faktor = nye.reduce((f, s) => f * (s.numerator / s.denominator), 1);
    await medSpiller(m, h0.player_id, async (p, hs, pending) => {
      const h = hs.find((x) => x.symbol === symbol);
      if (!h || h.split_ts !== h0.split_ts) return { aendring: null, svar: undefined };
      const a = tomAendring(p);
      gemBeholdning(a, {
        ...h, qty: Math.floor(h.qty * faktor), qty_reserved: Math.floor(h.qty_reserved * faktor),
        split_ts: nye[nye.length - 1].date,
      });
      for (const o of pending.filter((x) => x.symbol === symbol && x.side === 'sell')) {
        a.orders_update.push({ ...o, qty: Math.max(1, Math.floor(o.qty * faktor)) });
      }
      return { aendring: a, svar: undefined };
    });
  }
}
