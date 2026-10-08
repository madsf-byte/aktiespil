// Edge Function "api": ét indgangspunkt for elever, lærer og planlægger.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ApiFejl, haandter } from '../_shared/api.ts';
import { Kurser } from '../_shared/kurser.ts';
import { KursFejl, yahoo } from '../_shared/yahoo.ts';
import { SupabaseStore } from './supabase-store.ts';

const env = (n: string) => Deno.env.get(n) ?? '';

const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const store = new SupabaseStore(db);
const now = () => Date.now() / 1000;
const kurser = new Kurser(store, yahoo, now);
const laererMails = env('TEACHER_EMAILS').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret, x-laerer-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const svar = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return svar({ error: 'Kun POST.' }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const data = await haandter({
      store, kurser, now,
      secret: env('TOKEN_SECRET'),
      cronSecret: env('CRON_SECRET'),
      async laerer(authorization) {
        // Elevkald sender projektets offentlige nøgle; kun en rigtig brugersession er en lærer.
        const jwt = authorization?.replace(/^Bearer\s+/i, '');
        if (!jwt) return null;
        const { data: u } = await db.auth.getUser(jwt);
        const email = u.user?.email?.toLowerCase();
        if (!u.user || !email || !laererMails.includes(email)) return null;
        return { id: u.user.id, email };
      },
    }, {
      action: String(body.action ?? ''),
      body: body.data ?? {},
      authorization: req.headers.get('x-laerer-token') ? `Bearer ${req.headers.get('x-laerer-token')}` : null,
      cronSecret: req.headers.get('x-cron-secret'),
    });
    return svar({ data });
  } catch (e) {
    if (e instanceof ApiFejl) return svar({ error: e.message }, e.status);
    if (e instanceof KursFejl) return svar({ error: e.message }, 503);
    if (e instanceof Error && e.message.startsWith('Det kaldenavn')) return svar({ error: e.message }, 400);
    console.error(e);
    return svar({ error: 'Der skete en fejl på serveren – prøv igen.' }, 500);
  }
});
