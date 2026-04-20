import { createHash } from "crypto";

const NAVER_SMARTSTORE_RE =
  /^https?:\/\/(smartstore|brand)\.naver\.com\/[^/]+\/products\/\d+/i;

export type UrlValidation =
  | { ok: true; normalized: string; hash: string }
  | { ok: false; error: string };

export function validateNaverUrl(raw: string): UrlValidation {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: "유효한 URL이 아닙니다." };
  }
  if (!NAVER_SMARTSTORE_RE.test(u.toString())) {
    return {
      ok: false,
      error: "MVP은 네이버 스마트스토어 상품 URL만 지원합니다.",
    };
  }
  const normalized = `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  const hash = createHash("sha256").update(normalized).digest("hex");
  return { ok: true, normalized, hash };
}
