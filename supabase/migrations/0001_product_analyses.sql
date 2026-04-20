-- product_analyses: core analysis record per submitted URL.
-- Design doc §Data Model. MVP scope: no auth, worker writes via service_role,
-- public reads restricted to non-hidden, non-expired rows.

create table if not exists product_analyses (
  id                text primary key,               -- short ulid, URL-safe 12 chars
  url               text not null,                  -- original submitted URL
  url_hash          text not null,                  -- sha256(normalized_url) for dedup
  status            text not null check (status in (
    'pending', 'scraping', 'matching', 'completed',
    'scrape_failed', 'no_match_found', 'legal_hidden', 'dead_letter'
  )),
  state             text check (state in (
    'confident_match', 'likely_domestic', 'unknown'
  )),
  hero_data         jsonb,                          -- {title, price, image, category, brand, mallName}
  matches           jsonb,                          -- [{image, price, vendor, similarity, link, source}, ...]
  top1_similarity   numeric,
  confidence_note   text,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '90 days'),
  legal_hidden_at   timestamptz,
  ip_hash           text,                           -- sha256(ip + salt) for rate-limit
  view_count        int not null default 0
);

create unique index if not exists idx_product_analyses_url_hash
  on product_analyses(url_hash);

create index if not exists idx_product_analyses_expires
  on product_analyses(expires_at)
  where legal_hidden_at is null;

create index if not exists idx_product_analyses_ip_hash_created
  on product_analyses(ip_hash, created_at);

-- RLS: deny by default, allow anon read of non-hidden non-expired rows.
-- Worker writes happen via service_role key which bypasses RLS.
alter table product_analyses enable row level security;

drop policy if exists "anon_read_visible" on product_analyses;
create policy "anon_read_visible" on product_analyses
  for select
  to anon
  using (legal_hidden_at is null and expires_at > now());

-- Realtime: enable streaming for status + matches updates on /p/{id}.
alter publication supabase_realtime add table product_analyses;
