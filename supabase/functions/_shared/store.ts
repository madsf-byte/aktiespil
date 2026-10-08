// Datalaget som grænseflade. SupabaseStore bruges i produktion, MemoryStore i tests.
import type { Game, Holding, Order, Player, Snapshot } from './types.ts';

/** Samlet ændring af én spillers kontanter, beholdning og ordrer – gemmes atomart. */
export interface Aendring {
  player_id: string;
  /** Afvises hvis spilleren er ændret siden (optimistisk låsning). */
  expected_version: number;
  cash: number;
  holdings_upsert: Holding[];
  holdings_delete: string[];
  orders_insert: Order[];
  orders_update: Order[];
}

export type SpillerRettelse = Partial<Pick<Player, 'pin_hash' | 'pin_version' | 'removed' | 'final_value'>>;

export interface Store {
  game(id: string): Promise<Game | null>;
  gameByCode(code: string): Promise<Game | null>;
  gamesByOwner(ownerId: string): Promise<Game[]>;
  unfinishedGames(): Promise<Game[]>;
  insertGame(g: Game): Promise<void>;
  updateGame(id: string, patch: Partial<Game>): Promise<void>;

  player(id: string): Promise<Player | null>;
  /** Aktiv spiller med kaldenavnet (uden forskel på store/små bogstaver). */
  playerByNickname(gameId: string, nickname: string): Promise<Player | null>;
  /** Aktive (ikke fjernede) spillere. */
  players(gameId: string): Promise<Player[]>;
  insertPlayer(p: Player): Promise<void>;
  updatePlayer(id: string, patch: SpillerRettelse): Promise<void>;

  holdings(playerId: string): Promise<Holding[]>;
  holdingsForGame(gameId: string): Promise<Holding[]>;
  /** Nyeste først. */
  orders(playerId: string): Promise<Order[]>;
  ordersForGame(gameId: string): Promise<Order[]>;
  /** Alle ventende ordrer, ældste først. */
  pendingOrders(): Promise<Order[]>;
  hasOrders(gameId: string): Promise<boolean>;

  commit(a: Aendring): Promise<boolean>;

  cacheGet(key: string): Promise<{ data: unknown; fetchedAt: number } | null>;
  cachePut(key: string, data: unknown, fetchedAt: number): Promise<void>;

  snapshots(playerId: string): Promise<Snapshot[]>;
  upsertSnapshots(rows: Snapshot[]): Promise<void>;

  stateGet(key: string): Promise<string | null>;
  stateSet(key: string, value: string): Promise<void>;
}
