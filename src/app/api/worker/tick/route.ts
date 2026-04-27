import { createAdminClient } from "@/lib/supabase/admin";
import { runNaverStage } from "@/lib/naver";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function processOne() {
  const admin = createAdminClient();

  const { data: candidate, error: selErr } = await admin
    .from("product_analyses")
    .select("id, url")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (selErr) return { ok: false, error: selErr.message };
  if (!candidate) return { ok: true, picked: 0 };

  const { data: locked, error: lockErr } = await admin
    .from("product_analyses")
    .update({ status: "scraping" })
    .eq("id", candidate.id)
    .eq("status", "pending")
    .select("id, url")
    .maybeSingle();
  if (lockErr) return { ok: false, error: lockErr.message };
  if (!locked) return { ok: true, picked: 0, reason: "race-lost" };

  const result = await runNaverStage(locked.url);

  if (!result.ok) {
    const isMatchFailure = result.top1_similarity !== undefined;
    await admin
      .from("product_analyses")
      .update({
        status: isMatchFailure ? "no_match_found" : "scrape_failed",
        confidence_note: result.reason,
        top1_similarity: result.top1_similarity ?? null,
      })
      .eq("id", locked.id);
    return {
      ok: true,
      id: locked.id,
      status: isMatchFailure ? "no_match_found" : "scrape_failed",
      reason: result.reason,
    };
  }

  await admin
    .from("product_analyses")
    .update({
      status: "completed",
      state: "unknown",
      hero_data: result.hero_data,
      top1_similarity: result.top1_similarity,
      confidence_note:
        "1688 도매 매칭은 다음 업데이트에서 활성화됩니다. 네이버 상품 정보만 표시됩니다.",
    })
    .eq("id", locked.id);

  return { ok: true, id: locked.id, status: "completed" };
}

export async function POST() {
  const out = await processOne();
  return NextResponse.json(out);
}

export async function GET() {
  return POST();
}
