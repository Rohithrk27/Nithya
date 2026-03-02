-- Profile access hardening for leaderboard rollout.
-- Run in Supabase SQL editor

-- Restrict profile reads to owner. Leaderboard should read from public_profiles.
drop policy if exists profiles_select_all on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
on public.profiles for select
to authenticated
using (auth.uid() = id);

-- Make sure user can still only update their own profile
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);
