// Elever har ingen konti: de logger ind med klassekode, kaldenavn og PIN og får en signeret nøgle.
const enc = new TextEncoder();

/** Tegn uden forvekslinger (ingen 0/O, 1/I/L). */
const ALFABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function tilfaeldigKode(laengde: number): string {
  const b = crypto.getRandomValues(new Uint8Array(laengde));
  return Array.from(b, (x) => ALFABET[x % ALFABET.length]).join('');
}

function b64url(buf: ArrayBuffer): string {
  let s = '';
  for (const x of new Uint8Array(buf)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

export function hashPin(secret: string, playerId: string, pin: string): Promise<string> {
  return hmac(secret, `pin:${playerId}:${pin.toUpperCase()}`);
}

/** Nøglen bliver ugyldig, når læreren nulstiller PIN (pin_version tælles op). */
export async function lavNoegle(secret: string, playerId: string, pinVersion: number): Promise<string> {
  const data = `${playerId}.${pinVersion}`;
  return `${data}.${await hmac(secret, `token:${data}`)}`;
}

export async function laesNoegle(secret: string, token: string): Promise<{ playerId: string; pinVersion: number } | null> {
  const [playerId, v, sig] = String(token ?? '').split('.');
  if (!playerId || !v || !sig) return null;
  if (await hmac(secret, `token:${playerId}.${v}`) !== sig) return null;
  return { playerId, pinVersion: Number(v) };
}
