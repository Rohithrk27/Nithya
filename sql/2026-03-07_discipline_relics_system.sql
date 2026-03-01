-- Discipline Relic System (secure, scarcity-based, non-monetary)
-- 1) Relic inventory + redemption effects
-- 2) Controlled redeem codes with rate limiting and atomic redemption
-- 3) Abuse prevention (event dedupe, cap, exploit lock, cheat-day stacking guard)

create extension if not exists pgcrypto;

-- =========================================================
-- XP LOGS COMPATIBILITY (legacy schemas)
-- =========================================================

create table if not exists public.xp_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  xp_change integer not null default 0,
  source text not null default 'manual',
  date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.xp_logs
  add column if not exists date date not null default current_date,
  add column if not exists created_at timestamptz not null default now();

update public.xp_logs
set date = coalesce(date, (coalesce(created_at, now()) at time zone 'utc')::date)
where date is null;

-- =========================================================
-- USER_QUESTS COMPATIBILITY (legacy schemas)
-- =========================================================

do $$
begin
  if to_regclass('public.user_quests') is not null then
    execute '
      alter table public.user_quests
        add column if not exists date date not null default current_date
    ';

    execute '
      update public.user_quests
      set date = coalesce(date, (coalesce(created_at, now()) at time zone ''utc'')::date)
      where date is null
    ';
  end if;
end;
$$;

-- =========================================================
-- QUESTS COMPATIBILITY (legacy schemas)
-- =========================================================

do $$
begin
  if to_regclass('public.quests') is not null then
    execute '
      alter table public.quests
        add column if not exists date date not null default current_date,
        add column if not exists expires_date date
    ';

    execute '
      update public.quests
      set date = coalesce(date, (coalesce(created_at, now()) at time zone ''utc'')::date)
      where date is null
    ';
  end if;
end;
$$;

-- =========================================================
-- HABIT_LOGS COMPATIBILITY (legacy schemas)
-- =========================================================

do $$
declare
  v_has_created_at boolean := false;
  v_has_logged_at boolean := false;
  v_has_completed_at boolean := false;
begin
  if to_regclass('public.habit_logs') is null then
    return;
  end if;

  execute '
    alter table public.habit_logs
      add column if not exists date date
  ';

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'habit_logs'
      and column_name = 'created_at'
  ) into v_has_created_at;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'habit_logs'
      and column_name = 'logged_at'
  ) into v_has_logged_at;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'habit_logs'
      and column_name = 'completed_at'
  ) into v_has_completed_at;

  if v_has_completed_at and v_has_logged_at and v_has_created_at then
    execute '
      update public.habit_logs
      set date = coalesce(date, (coalesce(completed_at, logged_at, created_at, now()) at time zone ''utc'')::date)
      where date is null
    ';
  elsif v_has_logged_at and v_has_created_at then
    execute '
      update public.habit_logs
      set date = coalesce(date, (coalesce(logged_at, created_at, now()) at time zone ''utc'')::date)
      where date is null
    ';
  elsif v_has_created_at then
    execute '
      update public.habit_logs
      set date = coalesce(date, (coalesce(created_at, now()) at time zone ''utc'')::date)
      where date is null
    ';
  else
    execute '
      update public.habit_logs
      set date = coalesce(date, current_date)
      where date is null
    ';
  end if;

  execute '
    alter table public.habit_logs
      alter column date set default current_date
  ';
end;
$$;

-- =========================================================
-- DUNGEON PARTY POLICY HARDENING (prevent recursive RLS)
-- =========================================================

create or replace function public.is_dungeon_party_host(
  p_party_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.dungeon_parties p
    where p.id = p_party_id
      and p.host_user_id = auth.uid()
  );
$$;

create or replace function public.is_dungeon_party_member(
  p_party_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.dungeon_party_members m
    where m.party_id = p_party_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_dungeon_party_host_or_member(
  p_party_id uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_dungeon_party_host(p_party_id)
    or public.is_dungeon_party_member(p_party_id);
$$;

grant execute on function public.is_dungeon_party_host(uuid) to authenticated;
grant execute on function public.is_dungeon_party_member(uuid) to authenticated;
grant execute on function public.is_dungeon_party_host_or_member(uuid) to authenticated;

do $$
begin
  if to_regclass('public.dungeon_parties') is null
     or to_regclass('public.dungeon_party_members') is null then
    return;
  end if;

  execute 'drop policy if exists dungeon_parties_select_policy on public.dungeon_parties';
  execute 'create policy dungeon_parties_select_policy on public.dungeon_parties for select using (public.is_dungeon_party_host_or_member(id))';

  execute 'drop policy if exists dungeon_party_members_select_policy on public.dungeon_party_members';
  execute 'create policy dungeon_party_members_select_policy on public.dungeon_party_members for select using (auth.uid() = user_id or public.is_dungeon_party_host(party_id))';

  execute 'drop policy if exists dungeon_party_members_update_policy on public.dungeon_party_members';
  execute 'create policy dungeon_party_members_update_policy on public.dungeon_party_members for update using (auth.uid() = user_id or public.is_dungeon_party_host(party_id)) with check (auth.uid() = user_id or public.is_dungeon_party_host(party_id))';

  if to_regclass('public.dungeon_party_invites') is not null then
    execute 'drop policy if exists dungeon_party_invites_select_policy on public.dungeon_party_invites';
    execute 'create policy dungeon_party_invites_select_policy on public.dungeon_party_invites for select using (auth.uid() = invited_user_id or auth.uid() = invited_by_user_id or public.is_dungeon_party_host(party_id))';

    execute 'drop policy if exists dungeon_party_invites_insert_policy on public.dungeon_party_invites';
    execute 'create policy dungeon_party_invites_insert_policy on public.dungeon_party_invites for insert with check (auth.uid() = invited_by_user_id and public.is_dungeon_party_host(party_id))';

    execute 'drop policy if exists dungeon_party_invites_update_policy on public.dungeon_party_invites';
    execute 'create policy dungeon_party_invites_update_policy on public.dungeon_party_invites for update using (auth.uid() = invited_user_id or public.is_dungeon_party_host(party_id)) with check (auth.uid() = invited_user_id or public.is_dungeon_party_host(party_id))';
  end if;
end;
$$;

-- =========================================================
-- TABLES
-- =========================================================

create table if not exists public.discipline_relics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  event_id text,
  earned_at timestamptz not null default now(),
  expires_at timestamptz,
  used boolean not null default false,
  used_for text,
  used_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

alter table public.discipline_relics
  add column if not exists source text not null default 'unknown',
  add column if not exists event_id text,
  add column if not exists earned_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists used boolean not null default false,
  add column if not exists used_for text,
  add column if not exists used_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.relic_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  relic_id uuid references public.discipline_relics(id) on delete set null,
  action text not null,
  source text,
  event_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.discipline_relic_effects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  relic_id uuid references public.discipline_relics(id) on delete set null,
  effect_type text not null check (effect_type in ('cheat_day', 'xp_insurance')),
  status text not null default 'active' check (status in ('active', 'consumed', 'expired', 'cancelled')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.relic_redeem_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  relic_amount integer not null check (relic_amount > 0),
  max_global_uses integer,
  current_uses integer not null default 0,
  max_uses_per_user integer not null default 1,
  expires_at timestamptz,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.relic_redeem_codes
  add column if not exists code text,
  add column if not exists relic_amount integer not null default 1,
  add column if not exists max_global_uses integer,
  add column if not exists current_uses integer not null default 0,
  add column if not exists max_uses_per_user integer not null default 1,
  add column if not exists expires_at timestamptz,
  add column if not exists active boolean not null default true,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.relic_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_id uuid not null references public.relic_redeem_codes(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

alter table public.relic_code_redemptions
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.relic_redeem_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_input text,
  attempted_at timestamptz not null default now(),
  success boolean not null default false,
  error_code text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.security_exploit_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved boolean not null default false,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- =========================================================
-- INDEXES + CONSTRAINTS
-- =========================================================

create index if not exists discipline_relics_user_idx
  on public.discipline_relics (user_id);

create index if not exists discipline_relics_user_used_expires_idx
  on public.discipline_relics (user_id, used, expires_at);

create index if not exists discipline_relics_expires_idx
  on public.discipline_relics (expires_at);

create unique index if not exists discipline_relics_event_dedupe_idx
  on public.discipline_relics (user_id, source, event_id)
  where event_id is not null;

create index if not exists relic_logs_user_created_idx
  on public.relic_logs (user_id, created_at desc);

create unique index if not exists relic_logs_user_action_event_unique_idx
  on public.relic_logs (user_id, action, event_id)
  where event_id is not null;

create index if not exists discipline_relic_effects_user_status_idx
  on public.discipline_relic_effects (user_id, effect_type, status, expires_at);

-- Allow repeated redemptions of the same code by the same user when
-- max_uses_per_user = 0 (unlimited). Keep a non-unique lookup index.
drop index if exists public.relic_code_redemptions_user_code_unique_idx;

create index if not exists relic_code_redemptions_user_code_idx
  on public.relic_code_redemptions (user_id, code_id);

create index if not exists relic_code_redemptions_code_redeemed_idx
  on public.relic_code_redemptions (code_id, redeemed_at desc);

create index if not exists relic_redeem_attempts_user_attempted_idx
  on public.relic_redeem_attempts (user_id, attempted_at desc);

create index if not exists relic_redeem_codes_active_exp_idx
  on public.relic_redeem_codes (active, expires_at, current_uses);

create unique index if not exists relic_redeem_codes_code_unique_idx
  on public.relic_redeem_codes (code);

create index if not exists security_exploit_states_user_status_idx
  on public.security_exploit_states (user_id, status, resolved, created_at desc);

-- =========================================================
-- TRIGGERS
-- =========================================================

create or replace function public.touch_relic_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.normalize_relic_code_trigger()
returns trigger
language plpgsql
as $$
begin
  new.code := upper(regexp_replace(trim(coalesce(new.code, '')), '[^A-Z0-9]', '', 'g'));
  return new;
end;
$$;

drop trigger if exists trg_touch_relic_codes_updated_at on public.relic_redeem_codes;
create trigger trg_touch_relic_codes_updated_at
before update
on public.relic_redeem_codes
for each row
execute function public.touch_relic_updated_at();

drop trigger if exists trg_normalize_relic_code on public.relic_redeem_codes;
create trigger trg_normalize_relic_code
before insert or update of code
on public.relic_redeem_codes
for each row
execute function public.normalize_relic_code_trigger();

drop trigger if exists trg_touch_relic_effects_updated_at on public.discipline_relic_effects;
create trigger trg_touch_relic_effects_updated_at
before update
on public.discipline_relic_effects
for each row
execute function public.touch_relic_updated_at();

-- =========================================================
-- RLS
-- =========================================================

alter table public.discipline_relics enable row level security;
alter table public.relic_logs enable row level security;
alter table public.discipline_relic_effects enable row level security;
alter table public.relic_redeem_codes enable row level security;
alter table public.relic_code_redemptions enable row level security;
alter table public.relic_redeem_attempts enable row level security;
alter table public.security_exploit_states enable row level security;

drop policy if exists discipline_relics_select_own on public.discipline_relics;
create policy discipline_relics_select_own
on public.discipline_relics for select
using (auth.uid() = user_id);

drop policy if exists relic_logs_select_own on public.relic_logs;
create policy relic_logs_select_own
on public.relic_logs for select
using (auth.uid() = user_id);

drop policy if exists discipline_relic_effects_select_own on public.discipline_relic_effects;
create policy discipline_relic_effects_select_own
on public.discipline_relic_effects for select
using (auth.uid() = user_id);

drop policy if exists relic_code_redemptions_select_own on public.relic_code_redemptions;
create policy relic_code_redemptions_select_own
on public.relic_code_redemptions for select
using (auth.uid() = user_id);

drop policy if exists relic_redeem_attempts_select_own on public.relic_redeem_attempts;
create policy relic_redeem_attempts_select_own
on public.relic_redeem_attempts for select
using (auth.uid() = user_id);

drop policy if exists security_exploit_states_select_own on public.security_exploit_states;
create policy security_exploit_states_select_own
on public.security_exploit_states for select
using (auth.uid() = user_id);

-- =========================================================
-- HELPERS
-- =========================================================

create or replace function public.normalize_relic_code(p_code text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(trim(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g'));
$$;

create or replace function public.relic_source_allowed(p_source text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_source, '')) in (
    'perfect_weekly_streak',
    'group_bet_win',
    'dungeon_zero_interruptions',
    'shadow_debt_cleared',
    'weekly_target_120',
    'redeem_code'
  );
$$;

create or replace function public.relic_inventory_cap()
returns integer
language sql
stable
as $$
  with raw as (
    select nullif(current_setting('nithya.relic_inventory_cap', true), '') as val
  )
  select case
    when raw.val ~ '^[0-9]+$' then greatest(1, raw.val::integer)
    else 20
  end
  from raw;
$$;

create or replace function public.has_active_cheat_day_effect(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.discipline_relic_effects e
    where e.user_id = p_user_id
      and e.effect_type = 'cheat_day'
      and e.status = 'active'
      and coalesce(e.expires_at, now() + interval '1 day') > now()
  );
$$;

create or replace function public.cheat_day_expires_at(p_user_id uuid)
returns timestamptz
language sql
security definer
set search_path = public
as $$
  select max(e.expires_at)
  from public.discipline_relic_effects e
  where e.user_id = p_user_id
    and e.effect_type = 'cheat_day'
    and e.status = 'active'
    and coalesce(e.expires_at, now() + interval '1 day') > now();
$$;

create or replace function public.user_has_open_exploit_state(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.security_exploit_states s
    where s.user_id = p_user_id
      and (coalesce(s.resolved, false) = false or s.status = 'open')
      and s.resolved_at is null
  );
$$;

create or replace function public.find_active_group_bet_id(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bet_id uuid;
begin
  if to_regclass('public.group_bets') is not null then
    begin
      execute
        'select id
         from public.group_bets
         where user_id = $1
           and lower(coalesce(status, '''')) in (''active'', ''in_progress'', ''locked'', ''pending'')
         order by created_at desc nulls last
         limit 1'
      into v_bet_id
      using p_user_id;
      if v_bet_id is not null then
        return v_bet_id;
      end if;
    exception
      when others then
        null;
    end;

    begin
      execute
        'select id
         from public.group_bets
         where (host_user_id = $1 or owner_user_id = $1 or user_id = $1)
           and lower(coalesce(status, '''')) in (''active'', ''in_progress'', ''locked'', ''pending'')
         order by created_at desc nulls last
         limit 1'
      into v_bet_id
      using p_user_id;
      if v_bet_id is not null then
        return v_bet_id;
      end if;
    exception
      when others then
        null;
    end;
  end if;

  if to_regclass('public.bets') is not null then
    begin
      execute
        'select id
         from public.bets
         where user_id = $1
           and lower(coalesce(status, '''')) in (''active'', ''in_progress'', ''locked'', ''pending'')
         order by created_at desc nulls last
         limit 1'
      into v_bet_id
      using p_user_id;
      if v_bet_id is not null then
        return v_bet_id;
      end if;
    exception
      when others then
        null;
    end;
  end if;

  return null;
end;
$$;

create or replace function public.is_relic_admin()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_jwt jsonb := coalesce(auth.jwt(), '{}'::jsonb);
  v_check boolean := false;
begin
  if lower(coalesce(v_jwt->>'role', '')) in ('service_role', 'supabase_admin', 'postgres') then
    return true;
  end if;

  if lower(coalesce(v_jwt #>> '{app_metadata,role}', '')) in ('admin', 'owner') then
    return true;
  end if;

  if lower(coalesce(v_jwt #>> '{user_metadata,role}', '')) in ('admin', 'owner') then
    return true;
  end if;

  if exists (
    select 1
    from jsonb_array_elements_text(coalesce(v_jwt #> '{app_metadata,roles}', '[]'::jsonb)) as r(role)
    where lower(r.role) in ('admin', 'owner')
  ) then
    return true;
  end if;

  if v_uid is null then
    return false;
  end if;

  if to_regclass('public.profiles') is not null then
    begin
      execute
        'select exists (
           select 1
           from public.profiles
           where id = $1
             and coalesce(is_admin, false) = true
         )'
      into v_check
      using v_uid;
      if v_check then
        return true;
      end if;
    exception
      when undefined_column then
        null;
    end;

    begin
      execute
        'select exists (
           select 1
           from public.profiles
           where id = $1
             and lower(coalesce(role, '''')) in (''admin'', ''owner'')
         )'
      into v_check
      using v_uid;
      if v_check then
        return true;
      end if;
    exception
      when undefined_column then
        null;
    end;
  end if;

  return false;
end;
$$;

create or replace function public.clean_expired_relic_effects(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if auth.uid() is null then
    return 0;
  end if;

  update public.discipline_relic_effects
  set
    status = 'expired',
    updated_at = now()
  where user_id = p_user_id
    and status = 'active'
    and expires_at is not null
    and expires_at <= now();

  get diagnostics v_count = row_count;
  return coalesce(v_count, 0);
end;
$$;

create or replace function public.ensure_quest_template(
  p_payload jsonb
)
returns public.quests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_title text := nullif(trim(coalesce(v_payload->>'title', '')), '');
  v_type text := lower(nullif(trim(coalesce(v_payload->>'type', '')), ''));
  v_existing public.quests%rowtype;
  v_result public.quests%rowtype;
  v_col record;
  v_cols text := '';
  v_vals text := '';
  v_has_title boolean := false;
  v_has_type boolean := false;
  v_has_status boolean := false;
  v_has_created_at boolean := false;
  v_has_user_id boolean := false;
  v_lookup_sql text;
  v_insert_sql text;
begin
  if v_uid is null then
    raise exception 'forbidden';
  end if;

  if v_title is null then
    raise exception 'quest title is required';
  end if;

  if v_type is null then
    v_type := 'daily';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('ensure_quest_template'),
    hashtext(lower(v_title || ':' || v_type))
  );

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'quests'
      and c.column_name = 'type'
  )
  into v_has_type;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'quests'
      and c.column_name = 'status'
  )
  into v_has_status;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'quests'
      and c.column_name = 'created_at'
  )
  into v_has_created_at;

  select exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'quests'
      and c.column_name = 'user_id'
  )
  into v_has_user_id;

  v_lookup_sql := 'select * from public.quests q where lower(trim(coalesce(q.title, ''''))) = lower($1)';
  if v_has_type then
    v_lookup_sql := v_lookup_sql || ' and lower(trim(coalesce(q.type, ''daily''))) = $2';
  end if;
  if v_has_status then
    v_lookup_sql := v_lookup_sql || ' and lower(trim(coalesce(q.status, ''active''))) <> ''archived''';
  end if;
  if v_has_created_at then
    v_lookup_sql := v_lookup_sql || ' order by q.created_at desc nulls last';
  end if;
  v_lookup_sql := v_lookup_sql || ' limit 1';

  if v_has_type then
    execute v_lookup_sql into v_existing using v_title, v_type;
  else
    execute v_lookup_sql into v_existing using v_title;
  end if;

  if found then
    return v_existing;
  end if;

  v_payload := v_payload || jsonb_build_object('title', v_title);
  if v_has_type then
    v_payload := v_payload || jsonb_build_object('type', v_type);
  end if;
  if v_has_user_id and not (v_payload ? 'user_id') then
    v_payload := v_payload || jsonb_build_object('user_id', v_uid);
  end if;

  for v_col in
    select c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'quests'
    order by c.ordinal_position
  loop
    if not (v_payload ? v_col.column_name) then
      continue;
    end if;

    if v_cols <> '' then
      v_cols := v_cols || ', ';
      v_vals := v_vals || ', ';
    end if;

    v_cols := v_cols || format('%I', v_col.column_name);
    if v_payload->v_col.column_name = 'null'::jsonb then
      v_vals := v_vals || 'null';
    else
      v_vals := v_vals || format('%L', v_payload->>v_col.column_name);
    end if;

    if v_col.column_name = 'title' then
      v_has_title := true;
    end if;
  end loop;

  if not v_has_title then
    raise exception 'quests.title column is required';
  end if;

  if v_cols = '' then
    raise exception 'no compatible quest columns found';
  end if;

  v_insert_sql := format(
    'insert into public.quests (%s) values (%s) returning *',
    v_cols,
    v_vals
  );

  begin
    execute v_insert_sql into v_result;
  exception
    when unique_violation then
      if v_has_type then
        execute v_lookup_sql into v_result using v_title, v_type;
      else
        execute v_lookup_sql into v_result using v_title;
      end if;
      if not found then
        raise;
      end if;
  end;

  return v_result;
end;
$$;

-- =========================================================
-- INVENTORY READ RPCS
-- =========================================================

create or replace function public.get_relic_inventory(p_user_id uuid)
returns table(
  id uuid,
  source text,
  event_id text,
  earned_at timestamptz,
  expires_at timestamptz,
  used boolean,
  used_for text,
  used_at timestamptz,
  metadata jsonb,
  is_expired boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  perform public.clean_expired_relic_effects(p_user_id);

  return query
  select
    r.id,
    r.source,
    r.event_id,
    r.earned_at,
    r.expires_at,
    r.used,
    r.used_for,
    r.used_at,
    r.metadata,
    (r.expires_at is not null and r.expires_at <= now()) as is_expired
  from public.discipline_relics r
  where r.user_id = p_user_id
  order by r.used asc, r.earned_at desc
  limit 200;
end;
$$;

create or replace function public.get_relic_balance(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select count(*)::integer
  into v_count
  from public.discipline_relics r
  where r.user_id = p_user_id
    and coalesce(r.used, false) = false
    and (r.expires_at is null or r.expires_at > now());

  return coalesce(v_count, 0);
end;
$$;

-- =========================================================
-- RELIC AWARD RPC
-- =========================================================

create or replace function public.award_relic(
  p_user_id uuid,
  p_source text,
  p_event_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table(
  success boolean,
  relic_id uuid,
  relic_count integer,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text := lower(coalesce(p_source, ''));
  v_event_id text := nullif(trim(coalesce(p_event_id, '')), '');
  v_metadata jsonb := case
    when jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) = 'object' then coalesce(p_metadata, '{}'::jsonb)
    else '{}'::jsonb
  end;
  v_relic_id uuid;
  v_count integer := 0;
  v_run_id uuid;
  v_week_key text;
  v_dummy boolean;
  v_code_redemption_id text;
  v_inventory_cap integer := public.relic_inventory_cap();
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if not public.relic_source_allowed(v_source) then
    raise exception 'invalid relic source';
  end if;

  perform pg_advisory_xact_lock(hashtext('discipline_relics_user_lock'), hashtext(p_user_id::text));

  -- Source-specific validation to prevent client abuse/farming.
  if v_source = 'redeem_code' then
    if coalesce(current_setting('nithya.redeem_code_context', true), '') <> '1' then
      raise exception 'redeem_code source is system-only';
    end if;
    v_code_redemption_id := nullif(v_metadata->>'code_redemption_id', '');
    if v_code_redemption_id is null then
      raise exception 'missing code_redemption_id metadata';
    end if;
    if not exists (
      select 1
      from public.relic_code_redemptions rcr
      where rcr.id::text = v_code_redemption_id
        and rcr.user_id = p_user_id
    ) then
      raise exception 'invalid code redemption context';
    end if;
  elsif v_source = 'perfect_weekly_streak' then
    select coalesce(p.daily_streak, 0) >= 7
    into v_dummy
    from public.profiles p
    where p.id = p_user_id;
    if not coalesce(v_dummy, false) then
      raise exception 'weekly streak requirement not met';
    end if;
    if v_event_id is null then
      v_week_key := to_char(date_trunc('week', now()), 'IYYY-IW');
      v_event_id := 'weekly_streak:' || v_week_key;
    end if;
  elsif v_source = 'weekly_target_120' then
    select exists (
      select 1
      from public.user_quests uq
      where uq.user_id = p_user_id
        and coalesce(uq.quest_type, 'daily') = 'weekly'
        and coalesce(uq.progress_target, 0) > 0
        and coalesce(uq.progress_current, 0) >= ceil(coalesce(uq.progress_target, 0) * 1.2)
    )
    into v_dummy;
    if not coalesce(v_dummy, false) then
      raise exception 'weekly 120%% target requirement not met';
    end if;
    if v_event_id is null then
      v_week_key := to_char(date_trunc('week', now()), 'IYYY-IW');
      v_event_id := 'weekly_target_120:' || v_week_key;
    end if;
  elsif v_source = 'shadow_debt_cleared' then
    select coalesce(s.shadow_debt_xp, 0) <= 0
    into v_dummy
    from public.stats s
    where s.user_id = p_user_id;
    if not coalesce(v_dummy, false) then
      raise exception 'shadow debt is not cleared';
    end if;
    if v_event_id is null then
      v_event_id := 'shadow_debt_cleared:' || to_char(date_trunc('month', now()), 'YYYY-MM');
    end if;
  elsif v_source = 'dungeon_zero_interruptions' then
    if v_event_id is null then
      raise exception 'dungeon_zero_interruptions requires event_id (dungeon run id)';
    end if;
    begin
      v_run_id := v_event_id::uuid;
    exception
      when others then
        raise exception 'invalid dungeon run event id';
    end;
    select exists (
      select 1
      from public.dungeon_runs d
      where d.id = v_run_id
        and d.user_id = p_user_id
        and d.status = 'completed'
        and coalesce(d.interruptions_count, 0) = 0
    )
    into v_dummy;
    if not coalesce(v_dummy, false) then
      raise exception 'dungeon interruption-free completion not verified';
    end if;
  elsif v_source = 'group_bet_win' then
    if v_event_id is null then
      raise exception 'group_bet_win requires event_id';
    end if;
    if public.find_active_group_bet_id(p_user_id) is not null then
      raise exception 'group bet still active';
    end if;
  end if;

  select count(*)::integer
  into v_count
  from public.discipline_relics r
  where r.user_id = p_user_id
    and coalesce(r.used, false) = false
    and (r.expires_at is null or r.expires_at > now());

  if v_count >= v_inventory_cap then
    return query
    select false, null::uuid, v_count, 'relic_cap_reached'::text;
    return;
  end if;

  if v_event_id is not null and exists (
    select 1
    from public.discipline_relics r
    where r.user_id = p_user_id
      and r.source = v_source
      and r.event_id = v_event_id
  ) then
    return query
    select false, null::uuid, v_count, 'duplicate_event'::text;
    return;
  end if;

  insert into public.discipline_relics (
    user_id,
    source,
    event_id,
    earned_at,
    expires_at,
    metadata
  )
  values (
    p_user_id,
    v_source,
    v_event_id,
    now(),
    now() + interval '30 days',
    v_metadata
  )
  returning id
  into v_relic_id;

  insert into public.relic_logs (
    user_id,
    relic_id,
    action,
    source,
    event_id,
    details
  )
  values (
    p_user_id,
    v_relic_id,
    'earned',
    v_source,
    v_event_id,
    jsonb_build_object(
      'source', v_source,
      'metadata', v_metadata
    )
  );

  select count(*)::integer
  into v_count
  from public.discipline_relics r
  where r.user_id = p_user_id
    and coalesce(r.used, false) = false
    and (r.expires_at is null or r.expires_at > now());

  return query
  select true, v_relic_id, v_count, 'awarded'::text;
end;
$$;

-- =========================================================
-- RELIC REDEMPTION RPC
-- =========================================================

create or replace function public.redeem_relic(
  p_user_id uuid,
  p_relic_id uuid,
  p_action text,
  p_reference_id uuid default null
)
returns table(
  success boolean,
  relic_id uuid,
  action text,
  relic_count integer,
  effect jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := lower(trim(coalesce(p_action, '')));
  v_relic public.discipline_relics%rowtype;
  v_now timestamptz := now();
  v_effect jsonb := '{}'::jsonb;
  v_count integer := 0;
  v_used_this_month integer := 0;
  v_active_bet_id uuid;
  v_run_id uuid;
  v_stability_before integer := 0;
  v_stability_after integer := 0;
  v_shadow_before integer := 0;
  v_shadow_after integer := 0;
  v_punish record;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if public.user_has_open_exploit_state(p_user_id) then
    raise exception 'cannot redeem relic while exploit state is unresolved';
  end if;

  if v_action not in ('cheat_day', 'punishment_waiver', 'shadow_debt_reduction', 'dungeon_revive', 'xp_insurance') then
    raise exception 'invalid relic action';
  end if;

  perform public.clean_expired_relic_effects(p_user_id);
  perform pg_advisory_xact_lock(hashtext('discipline_relics_user_lock'), hashtext(p_user_id::text));

  select *
  into v_relic
  from public.discipline_relics r
  where r.id = p_relic_id
    and r.user_id = p_user_id
  for update;

  if not found then
    raise exception 'relic not found';
  end if;

  if coalesce(v_relic.used, false) then
    raise exception 'relic already used';
  end if;

  if v_relic.expires_at is not null and v_relic.expires_at <= v_now then
    raise exception 'relic expired';
  end if;

  if v_action = 'cheat_day' then
    v_active_bet_id := public.find_active_group_bet_id(p_user_id);
    if v_active_bet_id is not null then
      raise exception 'cannot use cheat day during active group bet';
    end if;

    if exists (
      select 1
      from public.discipline_relic_effects e
      where e.user_id = p_user_id
        and e.effect_type = 'cheat_day'
        and e.status = 'active'
        and coalesce(e.expires_at, v_now + interval '1 day') > v_now
    ) then
      raise exception 'cheat day is already active';
    end if;

    select count(*)::integer
    into v_used_this_month
    from public.discipline_relics r
    where r.user_id = p_user_id
      and coalesce(r.used, false) = true
      and r.used_for = 'cheat_day'
      and r.used_at >= date_trunc('month', v_now)
      and r.used_at < (date_trunc('month', v_now) + interval '1 month');

    if v_used_this_month >= 2 then
      raise exception 'cheat day monthly limit reached';
    end if;

    insert into public.discipline_relic_effects (
      user_id,
      relic_id,
      effect_type,
      status,
      starts_at,
      expires_at,
      metadata
    )
    values (
      p_user_id,
      p_relic_id,
      'cheat_day',
      'active',
      v_now,
      v_now + interval '1 day',
      jsonb_build_object('protected_penalties', true, 'protected_streak', true)
    );

    update public.profiles
    set last_active_date = greatest(coalesce(last_active_date, current_date), current_date)
    where id = p_user_id;

    v_effect := jsonb_build_object(
      'type', 'cheat_day',
      'expires_at', v_now + interval '1 day'
    );
  elsif v_action = 'punishment_waiver' then
    if p_reference_id is null then
      raise exception 'punishment_waiver requires punishment reference id';
    end if;

    select p.*
    into v_punish
    from public.punishments p
    where p.id = p_reference_id
      and p.user_id = p_user_id
    for update;

    if not found then
      raise exception 'punishment not found';
    end if;

    if coalesce(v_punish.resolved, false)
      or coalesce(v_punish.penalty_applied, false)
      or coalesce(v_punish.status, '') in ('timed_out') then
      raise exception 'punishment is not waivable';
    end if;

    if (
      coalesce(v_punish.status, '') = 'timed_out'
      or (
        coalesce(v_punish.reason, '') ilike '%timeout%'
        and coalesce(v_punish.expires_at, v_punish.started_at + interval '8 hours')
          - coalesce(v_punish.started_at, v_punish.created_at, v_now) >= interval '24 hours'
      )
    ) then
      raise exception '24-hour auto-timeout penalties cannot be waived';
    end if;

    update public.punishments
    set
      status = 'completed',
      resolved = true,
      penalty_applied = false,
      resolved_at = coalesce(resolved_at, v_now),
      reason = trim(concat(coalesce(reason, ''), ' [waived_by_relic]'))
    where id = p_reference_id
      and user_id = p_user_id;

    v_effect := jsonb_build_object(
      'type', 'punishment_waiver',
      'punishment_id', p_reference_id
    );
  elsif v_action = 'shadow_debt_reduction' then
    if not exists (
      select 1
      from public.stats s
      where s.user_id = p_user_id
    ) then
      begin
        insert into public.stats (user_id, shadow_debt_xp)
        values (p_user_id, 0);
      exception
        when others then
          null;
      end;
    end if;

    select coalesce(s.shadow_debt_xp, 0)
    into v_shadow_before
    from public.stats s
    where s.user_id = p_user_id
    for update;

    v_shadow_after := greatest(0, floor(v_shadow_before * 0.75)::integer);

    update public.stats
    set shadow_debt_xp = v_shadow_after
    where user_id = p_user_id;

    v_effect := jsonb_build_object(
      'type', 'shadow_debt_reduction',
      'before', v_shadow_before,
      'after', v_shadow_after
    );
  elsif v_action = 'dungeon_revive' then
    if p_reference_id is not null then
      select d.id, coalesce(d.stability, 0)
      into v_run_id, v_stability_before
      from public.dungeon_runs d
      where d.id = p_reference_id
        and d.user_id = p_user_id
        and d.status = 'active'
      for update;
    else
      select d.id, coalesce(d.stability, 0)
      into v_run_id, v_stability_before
      from public.dungeon_runs d
      where d.user_id = p_user_id
        and d.status = 'active'
      order by d.created_at desc
      limit 1
      for update;
    end if;

    if v_run_id is null then
      raise exception 'active dungeon required for revive';
    end if;

    update public.dungeon_runs
    set stability = greatest(50, coalesce(stability, 0))
    where id = v_run_id
      and user_id = p_user_id
    returning coalesce(stability, 0)
    into v_stability_after;

    v_effect := jsonb_build_object(
      'type', 'dungeon_revive',
      'dungeon_run_id', v_run_id,
      'before', v_stability_before,
      'after', v_stability_after
    );
  elsif v_action = 'xp_insurance' then
    v_active_bet_id := coalesce(p_reference_id, public.find_active_group_bet_id(p_user_id));
    if v_active_bet_id is null then
      raise exception 'active group bet required for xp insurance';
    end if;

    if exists (
      select 1
      from public.discipline_relic_effects e
      where e.user_id = p_user_id
        and e.effect_type = 'xp_insurance'
        and e.status = 'active'
        and coalesce(e.expires_at, v_now + interval '7 days') > v_now
        and coalesce(e.metadata->>'reference_id', '') = v_active_bet_id::text
    ) then
      raise exception 'xp insurance already active for this bet';
    end if;

    insert into public.discipline_relic_effects (
      user_id,
      relic_id,
      effect_type,
      status,
      starts_at,
      expires_at,
      metadata
    )
    values (
      p_user_id,
      p_relic_id,
      'xp_insurance',
      'active',
      v_now,
      v_now + interval '7 days',
      jsonb_build_object(
        'reference_id', v_active_bet_id,
        'protected_ratio', 0.50
      )
    );

    v_effect := jsonb_build_object(
      'type', 'xp_insurance',
      'reference_id', v_active_bet_id,
      'protected_ratio', 0.50
    );
  end if;

  update public.discipline_relics
  set
    used = true,
    used_for = v_action,
    used_at = v_now,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'redeemed_action', v_action,
      'reference_id', p_reference_id,
      'redeemed_at', v_now
    )
  where id = p_relic_id
    and user_id = p_user_id;

  insert into public.relic_logs (
    user_id,
    relic_id,
    action,
    source,
    event_id,
    details
  )
  values (
    p_user_id,
    p_relic_id,
    'redeemed',
    v_action,
    'redeem:' || p_relic_id::text || ':' || v_action,
    coalesce(v_effect, '{}'::jsonb)
  );

  select count(*)::integer
  into v_count
  from public.discipline_relics r
  where r.user_id = p_user_id
    and coalesce(r.used, false) = false
    and (r.expires_at is null or r.expires_at > now());

  return query
  select true, p_relic_id, v_action, v_count, coalesce(v_effect, '{}'::jsonb);
end;
$$;

-- =========================================================
-- REDEEM CODE RPCS
-- =========================================================

create or replace function public.redeem_relic_code(
  p_user_id uuid,
  p_code text
)
returns table(
  success boolean,
  relics_awarded integer,
  remaining_global_uses integer,
  error_code text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := public.normalize_relic_code(p_code);
  v_row public.relic_redeem_codes%rowtype;
  v_attempts_last_min integer := 0;
  v_user_uses integer := 0;
  v_unused_count integer := 0;
  v_available_slots integer := 0;
  v_award_count integer := 0;
  v_redemption_id uuid;
  v_remaining integer := null;
  v_award record;
  v_idx integer := 0;
  v_event text;
  v_inventory_cap integer := public.relic_inventory_cap();
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if v_code is null or v_code = '' then
    insert into public.relic_redeem_attempts (user_id, code_input, success, error_code)
    values (p_user_id, p_code, false, 'invalid_code');
    return query select false, 0, null::integer, 'invalid_code'::text;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('discipline_relics_user_lock'), hashtext(p_user_id::text));
  perform pg_advisory_xact_lock(hashtext('discipline_relics_code_lock'), hashtext(v_code));

  select count(*)::integer
  into v_attempts_last_min
  from public.relic_redeem_attempts a
  where a.user_id = p_user_id
    and a.attempted_at > now() - interval '1 minute';

  if v_attempts_last_min >= 3 then
    insert into public.relic_redeem_attempts (user_id, code_input, success, error_code)
    values (p_user_id, v_code, false, 'rate_limited');
    return query select false, 0, null::integer, 'rate_limited'::text;
    return;
  end if;

  select *
  into v_row
  from public.relic_redeem_codes c
  where public.normalize_relic_code(c.code) = v_code
  order by c.updated_at desc nulls last, c.created_at desc nulls last, c.id desc
  limit 1
  for update;

  if not found then
    insert into public.relic_redeem_attempts (user_id, code_input, success, error_code)
    values (p_user_id, v_code, false, 'invalid_code');
    return query select false, 0, null::integer, 'invalid_code'::text;
    return;
  end if;

  if not coalesce(v_row.active, false) then
    insert into public.relic_redeem_attempts (user_id, code_input, success, error_code)
    values (p_user_id, v_code, false, 'code_inactive');
    return query select false, 0, null::integer, 'code_inactive'::text;
    return;
  end if;

  if v_row.expires_at is not null and v_row.expires_at <= now() then
    insert into public.relic_redeem_attempts (user_id, code_input, success, error_code)
    values (p_user_id, v_code, false, 'code_expired');
    return query select false, 0, null::integer, 'code_expired'::text;
    return;
  end if;

  if v_row.max_global_uses is not null and v_row.current_uses >= v_row.max_global_uses then
    insert into public.relic_redeem_attempts (user_id, code_input, success, error_code)
    values (p_user_id, v_code, false, 'usage_limit_reached');
    return query select false, 0, 0, 'usage_limit_reached'::text;
    return;
  end if;

  select count(*)::integer
  into v_user_uses
  from public.relic_code_redemptions r
  where r.user_id = p_user_id
    and r.code_id = v_row.id;

  if coalesce(v_row.max_uses_per_user, 0) > 0
     and v_user_uses >= v_row.max_uses_per_user then
    insert into public.relic_redeem_attempts (user_id, code_input, success, error_code)
    values (p_user_id, v_code, false, 'usage_limit_reached');
    return query select false, 0, null::integer, 'usage_limit_reached'::text;
    return;
  end if;

  select count(*)::integer
  into v_unused_count
  from public.discipline_relics d
  where d.user_id = p_user_id
    and coalesce(d.used, false) = false
    and (d.expires_at is null or d.expires_at > now());

  v_available_slots := greatest(0, v_inventory_cap - v_unused_count);
  v_award_count := greatest(0, coalesce(v_row.relic_amount, 0));

  if v_award_count <= 0 then
    insert into public.relic_redeem_attempts (user_id, code_input, success, error_code)
    values (p_user_id, v_code, false, 'invalid_code_config');
    return query select false, 0, null::integer, 'invalid_code_config'::text;
    return;
  end if;

  if v_available_slots < v_award_count then
    insert into public.relic_redeem_attempts (user_id, code_input, success, error_code)
    values (p_user_id, v_code, false, 'relic_cap_reached');
    return query select false, 0, null::integer, 'relic_cap_reached'::text;
    return;
  end if;

  insert into public.relic_code_redemptions (user_id, code_id, metadata)
  values (
    p_user_id,
    v_row.id,
    jsonb_build_object('code', v_row.code, 'relic_amount', v_row.relic_amount)
  )
  returning id
  into v_redemption_id;

  update public.relic_redeem_codes
  set current_uses = current_uses + 1
  where id = v_row.id
  returning *
  into v_row;

  perform set_config('nithya.redeem_code_context', '1', true);

  for v_idx in 1..v_award_count loop
    v_event := format('redeem_code:%s:%s:%s', v_row.id::text, v_redemption_id::text, v_idx::text);

    select *
    into v_award
    from public.award_relic(
      p_user_id,
      'redeem_code',
      v_event,
      jsonb_build_object(
        'code_id', v_row.id,
        'code', v_row.code,
        'code_redemption_id', v_redemption_id,
        'slot', v_idx
      )
    )
    limit 1;

    if not coalesce(v_award.success, false) then
      raise exception 'failed to award relic from code redemption';
    end if;
  end loop;

  v_remaining := case
    when v_row.max_global_uses is null then null
    else greatest(0, v_row.max_global_uses - v_row.current_uses)
  end;

  insert into public.relic_logs (
    user_id,
    relic_id,
    action,
    source,
    event_id,
    details
  )
  values (
    p_user_id,
    null,
    'code_redeemed',
    'redeem_code',
    'code_redeem:' || v_redemption_id::text,
    jsonb_build_object(
      'code_id', v_row.id,
      'redemption_id', v_redemption_id,
      'relics_awarded', v_award_count
    )
  );

  insert into public.relic_redeem_attempts (user_id, code_input, success, error_code, metadata)
  values (
    p_user_id,
    v_code,
    true,
    null,
    jsonb_build_object('code_id', v_row.id, 'redemption_id', v_redemption_id, 'awarded', v_award_count)
  );

  return query
  select true, v_award_count, v_remaining, null::text;
end;
$$;

create or replace function public.create_relic_code(
  p_code text,
  p_relic_amount integer,
  p_max_global_uses integer,
  p_max_uses_per_user integer,
  p_expiry timestamptz
)
returns public.relic_redeem_codes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := public.normalize_relic_code(p_code);
  v_row public.relic_redeem_codes%rowtype;
  v_relic_amount integer := greatest(1, coalesce(p_relic_amount, 1));
  -- max_uses_per_user = 0 means unlimited per-user usage.
  v_max_user integer := case
    when p_max_uses_per_user is null or p_max_uses_per_user <= 0 then 0
    else p_max_uses_per_user
  end;
begin
  if not public.is_relic_admin() then
    raise exception 'forbidden';
  end if;

  if v_code is null or v_code = '' then
    raise exception 'invalid code';
  end if;

  if p_max_global_uses is not null and p_max_global_uses < 1 then
    raise exception 'max_global_uses must be null or > 0';
  end if;

  if p_expiry is not null and p_expiry <= now() then
    raise exception 'expiry must be in the future';
  end if;

  insert into public.relic_redeem_codes (
    code,
    relic_amount,
    max_global_uses,
    current_uses,
    max_uses_per_user,
    expires_at,
    active,
    metadata
  )
  values (
    v_code,
    v_relic_amount,
    p_max_global_uses,
    0,
    v_max_user,
    p_expiry,
    true,
    '{}'::jsonb
  )
  on conflict (code) do update
  set
    relic_amount = excluded.relic_amount,
    max_global_uses = excluded.max_global_uses,
    max_uses_per_user = excluded.max_uses_per_user,
    expires_at = excluded.expires_at,
    active = true,
    updated_at = now()
  returning *
  into v_row;

  return v_row;
end;
$$;

do $$
declare
  v_seed record;
  v_keep_id uuid;
begin
  if to_regclass('public.relic_redeem_codes') is null then
    return;
  end if;

  for v_seed in
    select *
    from (values
      ('RK2733'::text, 5::integer),
      ('RK1811'::text, 10::integer),
      ('IITR007'::text, 7::integer)
    ) as s(code, amount)
  loop
    v_keep_id := null;

    select c.id
    into v_keep_id
    from public.relic_redeem_codes c
    where public.normalize_relic_code(c.code) = v_seed.code
    order by c.updated_at desc nulls last, c.created_at desc nulls last, c.id desc
    limit 1
    for update;

    if v_keep_id is null then
      insert into public.relic_redeem_codes (
        code,
        relic_amount,
        max_global_uses,
        current_uses,
        max_uses_per_user,
        expires_at,
        active,
        metadata
      )
      values (
        v_seed.code,
        v_seed.amount,
        null,
        0,
        0,
        null,
        true,
        jsonb_build_object('seeded', true, 'seed', 'system_default')
      );
    else
      update public.relic_redeem_codes
      set
        code = v_seed.code,
        relic_amount = v_seed.amount,
        max_global_uses = null,
        max_uses_per_user = 0,
        active = true,
        updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('seeded', true, 'seed', 'system_default')
      where id = v_keep_id;
    end if;
  end loop;
end;
$$;

-- =========================================================
-- CHEAT-DAY SAFETY HOOKS (no streak reset / no timeout penalties while active)
-- =========================================================

create or replace function public.sync_daily_streak(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_today date := current_date;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    raise exception 'profile not found';
  end if;

  if v_profile.last_active_date is null then
    return coalesce(v_profile.daily_streak, 0);
  end if;

  if v_profile.last_active_date < (v_today - 1)
     and coalesce(v_profile.daily_streak, 0) <> 0
     and public.has_active_cheat_day_effect(p_user_id) then
    return coalesce(v_profile.daily_streak, 0);
  end if;

  if v_profile.last_active_date < (v_today - 1) and coalesce(v_profile.daily_streak, 0) <> 0 then
    update public.profiles
    set daily_streak = 0
    where id = p_user_id;
    return 0;
  end if;

  return coalesce(v_profile.daily_streak, 0);
end;
$$;

create or replace function public.resolve_expired_quests(
  p_user_id uuid,
  p_source text default 'quest_timeout',
  p_decay_factor numeric default 0.50
)
returns table(
  failed_count integer,
  total_penalty integer,
  total_xp bigint,
  current_xp bigint,
  level integer,
  shadow_debt_xp integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_penalty integer := 0;
  v_failed_count integer := 0;
  v_total_penalty integer := 0;
  v_safe_decay numeric := greatest(0, least(1, coalesce(p_decay_factor, 0.50)));
  v_cheat_expires timestamptz := public.cheat_day_expires_at(p_user_id);
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  for v_row in
    select
      uq.id,
      uq.user_id,
      uq.quest_id,
      uq.status,
      uq.expires_at,
      uq.penalty_applied,
      coalesce(nullif(uq.xp_reward, 0), q.xp_reward, 0) as effective_xp
    from public.user_quests uq
    left join public.quests q on q.id = uq.quest_id
    where uq.user_id = p_user_id
      and uq.status = 'active'
      and uq.expires_at is not null
      and uq.expires_at <= now()
      and coalesce(uq.failed, false) = false
    for update of uq skip locked
  loop
    if v_cheat_expires is not null and now() <= v_cheat_expires then
      update public.user_quests
      set expires_at = greatest(coalesce(expires_at, v_cheat_expires), v_cheat_expires)
      where id = v_row.id
        and user_id = p_user_id;
      continue;
    end if;

    update public.user_quests
    set
      status = 'failed',
      failed = true,
      failure_reason = 'expired',
      completed_date = coalesce(completed_date, current_date)
    where id = v_row.id
      and user_id = p_user_id;

    v_failed_count := v_failed_count + 1;

    if not coalesce(v_row.penalty_applied, false) then
      v_penalty := greatest(0, floor(coalesce(v_row.effective_xp, 0) * v_safe_decay)::integer);

      if v_penalty > 0 then
        perform public.penalty_xp(
          p_user_id,
          v_penalty,
          p_source,
          ceil(v_penalty * 0.25)::integer,
          'quest_timeout:' || v_row.id::text,
          jsonb_build_object(
            'user_quest_id', v_row.id,
            'quest_id', v_row.quest_id,
            'expired_at', now()
          )
        );
      end if;

      update public.user_quests
      set penalty_applied = true
      where id = v_row.id
        and user_id = p_user_id;

      v_total_penalty := v_total_penalty + v_penalty;
    end if;
  end loop;

  if exists (select 1 from public.profiles p where p.id = p_user_id) then
    return query
    select
      v_failed_count,
      v_total_penalty,
      p.total_xp::bigint,
      p.current_xp::bigint,
      p.level,
      coalesce(s.shadow_debt_xp, 0)
    from public.profiles p
    left join public.stats s on s.user_id = p.id
    where p.id = p_user_id
    limit 1;
  else
    return query
    select v_failed_count, v_total_penalty, 0::bigint, 0::bigint, 0, 0;
  end if;
end;
$$;

create or replace function public.resolve_expired_punishments(
  p_user_id uuid,
  p_source text default 'punishment_timeout'
)
returns table(
  resolved_count integer,
  total_penalty integer,
  total_xp bigint,
  current_xp bigint,
  level integer,
  shadow_debt_xp integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_penalty integer := 0;
  v_resolved_count integer := 0;
  v_total_penalty integer := 0;
  v_cheat_expires timestamptz := public.cheat_day_expires_at(p_user_id);
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  for v_row in
    select p.*
    from public.punishments p
    where p.user_id = p_user_id
      and coalesce(p.resolved, false) = false
      and coalesce(p.penalty_applied, false) = false
      and coalesce(p.expires_at, p.started_at + interval '8 hours') <= now()
    for update skip locked
  loop
    if v_cheat_expires is not null and now() <= v_cheat_expires then
      update public.punishments
      set expires_at = greatest(coalesce(expires_at, v_cheat_expires), v_cheat_expires)
      where id = v_row.id
        and user_id = p_user_id;
      continue;
    end if;

    v_penalty := greatest(0, coalesce(v_row.total_xp_penalty, v_row.accumulated_penalty, 0));

    if v_penalty > 0 then
      perform public.penalty_xp(
        p_user_id,
        v_penalty,
        p_source,
        ceil(v_penalty * 0.25)::integer,
        'punishment_timeout:' || v_row.id::text,
        jsonb_build_object('punishment_id', v_row.id, 'timeout', true)
      );
      v_total_penalty := v_total_penalty + v_penalty;
    end if;

    update public.punishments
    set
      status = 'timed_out',
      resolved = true,
      penalty_applied = true,
      resolved_at = coalesce(resolved_at, now())
    where id = v_row.id
      and user_id = p_user_id;

    v_resolved_count := v_resolved_count + 1;
  end loop;

  if exists (select 1 from public.profiles p where p.id = p_user_id) then
    return query
    select
      v_resolved_count,
      v_total_penalty,
      p.total_xp::bigint,
      p.current_xp::bigint,
      p.level,
      coalesce(s.shadow_debt_xp, 0)
    from public.profiles p
    left join public.stats s on s.user_id = p.id
    where p.id = p_user_id
    limit 1;
  else
    return query
    select v_resolved_count, v_total_penalty, 0::bigint, 0::bigint, 0, 0;
  end if;
end;
$$;

-- =========================================================
-- GRANTS
-- =========================================================

grant execute on function public.normalize_relic_code(text) to authenticated;
grant execute on function public.relic_inventory_cap() to authenticated;
grant execute on function public.get_relic_inventory(uuid) to authenticated;
grant execute on function public.get_relic_balance(uuid) to authenticated;
grant execute on function public.award_relic(uuid, text, text, jsonb) to authenticated;
grant execute on function public.redeem_relic(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.redeem_relic_code(uuid, text) to authenticated;
grant execute on function public.create_relic_code(text, integer, integer, integer, timestamptz) to authenticated;
grant execute on function public.has_active_cheat_day_effect(uuid) to authenticated;
grant execute on function public.find_active_group_bet_id(uuid) to authenticated;
grant execute on function public.clean_expired_relic_effects(uuid) to authenticated;
grant execute on function public.ensure_quest_template(jsonb) to authenticated;

-- =========================================================
-- REALTIME
-- =========================================================

do $$
declare
  v_table text;
  v_tables text[] := array[
    'discipline_relics',
    'relic_logs',
    'discipline_relic_effects',
    'relic_code_redemptions'
  ];
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_table in array v_tables loop
      if exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = v_table
      ) and not exists (
        select 1
        from pg_publication_tables pt
        where pt.pubname = 'supabase_realtime'
          and pt.schemaname = 'public'
          and pt.tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end;
$$;
