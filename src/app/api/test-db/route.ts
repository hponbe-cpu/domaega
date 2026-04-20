import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export async function GET() {
  const anon = createClient();
  const admin = createAdminClient();
  const testId = `test_${Date.now().toString(36)}`;

  const { error: insertErr } = await admin
    .from("product_analyses")
    .insert({
      id: testId,
      url: "https://example.com/test",
      url_hash: testId,
      status: "pending",
    });
  if (insertErr) {
    return NextResponse.json(
      { ok: false, step: "admin_insert", error: insertErr.message },
      { status: 500 },
    );
  }

  const { count, error: readErr } = await anon
    .from("product_analyses")
    .select("*", { count: "exact", head: true });
  if (readErr) {
    return NextResponse.json(
      { ok: false, step: "anon_read", error: readErr.message },
      { status: 500 },
    );
  }

  const { error: deleteErr } = await admin
    .from("product_analyses")
    .delete()
    .eq("id", testId);
  if (deleteErr) {
    return NextResponse.json(
      { ok: false, step: "admin_delete", error: deleteErr.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, rows_during_test: count ?? 0 });
}
