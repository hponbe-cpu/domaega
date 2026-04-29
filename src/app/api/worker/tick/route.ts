import { createAdminClient } from "@/lib/supabase/admin";
import { extractFromImage, VISION_RETRY_TAG } from "@/lib/vision";
import { downloadScreenshot } from "@/lib/storage";
import { search1688 } from "@/lib/worker-client";
import { NextResponse } from "next/server";
import type { HeroData, Match, Extracted } from "@/types/analysis";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_VISION_RETRIES = 3;
const VISION_RETRY_BACKOFF_MS = [30_000, 120_000, 300_000];
const STUCK_SCRAPING_MS = 90_000;

function mediaTypeFromPath(
  path: string,
): "image/png" | "image/jpeg" | "image/webp" {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

function nextVisionAttempt(retryCount: number): string {
  const delay =
    VISION_RETRY_BACKOFF_MS[
      Math.min(retryCount, VISION_RETRY_BACKOFF_MS.length - 1)
    ];
  return new Date(Date.now() + delay).toISOString();
}

async function processVisionRow(
  admin: SupabaseClient,
  targetId: string,
  imagePath: string,
  retryCount: number,
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
      .update({
        status: "matching",
        hero_data: hero,
        extracted,
        processing_started_at: null,
        last_error: null,
      })
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
    const isTransient = reason.startsWith(VISION_RETRY_TAG);
    const canRetry = isTransient && retryCount < MAX_VISION_RETRIES;
    const nextRetryCount = retryCount + 1;

    console.log(
      JSON.stringify({
        msg: "vision.fail",
        id: targetId,
        reason,
        retryCount,
        canRetry,
        totalMs: Date.now() - t0,
      }),
    );

    if (canRetry) {
      await admin
        .from("product_analyses")
        .update({
          status: "pending",
          retry_count: nextRetryCount,
          next_attempt_at: nextVisionAttempt(retryCount),
          processing_started_at: null,
          last_error: reason,
          confidence_note: `Retry scheduled (${nextRetryCount}/${MAX_VISION_RETRIES}): ${reason}`,
        })
        .eq("id", targetId);

      return {
        ok: true,
        id: targetId,
        status: "pending",
        retry: true,
        retryCount: nextRetryCount,
      };
    }

    await admin
      .from("product_analyses")
      .update({
        status: "scrape_failed",
        processing_started_at: null,
        last_error: reason,
        confidence_note: reason,
      })
      .eq("id", targetId);

    return { ok: true, id: targetId, status: "scrape_failed", reason };
  }
}

async function runPendingStage(admin: SupabaseClient) {
  const nowIso = new Date().toISOString();
  const { data: pending } = await admin
    .from("product_analyses")
    .select("id, image_path, retry_count")
    .eq("status", "pending")
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!pending?.image_path) return null;

  const processingStartedAt = new Date().toISOString();
  const { data: locked } = await admin
    .from("product_analyses")
    .update({
      status: "scraping",
      processing_started_at: processingStartedAt,
      last_error: null,
    })
    .eq("id", pending.id)
    .eq("status", "pending")
    .lte("next_attempt_at", nowIso)
    .select("id, image_path, retry_count")
    .maybeSingle();

  if (!locked?.image_path) return { ok: true, picked: 0, reason: "race-lost" };

  return processVisionRow(
    admin,
    locked.id,
    locked.image_path,
    locked.retry_count ?? 0,
  );
}

async function runStuckScrapingRecovery(admin: SupabaseClient) {
  const staleBefore = new Date(Date.now() - STUCK_SCRAPING_MS).toISOString();
  const staleFilter = `processing_started_at.is.null,processing_started_at.lte.${staleBefore}`;
  const { data: stuck } = await admin
    .from("product_analyses")
    .select("id, image_path, retry_count")
    .eq("status", "scraping")
    .or(staleFilter)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!stuck?.image_path) return null;

  const processingStartedAt = new Date().toISOString();
  const { data: locked } = await admin
    .from("product_analyses")
    .update({ processing_started_at: processingStartedAt })
    .eq("id", stuck.id)
    .eq("status", "scraping")
    .or(staleFilter)
    .select("id, image_path, retry_count")
    .maybeSingle();

  if (!locked?.image_path) return { ok: true, picked: 0, reason: "race-lost" };

  return processVisionRow(
    admin,
    locked.id,
    locked.image_path,
    locked.retry_count ?? 0,
  );
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
        confidence_note: "No search query extracted",
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
      ? `1688 search failed: ${lastError} (tried: ${tried.join(" | ")})`
      : `No 1688 results (tried: ${tried.join(" | ")})`;
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
      confidence_note: `Search query: ${usedQuery}`,
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
