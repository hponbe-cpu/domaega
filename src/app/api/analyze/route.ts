import { createAdminClient } from "@/lib/supabase/admin";
import { uploadScreenshot } from "@/lib/storage";
import { newAnalysisId } from "@/lib/id";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 30;

const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json(
      { error: "form-data 형식이 필요합니다." },
      { status: 400 },
    );
  }
  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "image 필드(파일)가 필요합니다." },
      { status: 400 },
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "빈 파일입니다." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `파일이 너무 큽니다 (${MAX_BYTES / 1024 / 1024}MB 이하).` },
      { status: 413 },
    );
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { error: "PNG / JPEG / WebP만 지원합니다." },
      { status: 400 },
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const imageHash = createHash("sha256").update(buf).digest("hex");
  const ext =
    file.type === "image/png"
      ? "png"
      : file.type === "image/jpeg"
        ? "jpg"
        : "webp";
  const path = `${imageHash}.${ext}`;

  const admin = createAdminClient();

  const { data: existing, error: lookupErr } = await admin
    .from("product_analyses")
    .select("id, status")
    .eq("image_hash", imageHash)
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

  try {
    await uploadScreenshot(path, buf, file.type);
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  const salt = process.env.IP_HASH_SALT ?? "dev-salt";
  const ipHash = createHash("sha256").update(ip + salt).digest("hex");

  const id = newAnalysisId();
  const { error: insertErr } = await admin.from("product_analyses").insert({
    id,
    image_path: path,
    image_hash: imageHash,
    status: "pending",
    ip_hash: ipHash,
  });

  if (insertErr) {
    if (insertErr.code === "23505") {
      const { data: raced } = await admin
        .from("product_analyses")
        .select("id")
        .eq("image_hash", imageHash)
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

  return NextResponse.json({ id, permalink: `/p/${id}` }, { status: 201 });
}
