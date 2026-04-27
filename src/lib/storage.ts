import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "screenshots";

export async function uploadScreenshot(
  path: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType, upsert: true });
  if (error) throw new Error(`Storage 업로드 실패: ${error.message}`);
}

export async function downloadScreenshot(path: string): Promise<Buffer> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error) throw new Error(`Storage 다운로드 실패: ${error.message}`);
  return Buffer.from(await data.arrayBuffer());
}
