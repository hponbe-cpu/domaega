import { createAdminClient } from "@/lib/supabase/admin";
import { validateNaverUrl } from "@/lib/url";
import { newAnalysisId } from "@/lib/id";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.url !== "string") {
    return NextResponse.json(
      { error: "url 필드가 필요합니다." },
      { status: 400 },
    );
  }

  const v = validateNaverUrl(body.url);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: existing, error: lookupErr } = await admin
    .from("product_analyses")
    .select("id, status")
    .eq("url_hash", v.hash)
    .maybeSingle();
  if (lookupErr) {
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }
  if (existing) {
    if (existing.status === "legal_hidden") {
      return NextResponse.json(
        { error: "이 상품은 요청에 따라 노출이 중단되었습니다." },
        { status: 410 },
      );
    }
    return NextResponse.json({
      id: existing.id,
      permalink: `/p/${existing.id}`,
      cached: true,
    });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const salt = process.env.IP_HASH_SALT ?? "dev-salt";
  const ipHash = createHash("sha256").update(ip + salt).digest("hex");

  const id = newAnalysisId();
  const { error: insertErr } = await admin.from("product_analyses").insert({
    id,
    url: v.normalized,
    url_hash: v.hash,
    status: "pending",
    ip_hash: ipHash,
  });

  if (insertErr) {
    // Race on url_hash unique index — someone inserted between our lookup and insert.
    if (insertErr.code === "23505") {
      const { data: raced } = await admin
        .from("product_analyses")
        .select("id")
        .eq("url_hash", v.hash)
        .single();
      if (raced) {
        return NextResponse.json({
          id: raced.id,
          permalink: `/p/${raced.id}`,
          cached: true,
        });
      }
    }
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  return NextResponse.json(
    { id, permalink: `/p/${id}` },
    { status: 201 },
  );
}
