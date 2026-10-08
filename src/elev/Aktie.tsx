import { useState } from 'preact/hooks';
import { elevKald } from '../api.ts';
import { kr, pct, tal, tidspunkt } from '../../supabase/functions/_shared/format.ts';
import {
  beregnHandel, erDansk, graense, ledigGraense, maxAntalKoeb, RESERVE_BUFFER, round2, tjekKoeb, tjekSalg,
} from '../../supabase/functions/_shared/regler.ts';
import type { ChartPoint, Side } from '../../supabase/functions/_shared/types.ts';
import type { AktieSvar, MigSvar, Order, SpilInfo } from '../typer.ts';
import { Besked, Indlaeser, Udvikling, useHent } from '../ui/faelles.tsx';
import { Graf } from '../ui/Graf.tsx';

type Range = '1mo' | '6mo' | '1y';

export function Aktie({ symbol, mig, tilbage, onHandel }: {
  symbol: string; mig: MigSvar; tilbage: () => void; onHandel: () => void;
}) {
  const [n, setN] = useState(0);
  const a = useHent(() => elevKald<AktieSvar>('aktie', { symbol }), [symbol, n]);
  const [range, setRange] = useState<Range>('6mo');
  const graf = useHent(() => elevKald<ChartPoint[]>('graf', { symbol, range }), [symbol, range]);
  const [side, setSide] = useState<Side | null>(null);
  const [kvittering, setKvittering] = useState<Order | null>(null);

  return (
    <>
      <button class="linkknap tilbage" onClick={tilbage}>‹ Tilbage</button>
      <Indlaeser h={a}>
        {() => {
          const { quote: q, status, holding } = a.data!;
          const udenlandsk = !erDansk(q.currency);
          const aendring = q.prevClose ? ((q.price - q.prevClose) / q.prevClose) * 100 : null;
          const ejer = holding?.qty ?? 0;
          return (
            <>
              <section class="kort">
                <h1 style={{ marginBottom: 2 }}>{q.name}</h1>
                <div class="svag lille">{q.symbol} · {q.exchange} · {q.currency}</div>
                <div style={{ marginTop: 12 }}>
                  <span class="stor tal">{tal(q.price)} {q.currency}</span>
                  {aendring !== null && <> <Udvikling pct={aendring} /> <span class="svag lille">i dag</span></>}
                </div>
                {udenlandsk && <div class="svag tal">= {kr(q.price * a.data!.fx)} (1 {q.currency} = {tal(a.data!.fx, 4)} kr.)</div>}
                <BoersBesked status={status} boers={q.exchange} />
                <div class="svag lille">Kurs fra {tidspunkt(q.time)} · forsinket ca. 15 min.</div>
              </section>

              <section class="kort">
                <div class="valg" role="group" aria-label="Periode" style={{ marginBottom: 8 }}>
                  {(['1mo', '6mo', '1y'] as Range[]).map((r) => (
                    <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
                      {r === '1mo' ? '1 md.' : r === '6mo' ? '6 md.' : '1 år'}
                    </button>
                  ))}
                </div>
                <Indlaeser h={graf}>{() => <Graf punkter={graf.data!.map((p) => p.close)} label={`Kursudvikling for ${q.name}`} />}</Indlaeser>
              </section>

              {kvittering && <Kvittering o={kvittering} />}

              <section class="kort">
                <p style={{ marginTop: 0 }}>
                  Du ejer <strong>{ejer} stk.</strong>
                  {holding && holding.qty_reserved > 0 && <> ({holding.qty_reserved} er sat til salg)</>}
                </p>
                {side === null
                  ? (
                    <div class="knapper">
                      <button class="knap koeb" onClick={() => { setSide('buy'); setKvittering(null); }}>Køb</button>
                      <button class="knap saelg" disabled={ejer - (holding?.qty_reserved ?? 0) <= 0} onClick={() => { setSide('sell'); setKvittering(null); }}>Sælg</button>
                    </div>
                  )
                  : (
                    <Ordre a={a.data!} game={mig.game} side={side} annuller={() => setSide(null)}
                      faerdig={(o) => { setKvittering(o); setSide(null); setN((x) => x + 1); onHandel(); }} />
                  )}
                <Satser game={mig.game} />
              </section>
            </>
          );
        }}
      </Indlaeser>
    </>
  );
}

function BoersBesked({ status, boers }: { status: AktieSvar['status']; boers: string }) {
  if (status.open) return <p class="status op" style={{ margin: '8px 0 4px' }}>Børsen er åben</p>;
  return (
    <Besked type="advarsel">
      <strong>{boers} er lukket.</strong>{' '}
      {status.nextOpen
        ? <>Den åbner {tidspunkt(status.nextOpen)}. Handler du nu, gennemføres handlen tidligst der.</>
        : <>Handler du nu, gennemføres handlen næste handelsdag.</>}
    </Besked>
  );
}

function Ordre({ a, game, side, annuller, faerdig }: {
  a: AktieSvar; game: SpilInfo; side: Side; annuller: () => void; faerdig: (o: Order) => void;
}) {
  const q = a.quote;
  const ventende = !a.status.open;
  const ledige = (a.holding?.qty ?? 0) - (a.holding?.qty_reserved ?? 0);
  const st = { cash: a.cash, invested: a.holding?.invested_dkk ?? 0, pendingEst: a.pendingEst };
  const maks = side === 'buy'
    ? maxAntalKoeb(game, st, q.price, a.fx, q.currency, ventende ? RESERVE_BUFFER : 1)
    : ledige;
  const [tekst, setTekst] = useState(String(Math.min(1, maks) || 1));
  const [fejl, setFejl] = useState<string | null>(null);
  const [sender, setSender] = useState(false);

  const qty = Number(tekst);
  const gyldigt = Number.isInteger(qty) && qty >= 1;
  const b = gyldigt ? beregnHandel(game, side, qty, q.price, a.fx, q.currency) : null;
  const reserve = b && ventende && side === 'buy' ? round2(b.total * RESERVE_BUFFER) : null;
  const regelfejl = !b ? 'Skriv et helt antal aktier.' : side === 'buy'
    ? tjekKoeb(game, st, b.total, reserve ?? b.total)
    : tjekSalg(ledige, qty, b.total);
  const udenlandsk = !erDansk(q.currency);

  async function bekraeft() {
    setSender(true);
    setFejl(null);
    try {
      faerdig(await elevKald<Order>('ordre', { symbol: q.symbol, side, qty }));
    } catch (e) {
      setFejl(e instanceof Error ? e.message : 'Fejl');
    } finally {
      setSender(false);
    }
  }

  const saet = (x: number) => setTekst(String(Math.max(1, x)));

  return (
    <div>
      <h2>{side === 'buy' ? 'Køb' : 'Sælg'} {q.name}</h2>
      <label for="antal">Antal aktier</label>
      <div class="antal">
        <button class="knap" type="button" aria-label="Én færre" onClick={() => saet((gyldigt ? qty : 1) - 1)}>−</button>
        <input id="antal" type="number" inputMode="numeric" min={1} step={1} value={tekst} onInput={(e) => setTekst(e.currentTarget.value)} />
        <button class="knap" type="button" aria-label="Én mere" onClick={() => saet((gyldigt ? qty : 0) + 1)}>+</button>
        <button class="knap lille" type="button" disabled={maks < 1} onClick={() => saet(maks)}>Maks. {maks}</button>
      </div>

      {b && (
        <table class="opgoerelse">
          <tbody>
            <tr><td>{qty} stk. × {tal(q.price)} {q.currency}</td><td>{udenlandsk ? `${tal(qty * q.price)} ${q.currency}` : kr(b.valueDkk)}</td></tr>
            {udenlandsk && <tr><td>Omregnet til kr. (1 {q.currency} = {tal(a.fx, 4)} kr.)</td><td>{kr(b.valueDkk)}</td></tr>}
            <tr>
              <td>Kurtage ({pct(udenlandsk ? game.fee_int_pct : game.fee_dk_pct)}, mindst {kr(udenlandsk ? game.fee_int_min : game.fee_dk_min)})</td>
              <td>{side === 'buy' ? '' : '− '}{kr(b.fee)}</td>
            </tr>
            {udenlandsk && <tr><td>Valutatillæg ({pct(game.fx_pct)})</td><td>{side === 'buy' ? '' : '− '}{kr(b.fxFee)}</td></tr>}
            <tr class="sum"><td>{side === 'buy' ? 'I alt' : 'Du får'}</td><td>{kr(b.total)}</td></tr>
          </tbody>
        </table>
      )}
      <p class="svag lille" style={{ marginTop: 0 }}>Kurs forsinket ca. 15 min. · Hentet {tidspunkt(a.now)}. Den endelige pris kan afvige lidt, hvis kursen ændrer sig.</p>

      {side === 'buy' && (
        <p class="lille">
          Du har {kr(a.cash)} i kontanter. Du må højst have {kr(graense(game))} investeret i én aktie
          ({pct(game.max_pct)} af startkapitalen) og kan købe for <strong>{kr(ledigGraense(game, st.invested, st.pendingEst))}</strong> mere i denne aktie.
        </p>
      )}

      {ventende && (
        <Besked type="advarsel">
          <strong>Børsen er lukket.</strong> Din ordre gennemføres{' '}
          {a.status.nextOpen ? <>tidligst <strong>{tidspunkt(a.status.nextOpen)}</strong></> : 'næste handelsdag'} til kursen på det tidspunkt.
          {reserve !== null && <> Vi reserverer {kr(reserve)} (prisen + 10 %), indtil ordren er gennemført.</>}
          {' '}<strong>Ordren kan ikke fortrydes.</strong>
        </Besked>
      )}

      {b && regelfejl && <Besked type="fejl">{regelfejl}</Besked>}
      {!b && <Besked type="fejl">{regelfejl}</Besked>}
      {fejl && <Besked type="fejl">{fejl}</Besked>}

      <div class="knapper" style={{ marginTop: 12 }}>
        <button class="knap" onClick={annuller} disabled={sender}>Annullér</button>
        <button class={`knap ${side === 'buy' ? 'koeb' : 'saelg'}`} disabled={!!regelfejl || sender || (!a.frisk && a.status.open)} onClick={bekraeft}>
          {sender ? 'Sender …' : ventende ? `Læg ${side === 'buy' ? 'købsordre' : 'salgsordre'}` : `Bekræft ${side === 'buy' ? 'køb' : 'salg'}`}
        </button>
      </div>
      {!a.frisk && a.status.open && <Besked type="advarsel">Der er ingen ny kurs på aktien lige nu – prøv igen senere.</Besked>}
    </div>
  );
}

function Kvittering({ o }: { o: Order }) {
  const ord = o.side === 'buy' ? 'Købt' : 'Solgt';
  if (o.status === 'pending') {
    return (
      <Besked type="advarsel">
        Din {o.side === 'buy' ? 'købsordre' : 'salgsordre'} på {o.qty} stk. venter. Den gennemføres tidligst {o.earliest_at ? tidspunkt(o.earliest_at) : 'ved næste børsåbning'}.
      </Besked>
    );
  }
  return <Besked type="ok">{ord} {o.qty} stk. for {kr(o.total_dkk ?? 0)} (inkl. kurtage).</Besked>;
}

/** "Sådan beregnes kurtage" – alle spillets satser. */
export function Satser({ game }: { game: SpilInfo }) {
  return (
    <details class="satser">
      <summary>Sådan beregnes kurtage</summary>
      <ul>
        <li><strong>Danske aktier</strong> (handles i kr.): {pct(game.fee_dk_pct)} af handlens værdi, dog mindst {kr(game.fee_dk_min)}.</li>
        <li><strong>Udenlandske aktier</strong>: {pct(game.fee_int_pct)} af handlens værdi, dog mindst {kr(game.fee_int_min)}.</li>
        <li><strong>Valutatillæg</strong> ved udenlandske aktier: {pct(game.fx_pct)} af handlens værdi – både ved køb og salg.</li>
        <li>Kurtage betales både når du køber, og når du sælger.</li>
        <li>Du må højst have {kr(graense(game))} ({pct(game.max_pct)} af startkapitalen) investeret i én aktie. Det tæller med, hvad du har betalt inkl. kurtage og valutatillæg.</li>
        <li>Udbytte medregnes ikke i spillet. Ved aktiesplit justeres antallet automatisk.</li>
      </ul>
    </details>
  );
}
