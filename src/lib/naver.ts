import type { HeroData } from "@/types/analysis";

const SEARCH_API = "https://openapi.naver.com/v1/search/shop.json";

// URL productId(셀러 상품 ID)와 API item productId(네이버 쇼핑 카탈로그 ID)가
// 다른 스키마라 직접 일치 불가. 제목 유사도로 best match를 고른다.
// 50-URL 평가셋 들어오면 threshold 재튜닝 — 현재는 보수적 첫 추정값.
const TITLE_SIM_THRESHOLD = 0.45;

type NaverItem = {
  title: string;
  link: string;
  image: string;
  lprice: string;
  hprice: string;
  mallName: string;
  productId: string;
  productType: string;
  brand: string;
  maker: string;
  category1: string;
  category2: string;
  category3: string;
  category4: string;
};

export type NaverStageResult =
  | { ok: true; hero_data: HeroData; top1_similarity: number }
  | { ok: false; reason: string; top1_similarity?: number };

export function extractProductId(url: string): string | null {
  const m = url.match(/\/products\/(\d+)/);
  return m?.[1] ?? null;
}

function extractTitle(html: string): string {
  const og = html.match(
    /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i,
  );
  if (og) return og[1].trim();
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return title?.[1].trim() ?? "";
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/\s*[:|]\s*네이버[^\n]*$/i, "")
    .replace(/\s*[:|]\s*스마트스토어[^\n]*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

function tokenize(s: string): string[] {
  return stripTags(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function bigrams(s: string): Set<string> {
  const norm = stripTags(s).toLowerCase().replace(/\s+/g, "");
  const set = new Set<string>();
  for (let i = 0; i < norm.length - 1; i++) {
    set.add(norm.slice(i, i + 2));
  }
  return set;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return (2 * inter) / (a.size + b.size);
}

export function similarity(a: string, b: string): number {
  const j = jaccard(tokenize(a), tokenize(b));
  const d = dice(bigrams(a), bigrams(b));
  return 0.4 * j + 0.6 * d;
}

export function findBestMatch(
  urlTitle: string,
  items: NaverItem[],
): { match: NaverItem | null; score: number } {
  let best: NaverItem | null = null;
  let bestScore = 0;
  for (const it of items) {
    const s = similarity(urlTitle, it.title);
    if (s > bestScore) {
      bestScore = s;
      best = it;
    }
  }
  return { match: best, score: bestScore };
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    },
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res.text();
}

async function searchShopping(query: string): Promise<NaverItem[]> {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 미설정");
  }
  const params = new URLSearchParams({
    query,
    display: "20",
    sort: "sim",
  });
  const res = await fetch(`${SEARCH_API}?${params}`, {
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`Search API HTTP ${res.status}`);
  }
  const data = (await res.json()) as { items?: NaverItem[] };
  return data.items ?? [];
}

export async function runNaverStage(url: string): Promise<NaverStageResult> {
  const pid = extractProductId(url);
  if (!pid) return { ok: false, reason: "Product ID 파싱 실패" };

  let html: string;
  try {
    html = await fetchHtml(url);
  } catch (e) {
    return {
      ok: false,
      reason: `상품 페이지 fetch 실패 (${(e as Error).message})`,
    };
  }

  const rawTitle = extractTitle(html);
  const title = cleanTitle(rawTitle);
  if (!title) {
    return { ok: false, reason: "상품 제목 추출 실패 (og:title 부재)" };
  }

  let items: NaverItem[];
  try {
    items = await searchShopping(title);
  } catch (e) {
    return {
      ok: false,
      reason: `검색 API 실패 (${(e as Error).message})`,
    };
  }

  const { match, score } = findBestMatch(title, items);
  if (!match || score < TITLE_SIM_THRESHOLD) {
    return {
      ok: false,
      reason: `검색 결과 ${items.length}건 중 매칭 신뢰도 부족 (top1=${score.toFixed(2)}, 임계 ${TITLE_SIM_THRESHOLD})`,
      top1_similarity: score,
    };
  }

  const lprice = parseInt(match.lprice, 10);
  const category = [
    match.category1,
    match.category2,
    match.category3,
    match.category4,
  ]
    .filter(Boolean)
    .join(" > ");

  const hero_data: HeroData = {
    title: stripTags(match.title),
    price: Number.isFinite(lprice) ? lprice : undefined,
    image: match.image || undefined,
    category: category || undefined,
    brand: match.brand || undefined,
    mallName: match.mallName || undefined,
  };

  return { ok: true, hero_data, top1_similarity: score };
}
