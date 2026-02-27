-- Strict Solo-Leveling systems migration
-- Adds debt/strike state and mandatory rank evaluations

alter table public.stats
  add column if not exists shadow_debt_xp integer not null default 0,
  add column if not exists strict_strikes integer not null default 0,
  add column if not exists last_strike_date date;

create table if not exists public.rank_evaluations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  required_level integer not null,
  title text not null,
  description text,
  status text not null default 'pending' check (status in ('pending', 'cleared', 'failed')),
  due_date date,
  resolved_date date,
  created_at timestamptz not null default now()
);

create index if not exists rank_evaluations_user_idx on public.rank_evaluations (user_id, created_at desc);
create unique index if not exists rank_evaluations_unique_gate_idx
  on public.rank_evaluations (user_id, required_level);

alter table public.rank_evaluations enable row level security;

drop policy if exists rank_evaluations_select_own on public.rank_evaluations;
create policy rank_evaluations_select_own
on public.rank_evaluations for select
using (auth.uid() = user_id);

drop policy if exists rank_evaluations_insert_own on public.rank_evaluations;
create policy rank_evaluations_insert_own
on public.rank_evaluations for insert
with check (auth.uid() = user_id);

drop policy if exists rank_evaluations_update_own on public.rank_evaluations;
create policy rank_evaluations_update_own
on public.rank_evaluations for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
