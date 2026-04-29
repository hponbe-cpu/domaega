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
  const t0 = Date.now();
  console.log(JSON.stringify({ msg: "vision.start", id: targetId, imagePath }));
  try {
    const buf = await downloadScreenshot(imagePath);
    const t1 = Date.now();
    console.log(
      JSON.stringify({
        msg: "vision.downloaded",
        id: targetId,
        bytes: buf.length,
        ms: t1 - t0,
      }),
    );
    const extracted = await extractFromImage(buf, mediaTypeFromPath(imagePath));
    const t2 = Date.now();
    console.log(
      JSON.stringify({
        msg: "vision.extracted",
        id: targetId,
        ms: t2 - t1,
        title_ko: extracted.title_ko.slice(0, 50),
      }),
    );
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
    console.log(
      JSON.stringify({
        msg: "vision.done",
        id: targetId,
        totalMs: Date.now() - t0,
      }),
    );
    return { ok: true, id: targetId, status: "matching" };
  } catch (e) {
    const reason = (e as Error).message;
    console.log(
      JSON.stringify({
        msg: "vision.fail",
        id: targetId,
        reason,
        totalMs: Date.now() - t0,
      }),
    );
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
  // 키워드를 AND join하면 1688에서 거의 0건 나옴. 한 키워드씩 순차 시도하고
  // 첫 hit에서 멈춤. Vercel 60s budget이라 최대 2회만 시도 (평균 30s/회).
  const candidates = [
    ...extracted.search_keywords_zh.map((s) => s.trim()).filter(Boolean),
    extracted.title_ko.trim(),
  ]
    .filter((s, i, arr) => s.length > 0 && arr.indexOf(s) === i)
    .slice(0, 2);

  if (candidates.length === 0) {
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

  const tried: string[] = [];
  let items: Awaited<ReturnType<typeof search1688>> = [];
  let usedQuery = "";
  let lastError: string | null = null;
  for (const q of candidates) {
    tried.push(q);
    try {
      const r = await search1688(q);
      console.log(
        JSON.stringify({ msg: "match.try", id: row.id, q, count: r.length }),
      );
      if (r.length > 0) {
        items = r;
        usedQuery = q;
        break;
      }
    } catch (e) {
      lastError = (e as Error).message;
      console.log(
        JSON.stringify({ msg: "match.err", id: row.id, q, err: lastError }),
      );
    }
  }

  if (items.length === 0) {
    const note = lastError
      ? `1688 검색 실패: ${lastError} (시도: ${tried.join(" | ")})`
      : `1688 검색 결과 없음 (시도: ${tried.join(" | ")})`;
    await admin
      .from("product_analyses")
      .update({
        status: "completed",
        state: "unknown",
        confidence_note: note,
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
      confidence_note: `검색어: ${usedQuery}`,
    })
    .eq("id", row.id);

  return {
    ok: true,
    id: row.id,
    status: "completed",
    state: "confident_match",
    count: matches.length,
    query: usedQuery,
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
