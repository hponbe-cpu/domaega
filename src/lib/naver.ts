import type { HeroData } from "@/types/analysis";

const SEARCH_API = "https://openapi.naver.com/v1/search/shop.json";

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
  | { ok: true; hero_data: HeroData }
  | { ok: false; reason: string };

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
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
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

  const match = items.find((it) => it.productId === pid);
  if (!match) {
    return {
      ok: false,
      reason: `검색 결과 ${items.length}건 중 productId ${pid} 미일치`,
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

  return { ok: true, hero_data };
}
