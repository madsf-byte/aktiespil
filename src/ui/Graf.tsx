// Enkel linjegraf i SVG – grøn hvis den slutter over start, ellers rød.
import { tal } from '../../supabase/functions/_shared/format.ts';

export function Graf({ punkter, lille = false, label }: { punkter: number[]; lille?: boolean; label: string }) {
  if (punkter.length < 2) return <p class="svag lille">Grafen kommer, når der er data for mere end én dag.</p>;
  const B = 600;
  const H = lille ? 110 : 160;
  const PAD = 6;
  const min = Math.min(...punkter);
  const max = Math.max(...punkter);
  const span = max - min || 1;
  const xy = punkter.map((v, i) => [
    (i / (punkter.length - 1)) * B,
    PAD + (1 - (v - min) / span) * (H - 2 * PAD),
  ]);
  const linje = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const op = punkter[punkter.length - 1] >= punkter[0];
  const farve = op ? 'var(--op)' : 'var(--ned)';
  return (
    <figure style={{ margin: 0 }}>
      <svg class={`graf${lille ? ' lille' : ''}`} viewBox={`0 0 ${B} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <polygon points={`0,${H} ${linje} ${B},${H}`} fill={farve} opacity="0.1" />
        <polyline points={linje} fill="none" stroke={farve} stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" />
      </svg>
      <figcaption class="svag lille" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Laveste {tal(min)}</span><span>Højeste {tal(max)}</span>
      </figcaption>
    </figure>
  );
}
