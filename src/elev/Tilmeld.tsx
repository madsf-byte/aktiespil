import { useState } from 'preact/hooks';
import { gemElev, kald } from '../api.ts';
import { Besked, Logo } from '../ui/faelles.tsx';

/** Første skærm for elever: meld dig til med klassekode, eller log ind igen med PIN. */
export function Tilmeld({ startKode, onKlar }: { startKode: string; onKlar: () => void }) {
  const [tilstand, setTilstand] = useState<'ny' | 'igen'>('ny');
  const [code, setCode] = useState(startKode);
  const [nickname, setNickname] = useState('');
  const [pin, setPin] = useState('');
  const [nyPin, setNyPin] = useState<string | null>(null);
  const [fejl, setFejl] = useState<string | null>(null);
  const [sender, setSender] = useState(false);

  async function send(e: Event) {
    e.preventDefault();
    setFejl(null);
    setSender(true);
    try {
      if (tilstand === 'ny') {
        const r = await kald<{ token: string; pin: string }>('tilmeld', { code, nickname });
        gemElev({ token: r.token, code: code.toUpperCase(), nickname });
        setNyPin(r.pin);
      } else {
        const r = await kald<{ token: string }>('login', { code, nickname, pin });
        gemElev({ token: r.token, code: code.toUpperCase(), nickname });
        onKlar();
      }
    } catch (err) {
      setFejl(err instanceof Error ? err.message : 'Fejl');
    } finally {
      setSender(false);
    }
  }

  if (nyPin) {
    return (
      <div class="side midt">
        <div class="kort" style={{ maxWidth: 420, width: '100%' }}>
          <Logo />
          <h1>Velkommen, {nickname}!</h1>
          <p>Din personlige PIN er:</p>
          <div class="pin tal">{nyPin}</div>
          <Besked type="advarsel">
            <strong>Skriv den ned nu.</strong> Du skal bruge klassekode, kaldenavn og PIN, hvis du vil logge ind på en
            anden telefon eller computer. Har du glemt den, kan din lærer lave en ny.
          </Besked>
          <button class="knap primaer fuld" onClick={onKlar}>Jeg har skrevet den ned – start spillet</button>
        </div>
      </div>
    );
  }

  return (
    <div class="side midt">
      <form class="kort" style={{ maxWidth: 420, width: '100%' }} onSubmit={send}>
        <Logo />
        <div class="valg" role="group" aria-label="Vælg">
          <button type="button" aria-pressed={tilstand === 'ny'} onClick={() => setTilstand('ny')}>Ny i spillet</button>
          <button type="button" aria-pressed={tilstand === 'igen'} onClick={() => setTilstand('igen')}>Log ind igen</button>
        </div>
        <label for="kode">Klassekode</label>
        <input id="kode" type="text" autoComplete="off" autoCapitalize="characters" value={code}
          onInput={(e) => setCode(e.currentTarget.value)} placeholder="Fx K7QM4R" required />
        <label for="navn">Kaldenavn</label>
        <input id="navn" type="text" autoComplete="off" value={nickname} maxLength={20}
          onInput={(e) => setNickname(e.currentTarget.value)} placeholder="Det andre ser på ranglisten" required />
        {tilstand === 'ny' && <p class="svag lille">Brug ikke dit rigtige fulde navn. 2–20 tegn.</p>}
        {tilstand === 'igen' && (
          <>
            <label for="pin">PIN</label>
            <input id="pin" type="text" autoComplete="off" autoCapitalize="characters" value={pin}
              onInput={(e) => setPin(e.currentTarget.value)} required />
          </>
        )}
        {fejl && <Besked type="fejl">{fejl}</Besked>}
        <button class="knap primaer fuld" style={{ marginTop: 16 }} disabled={sender}>
          {tilstand === 'ny' ? 'Meld mig til' : 'Log ind'}
        </button>
      </form>
    </div>
  );
}
