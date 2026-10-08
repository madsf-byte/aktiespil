import { useEffect, useState } from 'preact/hooks';
import { elevKald, Fejl, gemElev, hentElev } from '../api.ts';
import { kr, tidspunkt } from '../../supabase/functions/_shared/format.ts';
import type { MigSvar, Position } from '../typer.ts';
import { Besked, Indlaeser, Udvikling, useHent } from '../ui/faelles.tsx';
import { Graf } from '../ui/Graf.tsx';
import { Aktie } from './Aktie.tsx';
import { Handl } from './Handl.tsx';
import { Historik } from './Historik.tsx';
import { Rangliste } from './Rangliste.tsx';
import { Tilmeld } from './Tilmeld.tsx';

type Fane = 'portefolje' | 'handl' | 'rangliste' | 'historik';

const IKONER: Record<Fane, string> = {
  portefolje: 'M4 19V5M4 19h16M8 15l4-4 3 3 5-6',
  handl: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  rangliste: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4',
  historik: 'M12 7v5l3 2M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
};
const NAVNE: Record<Fane, string> = { portefolje: 'Portefølje', handl: 'Handl', rangliste: 'Rangliste', historik: 'Historik' };

export function ElevApp({ startKode }: { startKode: string }) {
  const [login, setLogin] = useState(hentElev());
  // Et link med en anden klassekode end den gemte → vis tilmelding.
  const andetSpil = startKode && login && startKode.toUpperCase() !== login.code;
  if (!login || andetSpil) return <Tilmeld startKode={startKode || login?.code || ''} onKlar={() => { setLogin(hentElev()); location.hash = '#/'; }} />;
  return <Spil key={login.token} logUd={() => { gemElev(null); setLogin(null); }} />;
}

function Spil({ logUd }: { logUd: () => void }) {
  const [fane, setFane] = useState<Fane>('portefolje');
  const [aktie, setAktie] = useState<string | null>(null);
  const [opdater, setOpdater] = useState(0);
  const udlogget = (e: Fejl) => { if (e.status === 401) logUd(); };
  const mig = useHent(() => elevKald<MigSvar>('mig'), [opdater], udlogget);

  // Opdatér værdier hvert minut, mens appen er åben.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') setOpdater((x) => x + 1); }, 60_000);
    return () => clearInterval(t);
  }, []);

  const vaelgFane = (f: Fane) => { setAktie(null); setFane(f); setOpdater((x) => x + 1); window.scrollTo(0, 0); };

  return (
    <>
      <div class="side">
        <div class="top">
          <div>
            <div class="titel">{mig.data?.game.name ?? 'Aktiespillet'}</div>
            <div class="svag lille">{mig.data?.player.nickname}</div>
          </div>
          <button class="linkknap lille" onClick={() => { if (confirm('Log ud? Du skal bruge din PIN for at komme ind igen.')) logUd(); }}>Log ud</button>
        </div>
        <Indlaeser h={mig}>
          {() => {
            const m = mig.data!;
            if (aktie) {
              return <Aktie symbol={aktie} mig={m} tilbage={() => setAktie(null)} onHandel={() => setOpdater((x) => x + 1)} />;
            }
            return (
              <>
                <SpilStatus m={m} />
                {fane === 'portefolje' && <Portefolje m={m} vaelg={setAktie} />}
                {fane === 'handl' && <Handl m={m} vaelg={setAktie} />}
                {fane === 'rangliste' && <Rangliste mig={m.player.id} vaelgAktie={setAktie} />}
                {fane === 'historik' && <Historik />}
              </>
            );
          }}
        </Indlaeser>
      </div>
      <nav class="faner" aria-label="Faner">
        {(Object.keys(NAVNE) as Fane[]).map((f) => (
          <button key={f} aria-current={fane === f && !aktie ? 'page' : undefined} onClick={() => vaelgFane(f)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={IKONER[f]} /></svg>
            {NAVNE[f]}
          </button>
        ))}
      </nav>
    </>
  );
}

function SpilStatus({ m }: { m: MigSvar }) {
  const now = Date.now();
  if (m.game.finished_at || now >= Date.parse(m.game.end_at)) {
    return <Besked type="info"><strong>Spillet er slut.</strong> Se den endelige rangliste under Rangliste.</Besked>;
  }
  if (now < Date.parse(m.game.start_at)) {
    return <Besked type="advarsel">Spillet starter {tidspunkt(m.game.start_at)}. Indtil da kan du kigge på aktier.</Besked>;
  }
  return null;
}

function Portefolje({ m, vaelg }: { m: MigSvar; vaelg: (s: string) => void }) {
  const v = m.vaerdi;
  const start = m.game.start_capital;
  const afkast = v.total - start;
  const punkter = [start, ...m.snapshots.map((s) => s.value)];
  if (m.snapshots.at(-1)?.value !== v.total) punkter.push(v.total);
  return (
    <>
      <section class="kort">
        <div class="svag lille">Samlet værdi</div>
        <div class="stor tal">{kr(v.total)}</div>
        <Udvikling kr={afkast} pct={(afkast / start) * 100} />
        <div class="noegletal">
          <div><span>Kontanter</span><strong class="tal">{kr(v.cash)}</strong></div>
          <div><span>Aktier</span><strong class="tal">{kr(v.positions.reduce((s, p) => s + p.value, 0))}</strong></div>
          {v.reserved > 0 && <div><span>Reserveret til ventende køb</span><strong class="tal">{kr(v.reserved)}</strong></div>}
        </div>
        {m.snapshots.length >= 2
          ? <div style={{ marginTop: 12 }}><Graf punkter={punkter} label="Porteføljens værdi dag for dag" /></div>
          : <p class="svag lille">Grafen over din værdi kommer, når spillet har kørt et par dage.</p>}
        <p class="svag lille" style={{ margin: 0 }}>Spillet slutter {tidspunkt(m.game.end_at)}.</p>
      </section>

      {m.pending.length > 0 && (
        <Besked type="advarsel">Du har {m.pending.length} ventende ordre{m.pending.length > 1 ? 'r' : ''}. Se dem under Historik.</Besked>
      )}

      <h2>Mine aktier</h2>
      {v.positions.length === 0
        ? <section class="kort"><p class="svag" style={{ margin: 0 }}>Du ejer ingen aktier endnu. Gå til <strong>Handl</strong> for at finde en aktie.</p></section>
        : <PositionsListe positions={v.positions} vaelg={vaelg} />}
    </>
  );
}

export function PositionsListe({ positions, vaelg }: { positions: Position[]; vaelg?: (s: string) => void }) {
  return (
    <section class="kort flad">
      <ul class="liste">
        {positions.map((p) => {
          const indhold = (
            <>
              <div class="min">
                <div class="navn">{p.holding.name}</div>
                <div class="svag lille tal">
                  {p.holding.qty} stk.{p.priceDkk !== null && ` · ${kr(p.priceDkk)}`}
                  {p.holding.qty_reserved > 0 && ` · ${p.holding.qty_reserved} til salg`}
                </div>
              </div>
              <div class="vaerdi">
                <div class="tal">{kr(p.value)}</div>
                <div class="lille"><Udvikling kr={p.gain} /></div>
              </div>
            </>
          );
          return (
            <li key={p.holding.symbol}>
              {vaelg
                ? <button class="raekke" onClick={() => vaelg(p.holding.symbol)}>{indhold}</button>
                : <div class="raekke" style={{ cursor: 'default' }}>{indhold}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
