// Børsens åbningstider ud fra kursleverandørens handelsperiode.
import type { Quote } from './types.ts';

/** En kurs må højst være så gammel (sek.) for at kunne bruges til handel, mens børsen er åben. */
export const MAX_KURS_ALDER = 30 * 60;

/** Forskydning fra UTC i sekunder for tidszonen på et givet tidspunkt. */
export function tzOffset(timezone: string, epochSec: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(epochSec * 1000));
  const v = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second')) / 1000;
  return asUtc - Math.floor(epochSec);
}

function ugedag(timezone: string, epochSec: number): number {
  const navn = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' })
    .format(new Date(epochSec * 1000));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(navn);
}

export interface Boersstatus {
  open: boolean;
  /** Næste åbning (epoch sek.), hvis lukket. Helligdage kendes ikke – derfor "tidligst". */
  nextOpen: number | null;
}

export function boersstatus(q: Pick<Quote, 'sessionStart' | 'sessionEnd' | 'timezone'>, now: number): Boersstatus {
  if (now >= q.sessionStart && now < q.sessionEnd) return { open: true, nextOpen: null };
  if (now < q.sessionStart) return { open: false, nextOpen: q.sessionStart };
  // Efter lukketid: næste hverdag på samme lokale klokkeslæt.
  const startOffset = tzOffset(q.timezone, q.sessionStart);
  for (let k = 1; k <= 7; k++) {
    let t = q.sessionStart + k * 86400;
    t += startOffset - tzOffset(q.timezone, t); // ret for sommertid/vintertid
    const d = ugedag(q.timezone, t);
    if (d >= 1 && d <= 5 && t > now) return { open: false, nextOpen: t };
  }
  return { open: false, nextOpen: null };
}

/** Kan kursen bruges til en handel nu? */
export function kursErFrisk(q: Quote, now: number): boolean {
  return now - q.time <= MAX_KURS_ALDER;
}

/** 17:00 dansk tid på datoen (YYYY-MM-DD) som ISO-tidspunkt. */
export function datoKl(dato: string, time = 17): string {
  const [y, m, d] = dato.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, time) / 1000;
  const off = tzOffset('Europe/Copenhagen', guess);
  return new Date((guess - off) * 1000).toISOString();
}

/** Dato (YYYY-MM-DD) i dansk tid. */
export function danskDato(iso: string | number): string {
  const d = typeof iso === 'number' ? new Date(iso * 1000) : new Date(iso);
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(d);
}
