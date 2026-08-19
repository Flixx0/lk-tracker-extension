alter table public.prospects
  add column if not exists follow_up_sent_at timestamptz;

alter table public.prospects
  add column if not exists notes text;

alter table public.prospects
  add column if not exists replied boolean not null default false;

