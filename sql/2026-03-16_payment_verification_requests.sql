-- Donation payment verification requests submitted by users.

create table if not exists public.payment_verification_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_inr numeric(10,2) not null check (amount_inr > 0),
  utr_reference text not null,
  payer_name text,
  payment_app text,
  paid_at timestamptz not null default now(),
  notes text,
  proof_path text,
  status text not null default 'pending'
    check (status in ('pending', 'reviewed', 'verified', 'rejected')),
  admin_reply text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, utr_reference)
);

alter table if exists public.payment_verification_requests
  add column if not exists proof_path text;

create index if not exists payment_verification_requests_user_created_idx
  on public.payment_verification_requests (user_id, created_at desc);
create index if not exists payment_verification_requests_status_created_idx
  on public.payment_verification_requests (status, created_at desc);

create or replace function public.touch_payment_verification_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_payment_verification_updated_at on public.payment_verification_requests;
create trigger trg_touch_payment_verification_updated_at
before update on public.payment_verification_requests
for each row
execute function public.touch_payment_verification_updated_at();

alter table public.payment_verification_requests enable row level security;

drop policy if exists payment_verification_select_own on public.payment_verification_requests;
create policy payment_verification_select_own
on public.payment_verification_requests
for select
using (auth.uid() = user_id);

drop policy if exists payment_verification_insert_own on public.payment_verification_requests;
create policy payment_verification_insert_own
on public.payment_verification_requests
for insert
with check (auth.uid() = user_id);

grant select, insert on public.payment_verification_requests to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists payment_proofs_insert_own on storage.objects;
create policy payment_proofs_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists payment_proofs_select_own on storage.objects;
create policy payment_proofs_select_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists payment_proofs_delete_own on storage.objects;
create policy payment_proofs_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'payment-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
);
