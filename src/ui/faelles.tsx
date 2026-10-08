import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { Fejl } from '../api.ts';
import { kr, tal } from '../../supabase/functions/_shared/format.ts';

export function Logo() {
  return (
    <div class="logo">
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <rect width="48" height="48" rx="12" fill="#1d5fa8" />
        <polyline points="9,33 19,23 26,29 39,14" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" />
        <polyline points="31,14 39,14 39,22" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      Aktiespillet
    </div>
  );
}

export function Besked({ type = 'info', children }: { type?: 'fejl' | 'advarsel' | 'info' | 'ok'; children: ComponentChildren }) {
  return <div class={`besked ${type}`} role={type === 'fejl' ? 'alert' : undefined}>{children}</div>;
}

/** Fortegn + farve for gevinst/tab. */
export function Udvikling({ kr: beloeb, pct }: { kr?: number; pct?: number }) {
  const v = beloeb ?? pct ?? 0;
  const cls = v > 0.004 ? 'op' : v < -0.004 ? 'ned' : 'svag';
  const fortegn = v > 0.004 ? '+' : v < -0.004 ? '−' : '';
  const k = beloeb !== undefined ? `${fortegn}${kr(Math.abs(beloeb))}` : '';
  const p = pct !== undefined ? `${fortegn}${tal(Math.abs(pct))} %` : '';
  return <span class={`${cls} tal`}>{k && p ? `${k} (${p})` : k || p}</span>;
}

export interface Hentning<T> { data: T | null; fejl: string | null; henter: boolean; genindlaes: () => void }

/** Henter data og giver fejl/indlæsning; genhenter når `deps` ændres. */
export function useHent<T>(hent: () => Promise<T>, deps: unknown[], onFejl?: (e: Fejl) => void): Hentning<T> {
  const [data, setData] = useState<T | null>(null);
  const [fejl, setFejl] = useState<string | null>(null);
  const [henter, setHenter] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let aktiv = true;
    setHenter(true);
    hent().then(
      (d) => { if (aktiv) { setData(d); setFejl(null); setHenter(false); } },
      (e) => {
        if (!aktiv) return;
        setFejl(e instanceof Error ? e.message : 'Fejl');
        setHenter(false);
        if (e instanceof Fejl) onFejl?.(e);
      },
    );
    return () => { aktiv = false; };
  }, [...deps, n]);
  return { data, fejl, henter, genindlaes: useCallback(() => setN((x) => x + 1), []) };
}

export function Indlaeser({ h, children }: { h: Hentning<unknown>; children: () => ComponentChildren }) {
  if (h.data === null && h.henter) return <p class="svag">Henter …</p>;
  if (h.data === null && h.fejl) return <Besked type="fejl">{h.fejl} <button class="linkknap" onClick={h.genindlaes}>Prøv igen</button></Besked>;
  if (h.data === null) return null;
  return <>{children()}</>;
}
