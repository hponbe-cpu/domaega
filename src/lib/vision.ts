import OpenAI from "openai";
import { z } from "zod";

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY ?? "",
  timeout: 45_000,
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

// 모델이 프롬프트를 어겨 디스크립티브 구절/공백 합성을 키워드로 내놓을 때 1688 검색이
// AND 의미로 0건 반환됨. 단일 토큰 카테고리 단어만 통과시키는 보수적 가드.
function sanitizeKeywords(arr: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of arr) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // 첫 토큰만 채택 (공백 합성 차단). 7자 초과 자르지 않고 그대로 거름 — 디스크립션 가능성.
    const firstToken = trimmed.split(/\s+/)[0];
    if (firstToken.length < 2 || firstToken.length > 8) continue;
    if (seen.has(firstToken)) continue;
    seen.add(firstToken);
    out.push(firstToken);
    if (out.length >= 3) break;
  }
  return out;
}

export const ExtractedSchema = z.object({
  title_ko: z.string(),
  brand: nullableString,
  price_krw: nullableNumber,
  category_hint: nullableString,
  search_keywords_zh: z
    .array(z.string())
    .nullish()
    .transform((v) => sanitizeKeywords(v ?? [])),
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
- search_keywords_zh: 1688 검색창에 그대로 입력할 짧은 중국어 카테고리 단어 2-3개. 매우 엄격한 규칙:
  · 첫 번째는 가장 일반적인 카테고리 단어 1개. 4-6글자, 공백 없음. 예: 蓝牙耳机, 行李箱, 无线键盘, 偏光太阳镜, 男士皮鞋. 디스크립션/피쳐/문장 절대 금지.
  · 두 번째는 동의어 또는 한 단계 좁힌 변형. 역시 단일 단어. 예: TWS耳机 / 拉杆箱 / 机械键盘.
  · 절대 금지: 공백 들어간 합성구("无线耳机 蓝牙"), 디스크립티브 피쳐("抗刮擦拉链", "360度回转轮胎"), 문장형, 한국어 직역 그대로, 7자 이상.
  · 나이키/애플 같은 영문 브랜드는 영문 그대로 단일 토큰.
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

// vision tick은 단독 호출이라 거의 60s 다 씀. 50s + 응답/파싱 마진 10s.
// 무료 큐 변동으로 가끔 타임아웃 — tick 레벨에서 자동 재시도(pending 회귀)함.
const HARD_TIMEOUT_MS = 45_000;

// tick에서 transient(재시도 가능)와 영구 실패를 구분하기 위한 마커.
// 무료 모델은 timeout/빈응답/일시 5xx가 큐 변동으로 자주 나옴 — 모두 retry 풀.
export const VISION_RETRY_TAG = "vision-retry";

function isTimeoutLikeError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("abort")
  );
}

export async function extractFromImage(
  imageBuffer: Buffer,
  mediaType: "image/png" | "image/jpeg" | "image/webp",
): Promise<Extracted> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY 미설정");
  }
  const dataUrl = `data:${mediaType};base64,${imageBuffer.toString("base64")}`;
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
    if (controller.signal.aborted || isTimeoutLikeError(e)) {
      throw new Error(
        `${VISION_RETRY_TAG}: 호출 타임아웃 (${HARD_TIMEOUT_MS / 1000}s)`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  const text = response.choices[0]?.message?.content;
  if (!text) {
    // 무료 모델이 어쩌다 빈 content를 반환. finish_reason과 첫 choice를 같이 로그.
    const choice0 = response.choices[0];
    console.log(
      JSON.stringify({
        msg: "vision.empty_content",
        model: MODEL,
        finish_reason: choice0?.finish_reason,
        message: choice0?.message,
        usage: response.usage,
      }),
    );
    throw new Error(`${VISION_RETRY_TAG}: 응답 비어있음`);
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
