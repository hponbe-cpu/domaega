import OpenAI from "openai";
import { z } from "zod";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
});

const MODEL = process.env.OPENROUTER_MODEL ?? "google/gemma-4-31b-it:free";

// 모델이 nullable 필드를 null로 명시하지 않고 키를 누락하는 경우가 있어 nullish + transform으로 정규화.
const nullableString = z
  .string()
  .nullish()
  .transform((v) => v ?? null);
const nullableNumber = z
  .number()
  .nullish()
  .transform((v) => v ?? null);

export const ExtractedSchema = z.object({
  title_ko: z.string(),
  brand: nullableString,
  price_krw: nullableNumber,
  category_hint: nullableString,
  search_keywords_zh: z.array(z.string()).default([]),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
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

export async function extractFromImage(
  imageBuffer: Buffer,
  mediaType: "image/png" | "image/jpeg" | "image/webp",
): Promise<Extracted> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY 미설정");
  }
  const dataUrl = `data:${mediaType};base64,${imageBuffer.toString("base64")}`;
  const response = await client.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          { type: "text", text: "이 캡처에서 상품 정보를 JSON으로 추출하세요." },
        ],
      },
    ],
  });
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
