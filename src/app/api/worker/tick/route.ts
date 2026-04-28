import { createAdminClient } from "@/lib/supabase/admin";
import { extractFromImage } from "@/lib/vision";
import { downloadScreenshot } from "@/lib/storage";
import { search1688 } from "@/lib/worker-client";
import { NextResponse } from "next/server";
import type { HeroData, Match } from "@/types/analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function mediaTypeFromPath(
  path: string,
): "image/png" | "image/jpeg" | "image/webp" {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function processOne() {
  const admin = createAdminClient();

  const { data: candidate, error: selErr } = await admin
    .from("product_analyses")
    .select("id, image_path")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (selErr) return { ok: false, error: selErr.message };
  if (!candidate?.image_path) return { ok: true, picked: 0 };

  const { data: locked, error: lockErr } = await admin
    .from("product_analyses")
    .update({ status: "scraping" })
    .eq("id", candidate.id)
    .eq("status", "pending")
    .select("id, image_path")
    .maybeSingle();
  if (lockErr) return { ok: false, error: lockErr.message };
  if (!locked?.image_path) {
    return { ok: true, picked: 0, reason: "race-lost" };
  }

  // Stage 1: Vision 추출
  let extracted;
  let hero: HeroData;
  try {
    const buf = await downloadScreenshot(locked.image_path);
    extracted = await extractFromImage(
      buf,
      mediaTypeFromPath(locked.image_path),
    );
    hero = {
      title: extracted.title_ko,
      price: extracted.price_krw ?? undefined,
      brand: extracted.brand ?? undefined,
      category: extracted.category_hint ?? undefined,
    };
    await admin
      .from("product_analyses")
      .update({ status: "matching", hero_data: hero, extracted })
      .eq("id", locked.id);
  } catch (e) {
    const reason = (e as Error).message;
    await admin
      .from("product_analyses")
      .update({ status: "scrape_failed", confidence_note: reason })
      .eq("id", locked.id);
    return { ok: true, id: locked.id, status: "scrape_failed", reason };
  }

  // Stage 2: 1688 검색. zh 키워드 비면 한국어 제목으로 fallback (1688이 영문 브랜드/숫자는 잡음).
  const zhParts = extracted.search_keywords_zh
    .slice(0, 3)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const query = zhParts.length > 0 ? zhParts.join(" ") : extracted.title_ko;
  if (!query.trim()) {
    await admin
      .from("product_analyses")
      .update({
        status: "completed",
        state: "unknown",
        confidence_note: "검색어 추출 실패",
      })
      .eq("id", locked.id);
    return { ok: true, id: locked.id, status: "completed", reason: "no-query" };
  }
  let items;
  try {
    items = await search1688(query);
  } catch (e) {
    const reason = (e as Error).message;
    await admin
      .from("product_analyses")
      .update({
        status: "completed",
        state: "unknown",
        confidence_note: `1688 검색 실패: ${reason}`,
      })
      .eq("id", locked.id);
    return {
      ok: true,
      id: locked.id,
      status: "completed",
      state: "unknown",
      reason,
    };
  }

  if (items.length === 0) {
    await admin
      .from("product_analyses")
      .update({
        status: "completed",
        state: "unknown",
        confidence_note: `1688 검색 결과 없음 (검색어: ${query})`,
      })
      .eq("id", locked.id);
    return { ok: true, id: locked.id, status: "completed", count: 0 };
  }

  const matches: Match[] = items.map((it) => ({
    title: it.title,
    price: it.price,
    image: it.image,
    link: it.link,
    source: "1688",
  }));

  await admin
    .from("product_analyses")
    .update({
      status: "completed",
      state: "confident_match",
      matches,
      confidence_note: null,
    })
    .eq("id", locked.id);

  return {
    ok: true,
    id: locked.id,
    status: "completed",
    state: "confident_match",
    count: matches.length,
  };
}

export async function POST() {
  const out = await processOne();
  return NextResponse.json(out);
}

export async function GET() {
  return POST();
}
