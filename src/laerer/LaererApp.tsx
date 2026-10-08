import { useEffect, useState } from 'preact/hooks';
import { DEMO, Fejl, kald, supabase } from '../api.ts';
import { tidspunkt } from '../../supabase/functions/_shared/format.ts';
import { danskDato } from '../../supabase/functions/_shared/tid.ts';
import type { Game } from '../typer.ts';
import { Besked, Indlaeser, Logo, useHent } from '../ui/faelles.tsx';
import { SatserFelter, STANDARD, type SatserTekst, tilSatser } from './SatserFelter.tsx';
import { SpilSide } from './SpilSide.tsx';

/** Lærerens del: login med Google, og derefter spiloversigten. */
export function LaererApp({ spilId }: { spilId: string | null }) {
  const [session, setSession] = useState<'?' | 'ude' | 'inde'>('?');

  useEffect(() => {
    if (DEMO) { setSession(localStorage.getItem('aktiespil.demo-laerer') ? 'inde' : 'ude'); return; }
    let sb;
    try { sb = supabase(); } catch { setSession('ude'); return; }
    sb.auth.getSession().then(({ data }) => setSession(data.session ? 'inde' : 'ude'));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s ? 'inde' : 'ude'));
    return () => data.subscription.unsubscribe();
  }, []);

  async function logInd() {
    if (DEMO) { localStorage.setItem('aktiespil.demo-laerer', 'demo'); setSession('inde'); return; }
    await supabase().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}${location.pathname}#/laerer` },
    });
  }
  async function logUd() {
    if (DEMO) localStorage.removeItem('aktiespil.demo-laerer');
    else await supabase().auth.signOut();
    setSession('ude');
  }

  if (session === '?') return <div class="side"><p class="svag">Henter …</p></div>;
  if (session === 'ude') {
    return (
      <div class="side midt">
        <div class="kort" style={{ maxWidth: 420, width: '100%' }}>
          <Logo />
          <h1>Lærer</h1>
          <p>Log ind for at oprette spil og følge klassen.</p>
          <button class="knap primaer fuld" onClick={logInd}>Log ind med Google</button>
          <p class="svag lille">Er du elev? <a href="#/">Gå til elevsiden</a>.</p>
        </div>
      </div>
    );
  }
  return (
    <div class="side bred">
      <div class="top">
        <a href="#/laerer" style={{ textDecoration: 'none', color: 'inherit' }}><Logo /></a>
        <button class="linkknap" onClick={logUd}>Log ud</button>
      </div>
      {spilId ? <SpilSide id={spilId} /> : <Oversigt logUd={logUd} />}
    </div>
  );
}

function Oversigt({ logUd }: { logUd: () => void }) {
  const [n, setN] = useState(0);
  const spil = useHent(() => kald<Game[]>('mine-spil'), [n]);
  const [opret, setOpret] = useState(false);

  if (spil.fejl && !spil.data) {
    return (
      <Besked type="fejl">
        {spil.fejl.includes('logge ind som lærer') ? 'Din konto har ikke adgang som lærer.' : spil.fejl}{' '}
        <button class="linkknap" onClick={logUd}>Log ud</button>
      </Besked>
    );
  }
  return (
    <>
      <div class="top">
        <h1>Mine spil</h1>
        {!opret && <button class="knap primaer" onClick={() => setOpret(true)}>+ Nyt spil</button>}
      </div>
      {opret && <OpretSpil annuller={() => setOpret(false)} oprettet={(g) => { location.hash = `#/laerer/${g.id}`; setN((x) => x + 1); }} />}
      <Indlaeser h={spil}>
        {() => spil.data!.length === 0 && !opret
          ? <p class="svag">Du har ingen spil endnu. Opret det første.</p>
          : (
            <section class="kort flad">
              <ul class="liste">
                {spil.data!.map((g) => {
                  const slut = !!g.finished_at;
                  return (
                    <li key={g.id}>
                      <a class="raekke" href={`#/laerer/${g.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                        <div class="min">
                          <div class="navn">{g.name}</div>
                          <div class="svag lille">Kode {g.code} · {slut ? 'Afsluttet' : `slutter ${tidspunkt(g.end_at)}`}</div>
                        </div>
                        <span class={`maerke ${slut ? '' : 'ok'}`}>{slut ? 'Slut' : 'Aktivt'}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
      </Indlaeser>
    </>
  );
}

function plusMaaneder(m: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + m);
  return danskDato(d.toISOString());
}

function OpretSpil({ annuller, oprettet }: { annuller: () => void; oprettet: (g: Game) => void }) {
  const [name, setName] = useState('');
  const [start, setStart] = useState(danskDato(new Date().toISOString()));
  const [slut, setSlut] = useState(plusMaaneder(6));
  const [satser, setSatser] = useState<SatserTekst>(STANDARD);
  const [fejl, setFejl] = useState<string | null>(null);
  const [sender, setSender] = useState(false);

  async function send(e: Event) {
    e.preventDefault();
    setSender(true);
    setFejl(null);
    try {
      oprettet(await kald<Game>('opret-spil', { name, start, slut, ...tilSatser(satser) }));
    } catch (err) {
      setFejl(err instanceof Error ? err.message : 'Fejl');
    } finally {
      setSender(false);
    }
  }

  return (
    <form class="kort" onSubmit={send}>
      <h2>Nyt spil</h2>
      <label for="navn">Navn</label>
      <input id="navn" type="text" value={name} onInput={(e) => setName(e.currentTarget.value)} placeholder="Fx 10.A efterår 2026" required />
      <div class="felter">
        <div><label for="start">Startdato</label><input id="start" type="date" value={start} onInput={(e) => setStart(e.currentTarget.value)} required /></div>
        <div><label for="slut">Slutdato (kl. 17)</label><input id="slut" type="date" value={slut} onInput={(e) => setSlut(e.currentTarget.value)} required /></div>
      </div>
      <div class="knapper" style={{ marginTop: 8 }}>
        {[1, 3, 6, 12].map((m) => <button key={m} type="button" class="knap lille" style={{ flex: 'none' }} onClick={() => setSlut(plusMaaneder(m))}>{m} md.</button>)}
      </div>
      <SatserFelter v={satser} saet={setSatser} />
      {fejl && <Besked type="fejl">{fejl}</Besked>}
      <div class="knapper" style={{ marginTop: 16 }}>
        <button type="button" class="knap" onClick={annuller}>Annullér</button>
        <button class="knap primaer" disabled={sender}>Opret spil</button>
      </div>
    </form>
  );
}

export { Fejl };
