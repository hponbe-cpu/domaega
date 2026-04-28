import OpenAI from "openai";
import { z } from "zod";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
  timeout: 30_000,
  maxRetries: 0,
});

const MODEL = process.env.OPENROUTER_MODEL ?? "google/gemma-4-31b-it:free";

// 모델이 nullable 필드를 null로 명시 안 하거나 다른 타입(배열/문자열-숫자 등)으로 반환하는 경우가
// 있어 매우 관대한 union + transform으로 정규화. 무료 모델일수록 형식 안정성이 떨어짐.
const nullableString = z
  .union([z.string(), z.array(z.string()), z.null(), z.undefined()])
  .transform((v) => {
    if (typeof v === "string") return v.trim() || null;
    if (Array.isArray(v)) return v.filter(Boolean).join(", ") || null;
    return null;
  });
const nullableNumber = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
      const n = parseFloat(v.replace(/[^0-9.-]/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  });

export const ExtractedSchema = z.object({
  title_ko: z.string(),
  brand: nullableString,
  price_krw: nullableNumber,
  category_hint: nullableString,
  search_keywords_zh: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  confidence: z
    .enum(["high", "medium", "low"])
    .nullish()
    .transform((v) => v ?? "medium"),
  notes: nullableString,
});

export type Extracted = z.infer<typeof ExtractedSchema>;

const SYSTEM_PROMPT = `당신은 한국 온라인 쇼핑몰 캡처 화면에서 상품 정보를 추출하는 전문가입니다.

캡처는 네이버 스마트스토어, 쿠팡, 11번가, 지마켓, 다나와, 인스타그램 DM 등에서 온 한국 쇼핑 화면입니다.

추출 규칙:
- 상품 제목은 광고 카피나 옵션 텍스트가 아닌 본문에 표기된 정식 명칭을 사용합니다.
- 가격은 판매가(현재 결제 시 청구되는 가격)를 추출합니다. 정가/할인가 함께 보이면 할인가를 사용합니다. 옵션별 추가금은 무시합니다. 숫자만 반환(원 단위, 콤마 없이).
- 브랜드는 셀러명(스토어 이름)이 아닌 제조사 또는 상품 브랜드입니다. 명확하지 않으면 null.
- search_keywords_zh는 이 상품을 1688에서 찾기 위한 중국어 키워드 3-5개입니다. 한국어 직역이 아닌 1688에서 통용되는 일반 용어로 변환하세요. 예: "무선 이어폰" → ["蓝牙耳机", "无线耳机", "TWS耳机"]. 나이키/애플 같은 영문 브랜드는 영문 그대로.
- 추출이 어렵거나 일부 필드가 흐릿하면 confidence를 medium 또는 low로 설정하고 notes에 사유를 적습니다.
- title_ko, brand, category_hint, notes는 반드시 단일 문자열 또는 null. 절대 배열로 반환하지 마세요. 여러 후보가 있으면 가장 대표적인 하나만 선택.
- price_krw는 반드시 숫자(콤마/원/통화기호 없이) 또는 null. "12,500원" 같은 문자열 금지.
- search_keywords_zh만 문자열 배열.

응답은 반드시 다음 JSON 스키마를 따릅니다. 다른 설명 없이 JSON만 반환하세요:
{
  "title_ko": string,
  "brand": string | null,
  "price_krw": number | null,
  "category_hint": string | null,
  "search_keywords_zh": string[],
  "confidence": "high" | "medium" | "low",
  "notes": string | null
}`;

const HARD_TIMEOUT_MS = 25_000;

export async function extractFromImage(
  imageBuffer: Buffer,
  mediaType: "image/png" | "image/jpeg" | "image/webp",
): Promise<Extracted> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY 미설정");
  }
  const dataUrl = `data:${mediaType};base64,${imageBuffer.toString("base64")}`;
  // SDK 내부 timeout이 OpenRouter 무료 큐 대기에 잘 안 먹혀 wall-clock guard 추가.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HARD_TIMEOUT_MS);
  let response;
  try {
    response = await client.chat.completions.create(
      {
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: dataUrl } },
              {
                type: "text",
                text: "이 캡처에서 상품 정보를 JSON으로 추출하세요.",
              },
            ],
          },
        ],
      },
      { signal: controller.signal },
    );
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(`Vision 호출 타임아웃 (${HARD_TIMEOUT_MS / 1000}s)`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new Error("Vision 응답 비어있음");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`Vision 응답이 JSON이 아님: ${text.slice(0, 200)}`);
  }
  const parsed = ExtractedSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Vision 출력 스키마 불일치: ${parsed.error.message}`);
  }
  return parsed.data;
}
