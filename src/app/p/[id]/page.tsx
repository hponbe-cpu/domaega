import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ResultView from "./ResultView";
import type { Analysis } from "@/types/analysis";

export default async function Page({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data } = await supabase
    .from("product_analyses")
    .select(
      "id, url, image_path, extracted, status, state, hero_data, matches, top1_similarity, confidence_note, retry_count, next_attempt_at, processing_started_at, last_error, created_at, view_count",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (!data) notFound();

  return <ResultView initial={data as Analysis} />;
}
