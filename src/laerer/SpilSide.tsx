import QRCode from 'qrcode';
import { useEffect, useState } from 'preact/hooks';
import { kald } from '../api.ts';
import { kr, tidspunkt } from '../../supabase/functions/_shared/format.ts';
import { danskDato } from '../../supabase/functions/_shared/tid.ts';
import type { Satser } from '../../supabase/functions/_shared/types.ts';
import { OrdreLinje } from '../elev/Historik.tsx';
import { PositionsListe } from '../elev/ElevApp.tsx';
import type { Game, LaererRaekke, SpilSvar } from '../typer.ts';
import { Besked, Indlaeser, Udvikling, useHent } from '../ui/faelles.tsx';
import { KlasseTotal } from '../ui/KlasseTotal.tsx';
import { fraSatser, SatserFelter, tilSatser } from './SatserFelter.tsx';

export function SpilSide({ id }: { id: string }) {
  const [n, setN] = useState(0);
  const s = useHent(() => kald<SpilSvar>('spil', { id }), [id, n]);
  const opdater = () => setN((x) => x + 1);
  return (
    <>
      <a href="#/laerer" class="tilbage" style={{ display: 'inline-block' }}>‹ Mine spil</a>
      <Indlaeser h={s}>
        {() => (
          <>
            <Hoved g={s.data!.game} antal={s.data!.rows.length} />
            <div class="to-kol">
              <Elever rows={s.data!.rows} game={s.data!.game} opdater={opdater} />
              <Indstillinger g={s.data!.game} hasOrders={s.data!.hasOrders} antal={s.data!.rows.length} opdater={opdater} />
            </div>
          </>
        )}
      </Indlaeser>
    </>
  );
}

function Hoved({ g, antal }: { g: Game; antal: number }) {
  const link = `${location.origin}${location.pathname}#/k/${g.code}`;
  const [qr, setQr] = useState('');
  const [kopieret, setKopieret] = useState(false);
  useEffect(() => { QRCode.toString(link, { type: 'svg', margin: 1 }).then(setQr); }, [link]);
  const slut = !!g.finished_at;
  return (
    <section class="kort">
      <div class="spil-hoved">
        <div>
          <h1>{g.name}</h1>
          <p class="svag" style={{ margin: '0 0 8px' }}>
            {slut ? `Afsluttet ${tidspunkt(g.finished_at!)}` : `${tidspunkt(g.start_at).replace(' kl. 0:00', '')} – ${tidspunkt(g.end_at)}`}
            {' · '}{antal} elev{antal === 1 ? '' : 'er'}
          </p>
          <div class="svag lille">Klassekode</div>
          <div class="kode">{g.code}</div>
          <p class="lille" style={{ wordBreak: 'break-all' }}>
            Eleverne går ind på <a href={link} target="_blank" rel="noopener">{link}</a>{' '}
            <button class="linkknap" onClick={() => { void navigator.clipboard?.writeText(link); setKopieret(true); }}>{kopieret ? 'Kopieret ✓' : 'Kopiér link'}</button>
          </p>
          {g.join_locked && <span class="maerke venter">Tilmelding lukket</span>}
        </div>
        {!slut && <div class="qr" aria-label="QR-kode til tilmelding" dangerouslySetInnerHTML={{ __html: qr }} />}
      </div>
    </section>
  );
}

function Elever({ rows, game, opdater }: { rows: LaererRaekke[]; game: Game; opdater: () => void }) {
  const [aaben, setAaben] = useState<string | null>(null);
  return (
    <section>
      <h2>Rangliste og elever</h2>
      <KlasseTotal vaerdier={rows.map((r) => r.value)} startCapital={game.start_capital} />
      {rows.length === 0 && <p class="svag">Ingen elever endnu. Vis klassekoden eller QR-koden for klassen.</p>}
      {rows.length > 0 && (
        <section class="kort flad">
          <ul class="liste">
            {rows.map((r, i) => (
              <li key={r.id}>
                <button class="raekke" aria-expanded={aaben === r.id} onClick={() => setAaben(aaben === r.id ? null : r.id)}>
                  <span class="plads">{i + 1}.</span>
                  <div class="min" style={{ flex: 1 }}>
                    <div class="navn">{r.nickname}</div>
                    <div class="svag lille">{r.orders.filter((o) => o.status === 'executed').length} handler</div>
                  </div>
                  <div class="vaerdi"><div class="tal">{kr(r.value)}</div><div class="lille"><Udvikling pct={r.returnPct} /></div></div>
                </button>
                {aaben === r.id && <EleveDetaljer r={r} game={game} opdater={opdater} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function EleveDetaljer({ r, game, opdater }: { r: LaererRaekke; game: Game; opdater: () => void }) {
  const [pin, setPin] = useState<string | null>(null);
  const [fejl, setFejl] = useState<string | null>(null);

  async function nulstil() {
    if (!confirm(`Lav en ny PIN til ${r.nickname}? Den gamle holder op med at virke, og eleven bliver logget ud.`)) return;
    try { setPin((await kald<{ pin: string }>('nulstil-pin', { playerId: r.id })).pin); } catch (e) { setFejl((e as Error).message); }
  }
  async function fjern() {
    if (!confirm(`Fjern ${r.nickname} fra spillet? Eleven forsvinder fra ranglisten og kan ikke længere logge ind.`)) return;
    try { await kald('fjern-spiller', { playerId: r.id }); opdater(); } catch (e) { setFejl((e as Error).message); }
  }

  return (
    <div style={{ padding: '0 16px 16px' }}>
      <div class="noegletal" style={{ marginTop: 0 }}>
        <div><span>Kontanter</span><strong class="tal">{kr(r.cash)}</strong></div>
        {r.reserved > 0 && <div><span>Reserveret</span><strong class="tal">{kr(r.reserved)}</strong></div>}
        <div><span>Tilmeldt</span><strong>{tidspunkt(r.created_at)}</strong></div>
      </div>
      <h3 style={{ marginTop: 16 }}>Beholdning</h3>
      {r.positions.length ? <PositionsListe positions={r.positions} /> : <p class="svag lille">Ingen aktier.</p>}
      <h3>Handler</h3>
      {r.orders.length
        ? <section class="kort flad" style={{ maxHeight: 360, overflowY: 'auto' }}><ul class="liste">{r.orders.map((o) => <li key={o.id}><OrdreLinje o={o} /></li>)}</ul></section>
        : <p class="svag lille">Ingen handler endnu.</p>}
      {pin && <Besked type="ok">Ny PIN til {r.nickname}: <strong class="tal" style={{ fontSize: '1.3rem', letterSpacing: '0.1em' }}>{pin}</strong></Besked>}
      {fejl && <Besked type="fejl">{fejl}</Besked>}
      {!game.finished_at && (
        <div class="knapper">
          <button class="knap lille" onClick={nulstil}>Ny PIN</button>
          <button class="knap lille fare" onClick={fjern}>Fjern elev</button>
        </div>
      )}
    </div>
  );
}

function Indstillinger({ g, hasOrders, antal, opdater }: { g: Game; hasOrders: boolean; antal: number; opdater: () => void }) {
  const [name, setName] = useState(g.name);
  const [slut, setSlut] = useState(danskDato(g.end_at));
  const [satser, setSatser] = useState(fraSatser({
    start_capital: g.start_capital, max_pct: g.max_pct, fee_dk_pct: g.fee_dk_pct, fee_dk_min: g.fee_dk_min,
    fee_int_pct: g.fee_int_pct, fee_int_min: g.fee_int_min, fx_pct: g.fx_pct,
  }));
  const [besked, setBesked] = useState<{ type: 'ok' | 'fejl'; tekst: string } | null>(null);

  async function ret(data: Record<string, unknown>, ok: string) {
    setBesked(null);
    try {
      await kald('ret-spil', { id: g.id, ...data });
      setBesked({ type: 'ok', tekst: ok });
      opdater();
    } catch (e) {
      setBesked({ type: 'fejl', tekst: (e as Error).message });
    }
  }
  async function afslut() {
    if (!confirm('Afslut spillet nu? Ventende ordrer annulleres, og ranglisten fryses. Det kan ikke fortrydes.')) return;
    try { await kald('afslut-spil', { id: g.id }); opdater(); } catch (e) { setBesked({ type: 'fejl', tekst: (e as Error).message }); }
  }

  if (g.finished_at) {
    return <section class="kort"><h2>Spillet er afsluttet</h2><p class="svag" style={{ margin: 0 }}>Ranglisten er frosset. Eleverne kan stadig se deres resultater.</p></section>;
  }
  const laast: (keyof Satser)[] = hasOrders
    ? ['start_capital', 'max_pct', 'fee_dk_pct', 'fee_dk_min', 'fee_int_pct', 'fee_int_min', 'fx_pct']
    : antal > 0 ? ['start_capital'] : [];

  return (
    <section>
      <h2>Indstillinger</h2>
      <div class="kort">
        {besked && <Besked type={besked.type}>{besked.tekst}</Besked>}
        <label for="t">Tilmelding</label>
        <div class="knapper">
          <button class="knap" onClick={() => ret({ join_locked: !g.join_locked }, g.join_locked ? 'Tilmeldingen er åbnet.' : 'Tilmeldingen er lukket.')}>
            {g.join_locked ? 'Åbn for tilmelding' : 'Luk for tilmelding'}
          </button>
        </div>
        <p class="svag lille">Luk, når hele klassen er med, så andre ikke kan komme ind med koden.</p>

        <label for="nav">Navn</label>
        <input id="nav" type="text" value={name} onInput={(e) => setName(e.currentTarget.value)} />
        <label for="slut">Slutdato (kl. 17)</label>
        <input id="slut" type="date" value={slut} onInput={(e) => setSlut(e.currentTarget.value)} />
        <button class="knap primaer" style={{ marginTop: 12 }} onClick={() => ret({ name, slut }, 'Gemt.')}>Gem navn og slutdato</button>
      </div>

      <div class="kort">
        <h3>Startkapital, grænse og kurtage</h3>
        {hasOrders
          ? <p class="svag lille">Satserne er låst, fordi der er handlet i spillet. Det er for at gøre det fair for alle.</p>
          : antal > 0 && <p class="svag lille">Startkapitalen er låst, fordi elever har meldt sig til.</p>}
        <SatserFelter v={satser} saet={setSatser} laast={laast} />
        {!hasOrders && <button class="knap primaer" style={{ marginTop: 12 }} onClick={() => ret({ satser: tilSatser(satser) }, 'Satserne er gemt.')}>Gem satser</button>}
      </div>

      <div class="kort">
        <h3>Afslut spillet</h3>
        <p class="svag lille">Stopper al handel nu, annullerer ventende ordrer og fryser ranglisten.</p>
        <button class="knap fare" onClick={afslut}>Afslut nu</button>
      </div>
    </section>
  );
}
