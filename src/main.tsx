import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { DEMO } from './api.ts';
import { ElevApp } from './elev/ElevApp.tsx';
import { LaererApp } from './laerer/LaererApp.tsx';
import './styles.css';

function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => setHash(location.hash);
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return hash;
}

/** #/ elev · #/k/KODE tilmelding med kode · #/laerer · #/laerer/<spil-id> */
/** Tilbage fra Google-login (?code=…): vis lærersiden, så login gøres færdigt. */
const efterLogin = () => new URLSearchParams(location.search).has('code');

function App() {
  const hash = useHash();
  const dele = efterLogin() ? ['laerer'] : hash.replace(/^#\/?/, '').split('/');
  return (
    <>
      {DEMO && <div class="demo-baand">Demo – kurserne er opdigtede, og alt gemmes kun i denne browser.</div>}
      {dele[0] === 'laerer'
        ? <LaererApp spilId={dele[1] || null} />
        : <ElevApp startKode={dele[0] === 'k' ? decodeURIComponent(dele[1] ?? '') : ''} />}
    </>
  );
}

render(<App />, document.getElementById('app')!);
