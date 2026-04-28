import { createAdminClient } from "@/lib/supabase/admin";
import { extractFromImage } from "@/lib/vision";
import { downloadScreenshot } from "@/lib/storage";
import { search1688 } from "@/lib/worker-client";
import { NextResponse } from "next/server";
import type { HeroData, Match, Extracted } from "@/types/analysis";
import type { SupabaseClient } from "@supabase/supabase-js";

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

async function processVisionRow(
  admin: SupabaseClient,
  targetId: string,
  imagePath: string,
) {
  try {
    const buf = await downloadScreenshot(imagePath);
    const extracted = await extractFromImage(buf, mediaTypeFromPath(imagePath));
    const hero: HeroData = {
      title: extracted.title_ko,
      price: extracted.price_krw ?? undefined,
      brand: extracted.brand ?? undefined,
      category: extracted.category_hint ?? undefined,
    };
    await admin
      .from("product_analyses")
      .update({ status: "matching", hero_data: hero, extracted })
      .eq("id", targetId);
    return { ok: true, id: targetId, status: "matching" };
  } catch (e) {
    const reason = (e as Error).message;
    await admin
      .from("product_analyses")
      .update({ status: "scrape_failed", confidence_note: reason })
      .eq("id", targetId);
    return { ok: true, id: targetId, status: "scrape_failed", reason };
  }
}

async function runPendingStage(admin: SupabaseClient) {
  const { data: pending } = await admin
    .from("product_analyses")
    .select("id, image_path")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!pending?.image_path) return null;
  const { data: locked } = await admin
    .from("product_analyses")
    .update({ status: "scraping" })
    .eq("id", pending.id)
    .eq("status", "pending")
    .select("id, image_path")
    .maybeSingle();
  if (!locked?.image_path) return { ok: true, picked: 0, reason: "race-lost" };
  return processVisionRow(admin, locked.id, locked.image_path);
}

async function runStuckScrapingRecovery(admin: SupabaseClient) {
  const { data: stuck } = await admin
    .from("product_analyses")
    .select("id, image_path")
    .eq("status", "scraping")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!stuck?.image_path) return null;
  return processVisionRow(admin, stuck.id, stuck.image_path);
}

async function runMatchingStage(admin: SupabaseClient) {
  const { data: row } = await admin
    .from("product_analyses")
    .select("id, extracted")
    .eq("status", "matching")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!row?.extracted) return null;

  const extracted = row.extracted as Extracted;
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
      .eq("id", row.id);
    return { ok: true, id: row.id, status: "completed", reason: "no-query" };
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
      .eq("id", row.id);
    return { ok: true, id: row.id, status: "completed", reason };
  }

  if (items.length === 0) {
    await admin
      .from("product_analyses")
      .update({
        status: "completed",
        state: "unknown",
        confidence_note: `1688 검색 결과 없음 (검색어: ${query})`,
      })
      .eq("id", row.id);
    return { ok: true, id: row.id, status: "completed", count: 0 };
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
    .eq("id", row.id);

  return {
    ok: true,
    id: row.id,
    status: "completed",
    state: "confident_match",
    count: matches.length,
  };
}

async function processOne() {
  const admin = createAdminClient();
  // 우선순위: pending → matching → 옛 stuck scraping 회수.
  // matching이 stuck 회수보다 우선이라 옛 실패 행이 새 매칭 흐름을 막지 않음.
  const pendingOut = await runPendingStage(admin);
  if (pendingOut) return pendingOut;
  const matchingOut = await runMatchingStage(admin);
  if (matchingOut) return matchingOut;
  const stuckOut = await runStuckScrapingRecovery(admin);
  if (stuckOut) return stuckOut;
  return { ok: true, picked: 0 };
}

export async function POST() {
  const out = await processOne();
  return NextResponse.json(out);
}

export async function GET() {
  return POST();
}
