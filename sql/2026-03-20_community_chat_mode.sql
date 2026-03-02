-- Community chat mode
-- Depends on: 2026-03-20_weekly_insights_best_worst_distinct.sql

set search_path = public, extensions;

create table if not exists public.community_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  room text not null default 'global' check (room in ('global')),
  sender_label text not null default 'Anonymous',
  message text not null check (char_length(btrim(message)) between 1 and 500),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists community_chat_messages_room_created_idx
  on public.community_chat_messages (room, created_at desc);

create index if not exists community_chat_messages_user_created_idx
  on public.community_chat_messages (user_id, created_at desc);

drop trigger if exists trg_touch_community_chat_messages_updated_at on public.community_chat_messages;
create trigger trg_touch_community_chat_messages_updated_at
before update on public.community_chat_messages
for each row
execute function public.touch_generic_updated_at();

alter table public.community_chat_messages enable row level security;

drop policy if exists community_chat_messages_select_authenticated on public.community_chat_messages;
create policy community_chat_messages_select_authenticated
on public.community_chat_messages for select
using (auth.uid() is not null);

drop policy if exists community_chat_messages_insert_own on public.community_chat_messages;
create policy community_chat_messages_insert_own
on public.community_chat_messages for insert
with check (auth.uid() = user_id);

drop policy if exists community_chat_messages_update_own on public.community_chat_messages;
create policy community_chat_messages_update_own
on public.community_chat_messages for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists community_chat_messages_delete_own on public.community_chat_messages;
create policy community_chat_messages_delete_own
on public.community_chat_messages for delete
using (auth.uid() = user_id);

create or replace function public.send_community_chat_message(
  p_user_id uuid,
  p_message text,
  p_room text default 'global',
  p_metadata jsonb default '{}'::jsonb
)
returns public.community_chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room text := lower(nullif(btrim(coalesce(p_room, '')), ''));
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_profile_json jsonb := '{}'::jsonb;
  v_sender_label text;
  v_row public.community_chat_messages%rowtype;
begin
  if auth.uid() <> p_user_id then
    raise exception 'forbidden';
  end if;

  if v_message is null then
    raise exception 'message required';
  end if;

  if char_length(v_message) > 500 then
    raise exception 'message too long';
  end if;

  v_room := coalesce(v_room, 'global');
  if v_room <> 'global' then
    raise exception 'invalid room';
  end if;

  -- Basic anti-spam: one message every 2 seconds per user.
  if exists (
    select 1
    from public.community_chat_messages m
    where m.user_id = p_user_id
      and m.created_at >= now() - interval '2 seconds'
    limit 1
  ) then
    raise exception 'message rate limited';
  end if;

  select to_jsonb(p)
  into v_profile_json
  from public.profiles p
  where p.id = p_user_id
  limit 1;

  v_sender_label := coalesce(
    nullif(v_profile_json->>'user_code', ''),
    nullif(v_profile_json->>'name', ''),
    'User-' || left(replace(p_user_id::text, '-', ''), 6)
  );

  if char_length(v_sender_label) > 40 then
    v_sender_label := left(v_sender_label, 40);
  end if;

  insert into public.community_chat_messages (
    user_id,
    room,
    sender_label,
    message,
    metadata
  )
  values (
    p_user_id,
    v_room,
    v_sender_label,
    v_message,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning *
  into v_row;

  return v_row;
end;
$$;

grant execute on function public.send_community_chat_message(uuid, text, text, jsonb) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and exists (
       select 1
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'community_chat_messages'
     )
     and not exists (
       select 1
       from pg_publication_tables pt
       where pt.pubname = 'supabase_realtime'
         and pt.schemaname = 'public'
         and pt.tablename = 'community_chat_messages'
     ) then
    execute 'alter publication supabase_realtime add table public.community_chat_messages';
  end if;
end;
$$;

notify pgrst, 'reload schema';
