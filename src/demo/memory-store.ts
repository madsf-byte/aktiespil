import type { Aendring, SpillerRettelse, Store } from '../../supabase/functions/_shared/store.ts';
import type { Game, Holding, Order, Player, Snapshot } from '../../supabase/functions/_shared/types.ts';

const kopi = <T>(x: T): T => structuredClone(x);

export class MemoryStore implements Store {
  games: Game[] = [];
  playerRows: Player[] = [];
  holdingRows: Holding[] = [];
  orderRows: Order[] = [];
  cache = new Map<string, { data: unknown; fetchedAt: number }>();
  snaps: Snapshot[] = [];
  state = new Map<string, string>();

  /** Til demo-tilstanden: gem/indlæs hele databasen som JSON. */
  dump(): string {
    return JSON.stringify({
      games: this.games, playerRows: this.playerRows, holdingRows: this.holdingRows, orderRows: this.orderRows,
      snaps: this.snaps, state: [...this.state],
    });
  }
  load(json: string) {
    const x = JSON.parse(json);
    Object.assign(this, { ...x, state: new Map(x.state) });
  }

  async game(id: string) { return kopi(this.games.find((g) => g.id === id) ?? null); }
  async gameByCode(code: string) { return kopi(this.games.find((g) => g.code === code) ?? null); }
  async gamesByOwner(o: string) { return kopi(this.games.filter((g) => g.owner_id === o)); }
  async unfinishedGames() { return kopi(this.games.filter((g) => !g.finished_at)); }
  async insertGame(g: Game) { this.games.push(kopi(g)); }
  async updateGame(id: string, patch: Partial<Game>) { Object.assign(this.games.find((g) => g.id === id)!, kopi(patch)); }

  async player(id: string) { return kopi(this.playerRows.find((p) => p.id === id) ?? null); }
  async playerByNickname(gameId: string, n: string) {
    return kopi(this.playerRows.find((p) => p.game_id === gameId && !p.removed && p.nickname.toLowerCase() === n.toLowerCase()) ?? null);
  }
  async players(gameId: string) { return kopi(this.playerRows.filter((p) => p.game_id === gameId && !p.removed)); }
  async insertPlayer(p: Player) { this.playerRows.push(kopi(p)); }
  async updatePlayer(id: string, patch: SpillerRettelse) { Object.assign(this.playerRows.find((p) => p.id === id)!, kopi(patch)); }

  async holdings(playerId: string) { return kopi(this.holdingRows.filter((h) => h.player_id === playerId)); }
  async holdingsForGame(gameId: string) { return kopi(this.holdingRows.filter((h) => h.game_id === gameId)); }
  async orders(playerId: string) {
    return kopi(this.orderRows.filter((o) => o.player_id === playerId)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async ordersForGame(gameId: string) {
    return kopi(this.orderRows.filter((o) => o.game_id === gameId)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  async pendingOrders() {
    return kopi(this.orderRows.filter((o) => o.status === 'pending')).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async hasOrders(gameId: string) { return this.orderRows.some((o) => o.game_id === gameId); }

  async commit(a: Aendring) {
    const p = this.playerRows.find((x) => x.id === a.player_id);
    if (!p || p.version !== a.expected_version) return false;
    p.cash = a.cash;
    p.version++;
    this.holdingRows = this.holdingRows.filter((h) => !(h.player_id === p.id && a.holdings_delete.includes(h.symbol)));
    for (const h of a.holdings_upsert) {
      const i = this.holdingRows.findIndex((x) => x.player_id === p.id && x.symbol === h.symbol);
      if (i >= 0) this.holdingRows[i] = kopi(h); else this.holdingRows.push(kopi(h));
    }
    this.orderRows.push(...kopi(a.orders_insert));
    for (const o of a.orders_update) {
      const i = this.orderRows.findIndex((x) => x.id === o.id && x.player_id === p.id);
      if (i >= 0) this.orderRows[i] = kopi(o);
    }
    return true;
  }

  async cacheGet(key: string) { return kopi(this.cache.get(key) ?? null); }
  async cachePut(key: string, data: unknown, fetchedAt: number) { this.cache.set(key, kopi({ data, fetchedAt })); }

  async snapshots(playerId: string) { return kopi(this.snaps.filter((s) => s.player_id === playerId)); }
  async upsertSnapshots(rows: Snapshot[]) {
    for (const r of rows) {
      const i = this.snaps.findIndex((s) => s.player_id === r.player_id && s.day === r.day);
      if (i >= 0) this.snaps[i] = kopi(r); else this.snaps.push(kopi(r));
    }
  }

  async stateGet(key: string) { return this.state.get(key) ?? null; }
  async stateSet(key: string, value: string) { this.state.set(key, value); }
}
