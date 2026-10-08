import { useEffect, useState } from 'preact/hooks';
import { elevKald } from '../api.ts';
import type { SearchHit } from '../../supabase/functions/_shared/types.ts';
import type { MigSvar } from '../typer.ts';
import { Besked } from '../ui/faelles.tsx';

const FORSLAG: [string, string][] = [
  ['NOVO-B.CO', 'Novo Nordisk'], ['MAERSK-B.CO', 'Mærsk'], ['CARL-B.CO', 'Carlsberg'], ['VWS.CO', 'Vestas'],
  ['DSV.CO', 'DSV'], ['ORSTED.CO', 'Ørsted'], ['AAPL', 'Apple'], ['NVDA', 'Nvidia'], ['TSLA', 'Tesla'],
  ['MSFT', 'Microsoft'], ['NKE', 'Nike'], ['SPOT', 'Spotify'],
];

export function Handl({ m, vaelg }: { m: MigSvar; vaelg: (s: string) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [fejl, setFejl] = useState<string | null>(null);

  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setHits(null); setFejl(null); return; }
    let aktiv = true;
    const t = setTimeout(() => {
      elevKald<SearchHit[]>('soeg', { q: s }).then(
        (h) => { if (aktiv) { setHits(h); setFejl(null); } },
        (e) => { if (aktiv) setFejl(e.message); },
      );
    }, 350);
    return () => { aktiv = false; clearTimeout(t); };
  }, [q]);

  return (
    <>
      <h1>Find en aktie</h1>
      <input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} autoFocus
        placeholder="Søg, fx novo eller apple" aria-label="Søg efter aktie" />
      <p class="svag lille">Du kan handle aktier på de fleste børser i verden. Kurserne er forsinket ca. 15 minutter.</p>
      {fejl && <Besked type="fejl">{fejl}</Besked>}
      {hits && hits.length === 0 && <p class="svag">Ingen aktier fundet. Prøv et andet navn.</p>}
      {hits && hits.length > 0 && (
        <section class="kort flad">
          <ul class="liste">
            {hits.map((h) => (
              <li key={h.symbol}>
                <button class="raekke" onClick={() => vaelg(h.symbol)}>
                  <div class="min"><div class="navn">{h.name}</div><div class="svag lille">{h.symbol} · {h.exchange}{h.type === 'ETF' && ' · Fond (ETF)'}</div></div>
                  <span aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!hits && (
        <>
          {m.vaerdi.positions.length > 0 && (
            <>
              <h2>Dine aktier</h2>
              <div class="knapper" style={{ marginBottom: 16 }}>
                {m.vaerdi.positions.map((p) => (
                  <button key={p.holding.symbol} class="knap lille" style={{ flex: 'none' }} onClick={() => vaelg(p.holding.symbol)}>{p.holding.name}</button>
                ))}
              </div>
            </>
          )}
          <h2>Kendte selskaber</h2>
          <div class="knapper">
            {FORSLAG.map(([s, n]) => (
              <button key={s} class="knap lille" style={{ flex: 'none' }} onClick={() => vaelg(s)}>{n}</button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
