import type { Satser } from '../../supabase/functions/_shared/types.ts';

export type SatserTekst = Record<keyof Satser, string>;

export const STANDARD: SatserTekst = {
  start_capital: '100000', max_pct: '20',
  fee_dk_pct: '0,1', fee_dk_min: '29', fee_int_pct: '0,15', fee_int_min: '49', fx_pct: '0,25',
};

export const fraSatser = (s: Satser): SatserTekst =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v).replace('.', ',')])) as SatserTekst;

/** "0,1" og "0.1" → 0.1; "100.000" og "100.000,50" → tusindtalsadskiller. */
export function tilTal(v: string): number {
  const s = v.trim().replace(/\s/g, '');
  if (s.includes(',')) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ''));
  return Number(s);
}

export const tilSatser = (s: SatserTekst): Satser =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, tilTal(v)])) as unknown as Satser;

const FELTER: [keyof Satser, string, string][] = [
  ['start_capital', 'Startkapital', 'kr.'],
  ['max_pct', 'Højst i én aktie', '% af startkapitalen'],
  ['fee_dk_pct', 'Kurtage, danske aktier', '%'],
  ['fee_dk_min', 'Mindst, danske aktier', 'kr.'],
  ['fee_int_pct', 'Kurtage, udenlandske aktier', '%'],
  ['fee_int_min', 'Mindst, udenlandske aktier', 'kr.'],
  ['fx_pct', 'Valutatillæg', '%'],
];

export function SatserFelter({ v, saet, laast = [] }: { v: SatserTekst; saet: (v: SatserTekst) => void; laast?: (keyof Satser)[] }) {
  return (
    <div class="felter">
      {FELTER.map(([k, navn, enhed]) => (
        <div key={k}>
          <label for={k}>{navn} <span class="svag" style={{ fontWeight: 400 }}>({enhed})</span></label>
          <input id={k} type="text" inputMode="decimal" value={v[k]} disabled={laast.includes(k)}
            onInput={(e) => saet({ ...v, [k]: e.currentTarget.value })} />
        </div>
      ))}
    </div>
  );
}
