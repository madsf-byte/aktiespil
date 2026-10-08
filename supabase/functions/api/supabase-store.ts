import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { Aendring, SpillerRettelse, Store } from '../_shared/store.ts';
import type { Game, Holding, Order, Player, Snapshot, Teacher } from '../_shared/types.ts';

function ok<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}

/** numeric-kolonner kan komme som tekst; tving dem til tal. */
function tal<T>(row: T, felter: string[]): T {
  if (!row) return row;
  const r = row as Record<string, unknown>;
  for (const f of felter) if (r[f] !== null && r[f] !== undefined) r[f] = Number(r[f]);
  return row;
}
const GAME_TAL = ['start_capital', 'fee_dk_pct', 'fee_dk_min', 'fee_int_pct', 'fee_int_min', 'fx_pct', 'max_pct'];
const PLAYER_TAL = ['cash', 'final_value'];
const HOLDING_TAL = ['invested_dkk', 'split_ts'];
const ORDER_TAL = ['price', 'fx_rate', 'value_dkk', 'fee_dkk', 'fx_fee_dkk', 'total_dkk', 'reserved_dkk', 'est_value_dkk'];

const g = (x: Game) => tal(x, GAME_TAL);
const p = (x: Player) => tal(x, PLAYER_TAL);
const h = (x: Holding) => tal(x, HOLDING_TAL);
const o = (x: Order) => tal(x, ORDER_TAL);

export class SupabaseStore implements Store {
  constructor(private db: SupabaseClient) {}

  async game(id: string) { return g(ok(await this.db.from('games').select('*').eq('id', id).maybeSingle())); }
  async gameByCode(code: string) { return g(ok(await this.db.from('games').select('*').eq('code', code).maybeSingle())); }
  async gamesByOwner(owner: string) {
    return (ok(await this.db.from('games').select('*').eq('owner_id', owner).order('created_at', { ascending: false })) ?? []).map(g);
  }
  async unfinishedGames() { return (ok(await this.db.from('games').select('*').is('finished_at', null)) ?? []).map(g); }
  async insertGame(x: Game) { ok(await this.db.from('games').insert(x)); }
  async updateGame(id: string, patch: Partial<Game>) { ok(await this.db.from('games').update(patch).eq('id', id)); }

  async player(id: string) { return p(ok(await this.db.from('players').select('*').eq('id', id).maybeSingle())); }
  async playerByNickname(gameId: string, nickname: string) {
    const rows = ok(await this.db.from('players').select('*').eq('game_id', gameId).eq('removed', false)) ?? [];
    return p(rows.find((r: Player) => r.nickname.toLowerCase() === nickname.toLowerCase()) ?? null);
  }
  async players(gameId: string) {
    return (ok(await this.db.from('players').select('*').eq('game_id', gameId).eq('removed', false)) ?? []).map(p);
  }
  async insertPlayer(x: Player) {
    const r = await this.db.from('players').insert(x);
    if ((r.error as { code?: string } | null)?.code === '23505') throw new Error('Det kaldenavn er taget – vælg et andet.');
    ok(r);
  }
  async updatePlayer(id: string, patch: SpillerRettelse) { ok(await this.db.from('players').update(patch).eq('id', id)); }

  async holdings(playerId: string) {
    return (ok(await this.db.from('holdings').select('*').eq('player_id', playerId).order('name')) ?? []).map(h);
  }
  async holdingsForGame(gameId: string) {
    return (ok(await this.db.from('holdings').select('*').eq('game_id', gameId)) ?? []).map(h);
  }
  async orders(playerId: string) {
    return (ok(await this.db.from('orders').select('*').eq('player_id', playerId).order('created_at', { ascending: false }).limit(1000)) ?? []).map(o);
  }
  async ordersForGame(gameId: string) {
    return (ok(await this.db.from('orders').select('*').eq('game_id', gameId).order('created_at', { ascending: false }).limit(10000)) ?? []).map(o);
  }
  async pendingOrders() {
    return (ok(await this.db.from('orders').select('*').eq('status', 'pending').order('created_at')) ?? []).map(o);
  }
  async hasOrders(gameId: string) {
    const r = await this.db.from('orders').select('id', { count: 'exact', head: true }).eq('game_id', gameId);
    ok(r);
    return (r.count ?? 0) > 0;
  }

  async commit(a: Aendring) {
    return ok(await this.db.rpc('commit_player', { p: a })) === true;
  }

  async cacheGet(key: string) {
    const r = ok(await this.db.from('quote_cache').select('data, fetched_at').eq('key', key).maybeSingle());
    return r ? { data: r.data, fetchedAt: Number(r.fetched_at) } : null;
  }
  async cachePut(key: string, data: unknown, fetchedAt: number) {
    ok(await this.db.from('quote_cache').upsert({ key, data, fetched_at: Math.floor(fetchedAt) }));
  }

  async snapshots(playerId: string) {
    return (ok(await this.db.from('snapshots').select('*').eq('player_id', playerId).order('day')) ?? [])
      .map((s: Snapshot) => ({ ...s, value: Number(s.value) }));
  }
  async upsertSnapshots(rows: Snapshot[]) { ok(await this.db.from('snapshots').upsert(rows)); }

  async teachers() { return ok(await this.db.from('teachers').select('*').order('email')) ?? []; }
  async teacher(email: string) { return ok(await this.db.from('teachers').select('*').eq('email', email).maybeSingle()); }
  async addTeacher(t: Teacher) { ok(await this.db.from('teachers').upsert(t, { onConflict: 'email', ignoreDuplicates: true })); }
  async removeTeacher(email: string) { ok(await this.db.from('teachers').delete().eq('email', email)); }

  async stateGet(key: string) {
    return ok(await this.db.from('app_state').select('value').eq('key', key).maybeSingle())?.value ?? null;
  }
  async stateSet(key: string, value: string) { ok(await this.db.from('app_state').upsert({ key, value })); }
}
