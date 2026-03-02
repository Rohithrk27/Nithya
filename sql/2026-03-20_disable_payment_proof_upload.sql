-- Disable payment image upload (UI + DB enforcement companion)
-- Depends on: 2026-03-20_rls_and_index_performance_guardrails.sql

set search_path = public, extensions;

-- Remove direct client upload capability for payment proof images.
drop policy if exists payment_proofs_insert_own on storage.objects;

-- Enforce no new proof path values, even if a client sends one directly.
create or replace function public.strip_payment_proof_path()
returns trigger
language plpgsql
as $$
begin
  new.proof_path := null;
  return new;
end;
$$;

do $$
begin
  if to_regclass('public.payment_verification_requests') is null then
    return;
  end if;

  drop trigger if exists trg_strip_payment_proof_path on public.payment_verification_requests;
  create trigger trg_strip_payment_proof_path
  before insert or update of proof_path
  on public.payment_verification_requests
  for each row
  execute function public.strip_payment_proof_path();
end;
$$;

notify pgrst, 'reload schema';
