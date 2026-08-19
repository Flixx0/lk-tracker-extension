alter table public.prospects
  add column if not exists follow_up_sent_at timestamptz;
