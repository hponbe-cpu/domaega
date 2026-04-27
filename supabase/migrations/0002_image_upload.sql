-- 0002_image_upload: 이미지 업로드 + Vision 추출 기반으로 흐름 전환.
-- URL 직접 fetch가 Naver 차단으로 막혀, 사용자 캡처 + Claude vision으로 우회.

-- url / url_hash는 더 이상 필수 아님.
alter table product_analyses alter column url drop not null;
alter table product_analyses alter column url_hash drop not null;

-- url_hash unique 인덱스를 partial로 재작성 (null 허용).
drop index if exists idx_product_analyses_url_hash;
create unique index if not exists idx_product_analyses_url_hash
  on product_analyses(url_hash)
  where url_hash is not null;

-- 이미지 업로드 + Vision 추출 결과.
alter table product_analyses add column if not exists image_path text;
alter table product_analyses add column if not exists image_hash text;
alter table product_analyses add column if not exists extracted jsonb;

create unique index if not exists idx_product_analyses_image_hash
  on product_analyses(image_hash)
  where image_hash is not null;

-- 캡처 저장용 private 버킷. service_role로만 read/write (RLS 우회).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'screenshots',
  'screenshots',
  false,
  5242880,
  array['image/png','image/jpeg','image/webp']
)
on conflict (id) do nothing;
