import { createAdminClient } from "@/lib/supabase/admin";
import { extractFromImage } from "@/lib/vision";
import { downloadScreenshot } from "@/lib/storage";
import { NextResponse } from "next/server";
import type { HeroData } from "@/types/analysis";

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

  try {
    const buf = await downloadScreenshot(locked.image_path);
    const extracted = await extractFromImage(
      buf,
      mediaTypeFromPath(locked.image_path),
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
        status: "completed",
        state: "unknown",
        hero_data: hero,
        extracted,
        confidence_note:
          "1688 도매 매칭은 다음 업데이트에서 활성화됩니다. 현재는 추출 결과만 표시됩니다.",
      })
      .eq("id", locked.id);
    return { ok: true, id: locked.id, status: "completed" };
  } catch (e) {
    const reason = (e as Error).message;
    await admin
      .from("product_analyses")
      .update({
        status: "scrape_failed",
        confidence_note: reason,
      })
      .eq("id", locked.id);
    return { ok: true, id: locked.id, status: "scrape_failed", reason };
  }
}

export async function POST() {
  const out = await processOne();
  return NextResponse.json(out);
}

export async function GET() {
  return POST();
}
