-- Interruption pause staging + XP history compatibility
-- 1) interruption 3h/24h staged penalties
-- 2) xp_logs compatibility columns (change_amount/reason/related_id)
-- 3) deduct_xp RPC alias

create extension if not exists pgcrypto;

create table if not exists public.xp_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  xp_change integer not null default 0,
  change_amount integer,
  source text not null default 'manual',
  reason text,
  event_id text,
  related_id text,
  date date not null default current_date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.xp_logs
  add column if not exists change_amount integer,
  add column if not exists reason text,
  add column if not exists related_id text;

update public.xp_logs
set
  change_amount = coalesce(change_amount, xp_change, 0),
  reason = coalesce(reason, source, 'manual'),
  related_id = coalesce(related_id, event_id)
where change_amount is null
   or reason is null
   or related_id is null;

create index if not exists xp_logs_user_reason_idx
  on public.xp_logs (user_id, reason);

create or replace function public.sync_xp_logs_compat_fields()
returns trigger
language plpgsql
as $$
begin
  new.change_amount := coalesce(new.change_amount, new.xp_change, 0);
  new.xp_change := coalesce(new.xp_change, new.change_amount, 0);
  new.reason := coalesce(new.reason, new.source, 'manual');
  new.source := coalesce(new.source, new.reason, 'manual');
  new.related_id := coalesce(new.related_id, new.event_id);
  new.event_id := coalesce(new.event_id, new.related_id);
  new.date := coalesce(new.date, (coalesce(new.created_at, now()) at time zone 'utc')::date);
  return new;
end;
$$;

drop trigger if exists trg_sync_xp_logs_compat_fields on public.xp_logs;
create trigger trg_sync_xp_logs_compat_fields
before insert or update
on public.xp_logs
for each row
execute function public.sync_xp_logs_compat_fields();

create table if not exists public.interruptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  interruption_code text not null default 'manual',
  status text not null default 'active',
  started_at timestamptz not null default now(),
  interruption_start timestamptz,
  interruption_end timestamptz,
  grace_hours integer not null default 6,
  grace_period_hours integer not null default 3,
  full_penalty_hours integer not null default 24,
  reward_xp integer not null default 0,
  penalty_xp integer not null default 0,
  penalty_applied boolean not null default false,
  mild_penalty_applied boolean not null default false,
  mild_penalty_xp integer not null default 0,
  full_penalty_applied boolean not null default false,
  full_penalty_xp integer not null default 0,
  penalty_state text not null default 'none',
  resolved_at timestamptz,
  event_date date not null default current_date,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.interruptions
  add column if not exists interruption_code text,
  add column if not exists status text not null default 'active',
  add column if not exists started_at timestamptz not null default now(),
  add column if not exists interruption_start timestamptz,
  add column if not exists interruption_end timestamptz,
  add column if not exists grace_hours integer not null default 6,
  add column if not exists grace_period_hours integer not null default 3 check (grace_period_hours > 0),
  add column if not exists full_penalty_hours integer not null default 24 check (full_penalty_hours > 0),
  add column if not exists reward_xp integer not null default 0,
  add column if not exists penalty_xp integer not null default 0,
  add column if not exists penalty_applied boolean not null default false,
  add column if not exists mild_penalty_applied boolean not null default false,
  add column if not exists mild_penalty_xp integer not null default 0,
  add column if not exists full_penalty_applied boolean not null default false,
  add column if not exists full_penalty_xp integer not null default 0,
  add column if not exists penalty_state text not null default 'none',
  add column if not exists resolved_at timestamptz,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

alter table public.interruptions
  drop constraint if exists interruptions_status_check;

update public.interruptions
set
  interruption_start = coalesce(interruption_start, started_at, created_at, now()),
  interruption_end = coalesce(interruption_end, resolved_at),
  grace_period_hours = coalesce(grace_period_hours, 3),
  full_penalty_hours = coalesce(full_penalty_hours, 24),
  status = case
    when status in ('accepted', 'resolved') then 'resolved'
    when status in ('ignored', 'expired', 'penalized') then 'penalized'
    else 'active'
  end
where interruption_start is null
   or interruption_end is null
   or status in ('pending', 'accepted', 'ignored', 'expired');

alter table public.interruptions
  add constraint interruptions_status_check
  check (status in ('active', 'resolved', 'penalized', 'paused', 'pending', 'accepted', 'ignored', 'expired'));

alter table public.interruptions
  drop constraint if exists interruptions_penalty_state_check;

alter table public.interruptions
  add constraint interruptions_penalty_state_check
  check (penalty_state in ('none', 'mild', 'full'));

create index if not exists interruptions_user_status_start_idx
  on public.interruptions (user_id, status, interruption_start desc);

-- Deduplicate before creating unique index.
with ranked as (
  select
    i.id,
    row_number() over (
      partition by i.user_id, i.interruption_code, i.event_date
      order by i.created_at desc nulls last, i.id desc
    ) as rn
  from public.interruptions i
)
delete from public.interruptions i
using ranked r
where i.id = r.id
  and r.rn > 1;

create unique index if not exists interruptions_user_code_day_unique_idx
  on public.interruptions (user_id, interruption_code, event_date);

create or replace function public.deduct_xp(
  p_user_id uuid,
  p_xp_amount integer,
  p_reason text default 'penalty',
  p_shadow_debt_amount integer default null,
  p_related_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table(
  total_xp bigint,
  current_xp bigint,
  level integer,
  stat_points integer,
  daily_streak integer,
  last_active_date date,
  shadow_debt_xp integer,
  debt_added integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regprocedure('public.penalty_xp(uuid,integer,text,integer,text,jsonb)') is null then
    raise exception 'penalty_xp(uuid, integer, text, integer, text, jsonb) is required before deduct_xp';
  end if;

  return query
  execute 'select * from public.penalty_xp($1,$2,$3,$4,$5,$6)'
  using
    p_user_id,
    p_xp_amount,
    p_reason,
    p_shadow_debt_amount,
    p_related_id,
    p_metadata;
end;
$$;

create or replace function public.resolve_interruption_penalty(
  p_user_id uuid,
  p_interruption_id uuid,
  p_source text default 'interruption'
)
returns table(
  interruption_status text,
  penalty_stage text,
  applied_xp integer,
  elapsed_seconds integer,
  remaining_to_grace_seconds integer,
  remaining_to_full_seconds integer,
  total_xp bigint,
  current_xp bigint,
  level integer,
  stat_points integer,
  daily_streak integer,
  last_active_date date,
  shadow_debt_xp integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_interrupt public.interruptions%rowtype;
  v_now timestamptz := now();
  v_elapsed integer := 0;
  v_grace integer := 10800;
  v_full integer := 86400;
  v_remaining_grace integer := 0;
  v_remaining_full integer := 0;
  v_applied integer := 0;
  v_stage text := 'none';
  v_mild_target integer := 0;
  v_full_target integer := 0;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  select *
  into v_interrupt
  from public.interruptions
  where id = p_interruption_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'interruption not found';
  end if;

  if v_interrupt.interruption_start is null then
    update public.interruptions
    set interruption_start = coalesce(started_at, now())
    where id = p_interruption_id
      and user_id = p_user_id;

    select *
    into v_interrupt
    from public.interruptions
    where id = p_interruption_id
      and user_id = p_user_id
    for update;
  end if;

  if v_interrupt.status = 'resolved' then
    v_stage := coalesce(v_interrupt.penalty_state, 'none');
    return query
    select
      v_interrupt.status,
      v_stage,
      0,
      0,
      0,
      0,
      p.total_xp::bigint,
      p.current_xp::bigint,
      p.level,
      coalesce(p.stat_points, 0),
      coalesce(p.daily_streak, 0),
      p.last_active_date,
      coalesce(s.shadow_debt_xp, 0)
    from public.profiles p
    left join public.stats s on s.user_id = p.id
    where p.id = p_user_id
    limit 1;
    return;
  end if;

  v_elapsed := greatest(0, floor(extract(epoch from (v_now - v_interrupt.interruption_start)))::integer);
  v_grace := greatest(1, coalesce(v_interrupt.grace_period_hours, 3)) * 3600;
  v_full := greatest(v_grace + 1, coalesce(v_interrupt.full_penalty_hours, 24) * 3600);
  v_remaining_grace := greatest(0, v_grace - v_elapsed);
  v_remaining_full := greatest(0, v_full - v_elapsed);
  v_mild_target := greatest(0, floor(coalesce(v_interrupt.penalty_xp, 0) * 0.4)::integer);
  v_full_target := greatest(v_mild_target, coalesce(v_interrupt.penalty_xp, 0));

  if v_elapsed >= v_full then
    v_stage := 'full';
    if not coalesce(v_interrupt.full_penalty_applied, false) then
      v_applied := greatest(0, v_full_target - coalesce(v_interrupt.mild_penalty_xp, 0) - coalesce(v_interrupt.full_penalty_xp, 0));
      if v_applied > 0 then
        perform public.deduct_xp(
          p_user_id,
          v_applied,
          p_source || '_full',
          ceil(v_applied * 0.25)::integer,
          p_interruption_id::text || ':full',
          jsonb_build_object(
            'interruption_id', p_interruption_id,
            'penalty_stage', 'full'
          )
        );
      end if;

      update public.interruptions
      set
        status = 'penalized',
        penalty_state = 'full',
        penalty_applied = true,
        full_penalty_applied = true,
        full_penalty_xp = coalesce(full_penalty_xp, 0) + v_applied,
        interruption_end = coalesce(interruption_end, v_now),
        resolved_at = coalesce(resolved_at, v_now)
      where id = p_interruption_id
        and user_id = p_user_id;
    end if;
  elsif v_elapsed >= v_grace then
    v_stage := 'mild';
    if not coalesce(v_interrupt.mild_penalty_applied, false) then
      v_applied := greatest(0, v_mild_target - coalesce(v_interrupt.mild_penalty_xp, 0));
      if v_applied > 0 then
        perform public.deduct_xp(
          p_user_id,
          v_applied,
          p_source || '_mild',
          ceil(v_applied * 0.15)::integer,
          p_interruption_id::text || ':mild',
          jsonb_build_object(
            'interruption_id', p_interruption_id,
            'penalty_stage', 'mild'
          )
        );
      end if;

      update public.interruptions
      set
        status = 'penalized',
        penalty_state = 'mild',
        penalty_applied = penalty_applied or (v_applied > 0),
        mild_penalty_applied = true,
        mild_penalty_xp = coalesce(mild_penalty_xp, 0) + v_applied
      where id = p_interruption_id
        and user_id = p_user_id;
    end if;
  else
    v_stage := 'none';
  end if;

  select *
  into v_interrupt
  from public.interruptions
  where id = p_interruption_id
    and user_id = p_user_id;

  return query
  select
    coalesce(v_interrupt.status, 'active'),
    coalesce(v_interrupt.penalty_state, v_stage, 'none'),
    v_applied,
    v_elapsed,
    greatest(0, v_grace - v_elapsed),
    greatest(0, v_full - v_elapsed),
    p.total_xp::bigint,
    p.current_xp::bigint,
    p.level,
    coalesce(p.stat_points, 0),
    coalesce(p.daily_streak, 0),
    p.last_active_date,
    coalesce(s.shadow_debt_xp, 0)
  from public.profiles p
  left join public.stats s on s.user_id = p.id
  where p.id = p_user_id
  limit 1;
end;
$$;

grant execute on function public.deduct_xp(uuid, integer, text, integer, text, jsonb) to authenticated;
grant execute on function public.resolve_interruption_penalty(uuid, uuid, text) to authenticated;
