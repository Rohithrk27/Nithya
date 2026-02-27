-- Server-side user_code generation for profiles
-- Run in Supabase SQL editor

create extension if not exists pgcrypto;

create or replace function public.generate_user_code()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
  i int;
begin
  code := 'HNTR-';
  for i in 1..6 loop
    code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  end loop;
  return code;
end;
$$;

create or replace function public.set_profile_user_code()
returns trigger
language plpgsql
as $$
declare
  candidate text;
begin
  if new.user_code is not null and btrim(new.user_code) <> '' then
    new.user_code := upper(new.user_code);
    return new;
  end if;

  loop
    candidate := public.generate_user_code();
    exit when not exists (
      select 1
      from public.profiles p
      where upper(p.user_code) = upper(candidate)
    );
  end loop;

  new.user_code := candidate;
  return new;
end;
$$;

alter table public.profiles add column if not exists user_code text;

update public.profiles
set user_code = public.generate_user_code()
where user_code is null or btrim(user_code) = '';

alter table public.profiles alter column user_code set not null;
create unique index if not exists profiles_user_code_unique_idx
on public.profiles ((upper(user_code)));

drop trigger if exists trg_profiles_set_user_code on public.profiles;
create trigger trg_profiles_set_user_code
before insert or update of user_code on public.profiles
for each row
execute function public.set_profile_user_code();
