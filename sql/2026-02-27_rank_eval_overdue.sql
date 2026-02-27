-- Adds daily penalty tracking for overdue rank evaluations
alter table public.rank_evaluations
  add column if not exists last_penalty_date date;
