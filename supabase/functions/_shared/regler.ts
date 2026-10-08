// Spillets regler som rene funktioner – bruges både i ordrebilledet og på serveren.
import type { Holding, Satser, Side } from './types.ts';
import { kr, pct } from './format.ts';

export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/** Danske aktier handles i DKK; alt andet regnes som udenlandsk. */
export function erDansk(currency: string): boolean {
  return currency === 'DKK';
}

/** Ventende købsordrer reserverer anslået pris + 10 % som buffer mod kursændringer. */
export const RESERVE_BUFFER = 1.1;

export interface Beregning {
  /** Antal × kurs i kr. */
  valueDkk: number;
  fee: number;
  fxFee: number;
  /** Køb: samlet pris. Salg: beløb der udbetales. */
  total: number;
}

export function beregnHandel(
  s: Satser, side: Side, qty: number, price: number, fxRate: number, currency: string,
): Beregning {
  const valueDkk = round2(qty * price * fxRate);
  const dansk = erDansk(currency);
  const p = dansk ? s.fee_dk_pct : s.fee_int_pct;
  const min = dansk ? s.fee_dk_min : s.fee_int_min;
  const fee = round2(Math.max(min, (valueDkk * p) / 100));
  const fxFee = dansk ? 0 : round2((valueDkk * s.fx_pct) / 100);
  const total = side === 'buy' ? round2(valueDkk + fee + fxFee) : round2(valueDkk - fee - fxFee);
  return { valueDkk, fee, fxFee, total };
}

/** Kort forklaring af kurtagen for en aktie i given valuta. */
export function kurtageTekst(s: Satser, currency: string): string {
  return erDansk(currency)
    ? `Kurtage ${pct(s.fee_dk_pct)}, mindst ${kr(s.fee_dk_min)}`
    : `Kurtage ${pct(s.fee_int_pct)}, mindst ${kr(s.fee_int_min)} + valutatillæg ${pct(s.fx_pct)}`;
}

/** Højst investeret beløb i én aktie. */
export function graense(s: Satser): number {
  return round2((s.start_capital * s.max_pct) / 100);
}

/** Hvor meget mere (inkl. kurtage) der må investeres i aktien. */
export function ledigGraense(s: Satser, invested: number, pendingEst: number): number {
  return Math.max(0, round2(graense(s) - invested - pendingEst));
}

export interface KoebStatus {
  /** Ledige kontanter. */
  cash: number;
  /** Allerede investeret i aktien (antal × gns. købspris inkl. kurtage). */
  invested: number;
  /** Anslået pris (inkl. kurtage) af andre ventende køb af samme aktie. */
  pendingEst: number;
}

/** Returnerer en fejltekst, eller null hvis købet er tilladt. */
/**
 * `pris` er hvad købet koster inkl. kurtage og valutatillæg – det tæller i grænsen pr. aktie.
 * `kontantKrav` er hvad der skal være på kontoen (større end prisen for ventende ordrer pga. buffer).
 */
export function tjekKoeb(s: Satser, st: KoebStatus, pris: number, kontantKrav = pris): string | null {
  if (kontantKrav > st.cash + 0.005) {
    return `Du har ikke nok kontanter. Handlen kræver ${kr(kontantKrav)}, og du har ${kr(st.cash)}.`;
  }
  if (st.invested + st.pendingEst + pris > graense(s) + 0.005) {
    return `Du må højst have ${kr(graense(s))} investeret i én aktie (${pct(s.max_pct)} af startkapitalen). ` +
      `Du kan købe for ${kr(ledigGraense(s, st.invested, st.pendingEst))} mere i denne aktie.`;
  }
  return null;
}

export function tjekSalg(available: number, qty: number, total: number): string | null {
  if (qty > available) {
    return available === 0
      ? 'Du ejer ingen ledige aktier i dette selskab.'
      : `Du kan højst sælge ${available} stk.`;
  }
  if (total <= 0) return 'Handlen er så lille, at kurtagen er større end salgsbeløbet.';
  return null;
}

/** Største antal der kan købes nu. `buffer` > 1 bruges til ventende ordrer. */
export function maxAntalKoeb(
  s: Satser, st: KoebStatus, price: number, fxRate: number, currency: string, buffer = 1,
): number {
  const ok = (q: number) => {
    const b = beregnHandel(s, 'buy', q, price, fxRate, currency);
    return tjekKoeb(s, st, b.total, round2(b.total * buffer)) === null;
  };
  let lo = 0;
  let hi = Math.max(0, Math.floor(st.cash / (price * fxRate)) + 1);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ok(mid)) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Beholdning efter et køb – `betalt` er inkl. kurtage og valutatillæg. */
export function efterKoeb(h: Holding, qty: number, betalt: number): Holding {
  return { ...h, qty: h.qty + qty, invested_dkk: round2(h.invested_dkk + betalt) };
}

/** Beholdning efter et salg – investeret beløb falder forholdsmæssigt (gns. købspris). */
export function efterSalg(h: Holding, qty: number): Holding {
  const rest = h.qty - qty;
  const invested = rest === 0 ? 0 : round2((h.invested_dkk * rest) / h.qty);
  return { ...h, qty: rest, invested_dkk: invested };
}
