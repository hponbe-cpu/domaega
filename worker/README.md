# Codingagent worker

Naver Smartstore 페이지를 residential proxy 통한 헤드리스 Chromium으로 스크레이프해 og:title을 반환한다. Vercel 서버리스에선 Playwright + Chromium이 무거워 Railway에 별도 서비스로 분리.

## Endpoints

- `GET /healthz` — Railway health check
- `POST /scrape` — body `{ "url": "https://smartstore.naver.com/.../products/1234" }` → `{ ok: true, og_title, status }` 또는 `{ ok: false, reason }`. 요청에 `Authorization: Bearer ${WORKER_SHARED_SECRET}` 필수.

## Required env

- `PORT` (Railway가 주입, 로컬 기본 8080)
- `WORKER_SHARED_SECRET` — Next.js 측과 동일 값
- `PROXY_HOST` / `PROXY_PORT` / `PROXY_USER` / `PROXY_PASS` — IPRoyal residential
- `SCRAPE_TIMEOUT_MS` (선택, 기본 20000)

## Local

```
cd worker
npm install
cp .env.example .env
# .env에 자격증명 채우고
npm run dev
```

테스트:
```
curl -X POST http://localhost:8080/scrape \
  -H "Authorization: Bearer $WORKER_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://smartstore.naver.com/.../products/1234"}'
```

## Railway 배포

1. Railway → New Service → Deploy from GitHub repo
2. Settings → Root Directory: `worker`
3. Builder: Dockerfile (자동 감지)
4. Variables 탭에서 위 env 모두 채우기 (특히 `WORKER_SHARED_SECRET`은 `openssl rand -hex 32`로 생성)
5. Networking → Generate Domain → Public URL 발급. 이걸 Next.js 쪽 `WORKER_URL`로 꽂는다.
