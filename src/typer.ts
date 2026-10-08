import type { RangRaekke, SpilInfo, Spiller } from '../supabase/functions/_shared/api.ts';
import type { Position, Vaerdi } from '../supabase/functions/_shared/motor.ts';
import type { Boersstatus } from '../supabase/functions/_shared/tid.ts';
import type { Game, Holding, Order, Quote, Snapshot } from '../supabase/functions/_shared/types.ts';

export type { Game, Holding, Order, Position, Quote, RangRaekke, SpilInfo, Spiller, Vaerdi };

export interface MigSvar {
  game: SpilInfo;
  player: Spiller;
  vaerdi: Vaerdi;
  pending: Order[];
  snapshots: Snapshot[];
}

export interface AktieSvar {
  quote: Quote;
  fx: number;
  now: number;
  status: Boersstatus;
  frisk: boolean;
  holding: Holding | null;
  pendingEst: number;
  cash: number;
}

export interface RanglisteSvar { rows: RangRaekke[]; finished: boolean }

export interface LaererRaekke extends RangRaekke {
  created_at: string;
  positions: Position[];
  cash: number;
  reserved: number;
  orders: Order[];
}

export interface SpilSvar { game: Game; hasOrders: boolean; rows: LaererRaekke[] }
