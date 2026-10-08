import { useState } from 'preact/hooks';
import { kald } from '../api.ts';
import { tidspunkt } from '../../supabase/functions/_shared/format.ts';
import type { Teacher } from '../../supabase/functions/_shared/types.ts';
import { Besked, Indlaeser, useHent } from '../ui/faelles.tsx';

/** Kun for administratorer: hvem må oprette spil. */
export function Laerere({ mig }: { mig: string }) {
  const liste = useHent(() => kald<Teacher[]>('laerere'), []);
  const [rows, setRows] = useState<Teacher[] | null>(null);
  const [email, setEmail] = useState('');
  const [fejl, setFejl] = useState<string | null>(null);
  const vis = rows ?? liste.data;

  async function tilfoej(e: Event) {
    e.preventDefault();
    setFejl(null);
    try {
      setRows(await kald<Teacher[]>('tilfoej-laerer', { email }));
      setEmail('');
    } catch (err) {
      setFejl((err as Error).message);
    }
  }
  async function fjern(t: Teacher) {
    if (!confirm(`Fjern ${t.email} som lærer? Læreren kan ikke længere logge ind. Spillene bliver liggende.`)) return;
    try { setRows(await kald<Teacher[]>('fjern-laerer', { email: t.email })); } catch (err) { setFejl((err as Error).message); }
  }

  return (
    <>
      <a href="#/laerer" class="tilbage" style={{ display: 'inline-block' }}>‹ Mine spil</a>
      <h1>Lærere</h1>
      <p class="svag">Lærere på listen kan logge ind med Google og oprette deres egne spil. De ser kun deres egne spil og elever.</p>
      <form class="kort" onSubmit={tilfoej}>
        <label for="mail" style={{ marginTop: 0 }}>Tilføj lærer (Google-mail)</label>
        <div class="knapper">
          <input id="mail" type="text" inputMode="email" autoComplete="off" value={email}
            onInput={(e) => setEmail(e.currentTarget.value)} placeholder="kollega@naae.dk" style={{ flex: 3 }} required />
          <button class="knap primaer">Tilføj</button>
        </div>
        {fejl && <Besked type="fejl">{fejl}</Besked>}
      </form>
      <section class="kort flad">
        <ul class="liste">
          <li><div class="raekke" style={{ cursor: 'default' }}><div class="min"><div class="navn">{mig}</div><div class="svag lille">Administrator</div></div></div></li>
          <Indlaeser h={liste}>
            {() => vis!.map((t) => (
              <li key={t.email}>
                <div class="raekke" style={{ cursor: 'default' }}>
                  <div class="min"><div class="navn">{t.email}</div><div class="svag lille">Tilføjet {tidspunkt(t.created_at)} af {t.added_by}</div></div>
                  <button class="knap lille fare" onClick={() => fjern(t)}>Fjern</button>
                </div>
              </li>
            ))}
          </Indlaeser>
        </ul>
      </section>
    </>
  );
}
