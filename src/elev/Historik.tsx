import { elevKald } from '../api.ts';
import { kr, tal, tidspunkt } from '../../supabase/functions/_shared/format.ts';
import type { Order } from '../typer.ts';
import { Indlaeser, useHent } from '../ui/faelles.tsx';

export function Historik() {
  const h = useHent(() => elevKald<Order[]>('historik'), []);
  return (
    <>
      <h1>Historik</h1>
      <Indlaeser h={h}>
        {() => {
          const liste = [...h.data!].sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));
          if (!liste.length) return <p class="svag">Du har ikke handlet endnu.</p>;
          return <section class="kort flad"><ul class="liste">{liste.map((o) => <li key={o.id}><OrdreLinje o={o} /></li>)}</ul></section>;
        }}
      </Indlaeser>
    </>
  );
}

const STATUS: Record<Order['status'], [string, string]> = {
  pending: ['Venter', 'venter'],
  executed: ['Gennemført', 'ok'],
  rejected: ['Afvist', 'afvist'],
  cancelled: ['Annulleret', 'afvist'],
};

export function OrdreLinje({ o }: { o: Order }) {
  const [label, cls] = STATUS[o.status];
  return (
    <div class="raekke" style={{ cursor: 'default', alignItems: 'flex-start' }}>
      <div class="min">
        <div class="navn">{o.side === 'buy' ? 'Køb' : 'Salg'} · {o.name}</div>
        <div class="svag lille tal">
          {o.qty} stk.
          {o.price !== null && ` × ${tal(o.price)} ${o.currency}`}
          {' · '}{o.status === 'pending' ? `lagt ${tidspunkt(o.created_at)}` : tidspunkt(o.executed_at ?? o.created_at)}
        </div>
        {o.status === 'executed' && (
          <div class="svag lille tal">
            Kurtage {kr(o.fee_dkk ?? 0)}{(o.fx_fee_dkk ?? 0) > 0 && ` · valutatillæg ${kr(o.fx_fee_dkk!)}`}
          </div>
        )}
        {o.status === 'pending' && (
          <div class="lille">Venter – gennemføres tidligst {o.earliest_at ? tidspunkt(o.earliest_at) : 'ved næste børsåbning'}. Kan ikke fortrydes.</div>
        )}
        {o.reason && <div class="lille ned">{o.reason}</div>}
      </div>
      <div class="vaerdi">
        <span class={`maerke ${cls}`}>{label}</span>
        {o.status === 'executed' && <div class="tal" style={{ marginTop: 4 }}>{o.side === 'buy' ? '−' : '+'}{kr(o.total_dkk ?? 0)}</div>}
        {o.status === 'pending' && o.side === 'buy' && <div class="svag lille tal" style={{ marginTop: 4 }}>{kr(o.reserved_dkk)} reserveret</div>}
      </div>
    </div>
  );
}
