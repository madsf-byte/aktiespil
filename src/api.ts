// Kald til serverfunktionen "api" (eller demo-motoren i browseren).
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const DEMO = import.meta.env.VITE_DEMO === '1';
// Offentlige værdier – beregnet til at ligge i browseren. Kan overskrives med VITE_-variabler.
const URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || 'https://caehqnmemkbuyiujxeei.supabase.co';
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || 'sb_publishable_KugLZCtwPJhDZ9ivRwYOOQ_0kh1M3d8';

export class Fejl extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

let supa: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!URL || !KEY) throw new Fejl('Appen mangler opsætning (Supabase).', 500);
  supa ??= createClient(URL, KEY);
  return supa;
}

async function laererToken(): Promise<string | null> {
  if (DEMO) return localStorage.getItem('aktiespil.demo-laerer');
  if (!URL || !KEY) return null;
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}

export async function kald<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const lt = await laererToken();
  if (DEMO) {
    const { demoKald } = await import('./demo/demo.ts');
    try {
      return await demoKald(action, data, lt) as T;
    } catch (e) {
      throw new Fejl(e instanceof Error ? e.message : 'Fejl', (e as { status?: number }).status ?? 400);
    }
  }
  if (!URL) throw new Fejl('Appen mangler opsætning (Supabase).', 500);
  let res: Response;
  try {
    res = await fetch(`${URL}/functions/v1/api`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(KEY ? { apikey: KEY } : {}),
        ...(lt ? { 'x-laerer-token': lt } : {}),
      },
      body: JSON.stringify({ action, data }),
    });
  } catch {
    throw new Fejl('Ingen forbindelse – tjek internettet og prøv igen.', 0);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Fejl(json.error ?? 'Der skete en fejl – prøv igen.', res.status);
  return json.data as T;
}

// ---------- Elevens login gemmes på enheden ----------

export interface ElevLogin { token: string; code: string; nickname: string }
const ELEV = 'aktiespil.elev';

export function hentElev(): ElevLogin | null {
  try {
    const s = localStorage.getItem(ELEV);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}
export function gemElev(l: ElevLogin | null) {
  try {
    if (l) localStorage.setItem(ELEV, JSON.stringify(l)); else localStorage.removeItem(ELEV);
  } catch { /* ingen lagring */ }
}

/** Kald som elev; nøglen lægges på automatisk. */
export function elevKald<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  return kald<T>(action, { ...data, token: hentElev()?.token });
}
