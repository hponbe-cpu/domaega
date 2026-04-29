-- Add bounded retry and worker lock metadata for long-running vision calls.

alter table product_analyses
  add column if not exists retry_count int not null default 0,
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists processing_started_at timestamptz,
  add column if not exists last_error text;

create index if not exists idx_product_analyses_pending_next_attempt
  on product_analyses(next_attempt_at, created_at)
  where status = 'pending';

create index if not exists idx_product_analyses_scraping_started
  on product_analyses(processing_started_at, created_at)
  where status = 'scraping';
