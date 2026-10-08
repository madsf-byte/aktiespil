import { useState } from 'preact/hooks';
import { elevKald } from '../api.ts';
import { kr } from '../../supabase/functions/_shared/format.ts';
import type { RanglisteSvar, Spiller, Vaerdi } from '../typer.ts';
import { Indlaeser, Udvikling, useHent } from '../ui/faelles.tsx';
import { PositionsListe } from './ElevApp.tsx';

export function Rangliste({ mig, vaelgAktie }: { mig: string; vaelgAktie: (s: string) => void }) {
  const r = useHent(() => elevKald<RanglisteSvar>('rangliste'), []);
  const [valgt, setValgt] = useState<string | null>(null);

  if (valgt) return <AndenSpiller id={valgt} tilbage={() => setValgt(null)} vaelgAktie={vaelgAktie} />;

  return (
    <>
      <h1>Rangliste</h1>
      <Indlaeser h={r}>
        {() => (
          <>
            {r.data!.finished && <p><strong>🏆 Spillet er slut – her er den endelige stilling.</strong></p>}
            <section class="kort flad">
              <ul class="liste">
                {r.data!.rows.map((x, i) => (
                  <li key={x.id}>
                    <button class="raekke" onClick={() => setValgt(x.id)} style={x.id === mig ? { background: 'var(--info-bg)' } : undefined}>
                      <span class="plads">{i + 1}.</span>
                      <div class="min" style={{ flex: 1 }}>
                        <div class="navn">{x.nickname}{x.id === mig && ' (dig)'}</div>
                      </div>
                      <div class="vaerdi">
                        <div class="tal">{kr(x.value)}</div>
                        <div class="lille"><Udvikling pct={x.returnPct} /></div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <p class="svag lille">Tryk på en spiller for at se, hvilke aktier de ejer.</p>
          </>
        )}
      </Indlaeser>
    </>
  );
}

function AndenSpiller({ id, tilbage, vaelgAktie }: { id: string; tilbage: () => void; vaelgAktie: (s: string) => void }) {
  const s = useHent(() => elevKald<{ player: Spiller; vaerdi: Vaerdi }>('spiller', { id }), [id]);
  return (
    <>
      <button class="linkknap tilbage" onClick={tilbage}>‹ Rangliste</button>
      <Indlaeser h={s}>
        {() => {
          const v = s.data!.vaerdi;
          return (
            <>
              <h1>{s.data!.player.nickname}</h1>
              <section class="kort">
                <div class="svag lille">Samlet værdi</div>
                <div class="stor tal">{kr(v.total)}</div>
                <div class="noegletal"><div><span>Kontanter</span><strong class="tal">{kr(v.cash + v.reserved)}</strong></div></div>
              </section>
              {v.positions.length === 0
                ? <p class="svag">Ejer ingen aktier lige nu.</p>
                : <PositionsListe positions={v.positions} vaelg={vaelgAktie} />}
            </>
          );
        }}
      </Indlaeser>
    </>
  );
}
