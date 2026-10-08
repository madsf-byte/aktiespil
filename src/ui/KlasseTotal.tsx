import { kr } from '../../supabase/functions/_shared/format.ts';
import { Udvikling } from './faelles.tsx';

/** Klassens samlede resultat øverst i ranglisten. */
export function KlasseTotal({ vaerdier, startCapital }: { vaerdier: number[]; startCapital: number }) {
  const n = vaerdier.length;
  if (n === 0) return null;
  const start = startCapital * n;
  const nu = vaerdier.reduce((s, v) => s + v, 0);
  const resultat = nu - start;
  const ord = resultat >= 0 ? 'overskud' : 'underskud';
  return (
    <section class="kort" aria-label="Klassens samlede resultat">
      <h2>Hele klassen</h2>
      <div class="svag lille">{n} elev{n === 1 ? '' : 'er'} · samlet {ord}</div>
      <div class="stor"><Udvikling kr={resultat} /></div>
      <Udvikling pct={(resultat / start) * 100} />
      <div class="noegletal">
        <div><span>Samlet startkapital</span><strong class="tal">{kr(start)}</strong></div>
        <div><span>Samlet værdi nu</span><strong class="tal">{kr(nu)}</strong></div>
        <div><span>Gennemsnitligt {ord} pr. elev</span><strong><Udvikling kr={resultat / n} /></strong></div>
      </div>
    </section>
  );
}
