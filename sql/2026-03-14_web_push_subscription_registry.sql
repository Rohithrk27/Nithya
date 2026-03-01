create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  content_encoding text null,
  reminder_time text not null default '21:00',
  timezone text not null default 'UTC',
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  last_notified_at timestamptz null,
  last_notified_local_date date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists web_push_subscriptions_user_endpoint_idx
  on public.web_push_subscriptions(user_id, endpoint);

create index if not exists web_push_subscriptions_active_schedule_idx
  on public.web_push_subscriptions(is_active, reminder_time, timezone);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'web_push_subscriptions_reminder_time_check'
      and conrelid = 'public.web_push_subscriptions'::regclass
  ) then
    alter table public.web_push_subscriptions
      add constraint web_push_subscriptions_reminder_time_check
      check (reminder_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  end if;
end $$;

create or replace function public.touch_web_push_subscriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_web_push_subscriptions_updated_at on public.web_push_subscriptions;
create trigger trg_touch_web_push_subscriptions_updated_at
before update on public.web_push_subscriptions
for each row
execute function public.touch_web_push_subscriptions_updated_at();

alter table public.web_push_subscriptions enable row level security;

drop policy if exists web_push_subscriptions_select_policy on public.web_push_subscriptions;
create policy web_push_subscriptions_select_policy
on public.web_push_subscriptions
for select
using (auth.uid() = user_id);

drop policy if exists web_push_subscriptions_insert_policy on public.web_push_subscriptions;
create policy web_push_subscriptions_insert_policy
on public.web_push_subscriptions
for insert
with check (auth.uid() = user_id);

drop policy if exists web_push_subscriptions_update_policy on public.web_push_subscriptions;
create policy web_push_subscriptions_update_policy
on public.web_push_subscriptions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists web_push_subscriptions_delete_policy on public.web_push_subscriptions;
create policy web_push_subscriptions_delete_policy
on public.web_push_subscriptions
for delete
using (auth.uid() = user_id);

create or replace function public.get_due_web_push_subscriptions(
  p_now timestamptz default now()
)
returns table(
  id uuid,
  user_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  content_encoding text,
  reminder_time text,
  timezone text
)
language sql
security definer
set search_path = public
as $$
  select
    s.id,
    s.user_id,
    s.endpoint,
    s.p256dh,
    s.auth,
    s.content_encoding,
    s.reminder_time,
    s.timezone
  from public.web_push_subscriptions s
  where s.is_active = true
    and to_char(
      p_now at time zone coalesce(nullif(s.timezone, ''), 'UTC'),
      'HH24:MI'
    ) = s.reminder_time
    and coalesce(
      s.last_notified_local_date,
      date '1900-01-01'
    ) < (
      p_now at time zone coalesce(nullif(s.timezone, ''), 'UTC')
    )::date;
$$;

create or replace function public.mark_web_push_subscription_notified(
  p_subscription_id uuid,
  p_now timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.web_push_subscriptions s
  set
    last_notified_at = p_now,
    last_notified_local_date = (
      p_now at time zone coalesce(nullif(s.timezone, ''), 'UTC')
    )::date,
    last_seen_at = p_now,
    updated_at = p_now
  where s.id = p_subscription_id;
end;
$$;

grant execute on function public.get_due_web_push_subscriptions(timestamptz) to authenticated;
grant execute on function public.mark_web_push_subscription_notified(uuid, timestamptz) to authenticated;
