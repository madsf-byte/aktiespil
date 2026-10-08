// Fælles datatyper for server (Deno) og browser.

export interface Satser {
  start_capital: number;
  fee_dk_pct: number;
  fee_dk_min: number;
  fee_int_pct: number;
  fee_int_min: number;
  fx_pct: number;
  /** Højst så mange % af startkapitalen må være investeret i én aktie. */
  max_pct: number;
}

export interface Game extends Satser {
  id: string;
  owner_id: string;
  name: string;
  code: string;
  start_at: string;
  end_at: string;
  join_locked: boolean;
  finished_at: string | null;
  created_at: string;
}

export interface Player {
  id: string;
  game_id: string;
  nickname: string;
  pin_hash: string;
  pin_version: number;
  cash: number;
  version: number;
  removed: boolean;
  final_value: number | null;
  created_at: string;
}

export interface Holding {
  player_id: string;
  game_id: string;
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  qty: number;
  /** Aktier låst af ventende salgsordrer. */
  qty_reserved: number;
  /** Antal × gennemsnitlig købspris i kr. (uden kurtage). */
  invested_dkk: number;
  /** Tidspunkt (epoch sek.) for køb/seneste split – ældre split ignoreres. */
  split_ts: number;
}

export type Side = 'buy' | 'sell';
export type OrderStatus = 'pending' | 'executed' | 'rejected' | 'cancelled';

export interface Order {
  id: string;
  player_id: string;
  game_id: string;
  symbol: string;
  name: string;
  currency: string;
  exchange: string;
  side: Side;
  qty: number;
  status: OrderStatus;
  created_at: string;
  /** Hvornår en ventende ordre tidligst gennemføres (børsåbning). */
  earliest_at: string | null;
  executed_at: string | null;
  /** Kurs i aktiens valuta (hovedenhed, fx GBP – ikke pence). */
  price: number | null;
  fx_rate: number | null;
  value_dkk: number | null;
  fee_dkk: number | null;
  fx_fee_dkk: number | null;
  /** Køb: samlet pris. Salg: udbetalt beløb. */
  total_dkk: number | null;
  /** Kontanter reserveret af en ventende købsordre. */
  reserved_dkk: number;
  /** Anslået værdi (uden kurtage) af en ventende købsordre – tæller med i grænsen pr. aktie. */
  est_value_dkk: number;
  reason: string | null;
}

export interface Snapshot {
  player_id: string;
  day: string;
  value: number;
}

/** En kurs fra kursleverandøren, normaliseret. */
export interface Quote {
  symbol: string;
  name: string;
  /** Valuta i hovedenhed (GBp → GBP). */
  currency: string;
  price: number;
  prevClose: number | null;
  /** Kursens tidspunkt, epoch sek. */
  time: number;
  exchange: string;
  timezone: string;
  /** Den aktuelle/seneste ordinære handelsperiode, epoch sek. */
  sessionStart: number;
  sessionEnd: number;
}

export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
}

export interface ChartPoint {
  t: number;
  close: number;
}
