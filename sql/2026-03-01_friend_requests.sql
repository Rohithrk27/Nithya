-- Friends feature migration
-- Creates friend_requests table for social features

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for efficient queries
create index if not exists friend_requests_requester_idx on public.friend_requests (requester_id, status);
create index if not exists friend_requests_receiver_idx on public.friend_requests (receiver_id, status);
create index if not exists friend_requests_status_idx on public.friend_requests (status);

-- Prevent duplicate friend requests
create unique index if not exists friend_requests_unique_pending_idx
  on public.friend_requests (
    least(requester_id, receiver_id),
    greatest(requester_id, receiver_id)
  ) 
  where status = 'pending';

-- RLS Policies
alter table public.friend_requests enable row level security;

-- Users can see their own friend requests (both sent and received)
drop policy if exists friend_requests_select_own on public.friend_requests;
create policy friend_requests_select_own
on public.friend_requests for select
using (auth.uid() = requester_id or auth.uid() = receiver_id);

-- Users can insert their own friend requests
drop policy if exists friend_requests_insert_own on public.friend_requests;
create policy friend_requests_insert_own
on public.friend_requests for insert
with check (auth.uid() = requester_id);

-- Users can update (accept/reject) requests they receive
drop policy if exists friend_requests_update_own on public.friend_requests;
create policy friend_requests_update_own
on public.friend_requests for update
using (auth.uid() = receiver_id)
with check (auth.uid() = receiver_id);

-- Users can delete (cancel) their own sent requests
drop policy if exists friend_requests_delete_own on public.friend_requests;
create policy friend_requests_delete_own
on public.friend_requests for delete
using (auth.uid() = requester_id);
