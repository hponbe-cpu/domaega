# TODOS

## Blockers surfaced 2026-04-20 during worker skeleton

- **Naver 스마트스토어 직접 HTML fetch 불가 (edge 429)** — 디자인 doc §Architecture의 "a2. OG title 가볍게 fetch (no proxy, regular fetch)" 가정이 실측에서 깨짐. 일반 fetch, 모바일 UA, microlink.io third-party proxy, 심지어 real Chromium (gstack browse)까지 모두 429. IP-scope rate limit 추정.
  - Impact: `runNaverStage()`의 `fetchHtml()` 단계가 거의 항상 실패. 현재 scrape_failed 경로로만 결과 나옴.
  - **Fix (필수, Weekend 2 초두):** Railway HTTP service 위에 Playwright + residential proxy ($50/월 BrightData starter) 구성. 디자인 doc이 1688 용으로 잡았던 워커를 Naver에도 쓰는 것으로 확장.
  - 코드는 Railway 워커가 붙으면 plug-and-play (`/api/worker/tick`의 `runNaverStage(url)` 호출부만 워커 서비스로 이관).

- **Naver Shopping Search API의 productId ≠ Smartstore URL productId** — API `items[].productId`는 Naver Shopping 카탈로그 ID (예: 84414274193), URL productId는 셀러 상품 ID (예: 9207641410). 서로 다른 스키마. link 필드도 `main/products/…` 으로 정규화돼 직접 매칭 불가.
  - Impact: 디자인 doc §a4 ("link에서 product ID 일치하는 행 찾아") 전략 수정 필요.
  - **Fix:** (1) OG title 기반 fuzzy 매칭 (레벤슈타인 or cosine sim on title), (2) mallName + lprice 근사 교차검증, (3) Vision 기반 이미지 유사도 top-N 재랭크. OG title이 정확하면 top-1 매칭 충분한 경우가 많음 — 먼저 해보고 부족하면 (2)(3) 추가.

## Deferred from /plan-eng-review (2026-04-17)

### P2 (post-MVP)

- **쿠팡 / 11번가 / 지마켓 확장** — 각 쇼핑몰마다 페이지 구조·API 대응 필요. PMF 시그널 확인 후 착수.
  - Depends on: Weekend 2 MVP 안정화, 주간 unique analyses 100+ 달성
  - Context: 네이버 스마트스토어 단일로 MVP 런칭. Approach 확장의 첫 카드.

- **매칭 피드백 학습 루프** — 이메일 매직 링크 로그인 + 유저 투표 ("매칭 맞음/틀림"). 프롬프트 튜닝 신호로 활용.
  - Depends on: Supabase Auth 도입, 50-URL 평가셋 확장
  - Context: MVP은 self-labeled 50-URL로 측정. 실제 운영 품질은 유저 피드백이 유일 신호.

- **관리자 takedown 리뷰 대시보드** — 현재 auto-hide는 악의적 경쟁자에 약점. Admin이 24h 내 리뷰 + 영구 hide vs 복구 결정.
  - Depends on: Supabase Auth, 관리자 롤
  - Context: MVP은 auto-hide + 본인 이의제기 이메일 창구. 이의제기가 많아지면 필수.

### P3 (future)

- **Chrome extension MVP** — outside voice 권고 경로. 법적으로 최적. Web 경로 불가 시 복귀, 또는 Web 성공 시 "power user" 레인으로 추가.
  - Depends on: Web MVP 검증 결과 (W0 게이트, Weekend 1/2 실측)
  - Context: 즉각성·바이럴 trade-off 때문에 MVP에선 Web 선택. Extension은 법적 안전·지속 사용성 유리.

- **타오바오 / AliExpress 확장** — 1688 외 도매 소스 추가.
  - Depends on: 1688 MVP 매칭 품질 recall@5 ≥ 0.7 안정화
  - Context: 상품에 따라 1688보다 타오바오·Ali가 나은 경우 있음. 커버리지 확장.

- **가격 추적 / 재체크 cron** — 주간 가격 재수집, "가격 변화 기록" 기능.
  - Depends on: pgvector 또는 히스토리 테이블 설계
  - Context: "내가 본 상품의 도매가는 어제보다 올랐나?" UX.

- **pgvector 임베딩 캐시** — 유사 상품 cross-lookup. MVP 규모에선 불필요.
  - Depends on: 월 분석 건수 10,000+ 달성
  - Context: 현재 url_hash dedup로 충분. 스케일 시점에 도입.

- **커뮤니티 댓글** — "저도 이거 샀었는데 1/5였음" 경험담. 바이럴 강화.
  - Depends on: 관리자 모더레이션 플로, 셀러 반발 대응 정책
  - Context: 공유 DNA를 강화하지만 모더레이션 비용 높음. 운영 리소스 + 법적 리스크 확대.
