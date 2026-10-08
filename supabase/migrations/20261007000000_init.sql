-- Aktiespil: tabeller. Al adgang går gennem Edge Function "api" med service-nøglen;
-- RLS er slået til uden politikker, så browseren ikke kan læse eller skrive direkte.

create table games (
  id uuid primary key,
  owner_id uuid not null,
  name text not null,
  code text not null unique,
  start_at timestamptz not null,
  end_at timestamptz not null,
  start_capital numeric(14,2) not null,
  fee_dk_pct double precision not null,
  fee_dk_min numeric(14,2) not null,
  fee_int_pct double precision not null,
  fee_int_min numeric(14,2) not null,
  fx_pct double precision not null,
  max_pct double precision not null,
  join_locked boolean not null default false,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index on games (owner_id);

create table players (
  id uuid primary key,
  game_id uuid not null references games on delete cascade,
  nickname text not null,
  pin_hash text not null,
  pin_version int not null default 1,
  cash numeric(14,2) not null,
  version int not null default 1,
  removed boolean not null default false,
  final_value numeric(14,2),
  created_at timestamptz not null default now()
);
create unique index players_nickname on players (game_id, lower(nickname)) where not removed;

create table holdings (
  player_id uuid not null references players on delete cascade,
  game_id uuid not null references games on delete cascade,
  symbol text not null,
  name text not null,
  currency text not null,
  exchange text not null,
  qty int not null,
  qty_reserved int not null default 0,
  invested_dkk numeric(14,2) not null,
  split_ts bigint not null,
  primary key (player_id, symbol)
);
create index on holdings (game_id);

create table orders (
  id uuid primary key,
  player_id uuid not null references players on delete cascade,
  game_id uuid not null references games on delete cascade,
  symbol text not null,
  name text not null,
  currency text not null,
  exchange text not null,
  side text not null check (side in ('buy', 'sell')),
  qty int not null,
  status text not null check (status in ('pending', 'executed', 'rejected', 'cancelled')),
  created_at timestamptz not null,
  earliest_at timestamptz,
  executed_at timestamptz,
  price double precision,
  fx_rate double precision,
  value_dkk numeric(14,2),
  fee_dkk numeric(14,2),
  fx_fee_dkk numeric(14,2),
  total_dkk numeric(14,2),
  reserved_dkk numeric(14,2) not null default 0,
  est_value_dkk numeric(14,2) not null default 0,
  reason text
);
create index on orders (player_id, created_at desc);
create index on orders (game_id);
create index orders_pending on orders (created_at) where status = 'pending';

create table quote_cache (
  key text primary key,
  data jsonb not null,
  fetched_at bigint not null
);

create table snapshots (
  player_id uuid not null references players on delete cascade,
  day date not null,
  value numeric(14,2) not null,
  primary key (player_id, day)
);

create table app_state (
  key text primary key,
  value text not null
);

alter table games enable row level security;
alter table players enable row level security;
alter table holdings enable row level security;
alter table orders enable row level security;
alter table quote_cache enable row level security;
alter table snapshots enable row level security;
alter table app_state enable row level security;

-- Gemmer én spillers ændring atomart; afvises hvis spilleren er ændret siden (version).
create function commit_player(p jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  pid uuid := (p->>'player_id')::uuid;
  n int;
begin
  update players set cash = (p->>'cash')::numeric, version = version + 1
    where id = pid and version = (p->>'expected_version')::int;
  get diagnostics n = row_count;
  if n = 0 then
    return false;
  end if;

  delete from holdings
    where player_id = pid and symbol in (select jsonb_array_elements_text(p->'holdings_delete'));

  insert into holdings
    select * from jsonb_populate_recordset(null::holdings, p->'holdings_upsert')
  on conflict (player_id, symbol) do update set
    name = excluded.name, qty = excluded.qty, qty_reserved = excluded.qty_reserved,
    invested_dkk = excluded.invested_dkk, split_ts = excluded.split_ts;

  insert into orders
    select * from jsonb_populate_recordset(null::orders, p->'orders_insert');

  update orders o set
    qty = r.qty, status = r.status, executed_at = r.executed_at, price = r.price, fx_rate = r.fx_rate,
    value_dkk = r.value_dkk, fee_dkk = r.fee_dkk, fx_fee_dkk = r.fx_fee_dkk, total_dkk = r.total_dkk,
    reserved_dkk = r.reserved_dkk, reason = r.reason
  from jsonb_populate_recordset(null::orders, p->'orders_update') r
  where o.id = r.id and o.player_id = pid;

  return true;
end;
$$;

revoke execute on function commit_player(jsonb) from public, anon, authenticated;
