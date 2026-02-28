-- Public leaderboard - allows viewing all profiles
-- Run in Supabase SQL editor

-- Allow anyone to view profiles (needed for leaderboard)
drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all
on public.profiles for select
to authenticated, anon
using (true);

-- Make sure user can still only update their own profile
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);
