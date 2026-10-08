const krFmt = new Intl.NumberFormat('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctFmt = new Intl.NumberFormat('da-DK', { maximumFractionDigits: 2 });

/** 1234.5 → "1.234,50 kr." */
export function kr(x: number): string {
  return `${krFmt.format(x)} kr.`;
}

/** Tal med 2 decimaler, uden enhed. */
export function tal(x: number, decimals = 2): string {
  return new Intl.NumberFormat('da-DK', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(x);
}

/** 0.15 → "0,15 %" */
export function pct(x: number): string {
  return `${pctFmt.format(x)} %`;
}

const dagFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' });

/** Fx "mandag 12. oktober kl. 9:00" i dansk tid – eller "i dag kl. 15:30" / "i morgen kl. 9:00". */
export function tidspunkt(iso: string | number, nu: Date = new Date()): string {
  const d = typeof iso === 'number' ? new Date(iso * 1000) : new Date(iso);
  const imorgen = new Date(nu.getTime() + 86400000);
  const dato = dagFmt.format(d) === dagFmt.format(nu) ? 'i dag'
    : dagFmt.format(d) === dagFmt.format(imorgen) ? 'i morgen'
    : new Intl.DateTimeFormat('da-DK', {
      weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Copenhagen',
    }).format(d);
  const klok = new Intl.DateTimeFormat('da-DK', {
    hour: 'numeric', minute: '2-digit', timeZone: 'Europe/Copenhagen',
  }).format(d).replace('.', ':');
  return `${dato} kl. ${klok}`;
}
