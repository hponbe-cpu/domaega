import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const anthropic = new Anthropic();

export const ExtractedSchema = z.object({
  title_ko: z.string().describe("상품 제목 (한국어)"),
  brand: z.string().nullable().describe("브랜드명. 명확하지 않으면 null"),
  price_krw: z.number().nullable().describe("판매가 (원). 정가/할인가 함께 보이면 할인가. 없으면 null"),
  category_hint: z
    .string()
    .nullable()
    .describe("카테고리 추정 (예: 패션 잡화, 주방용품, 가전, 뷰티)"),
  search_keywords_zh: z
    .array(z.string())
    .describe(
      "1688 검색용 중국어 키워드 3-5개. 한국어 직역이 아닌 1688 실사용 일반 용어. 영문 브랜드는 영문 그대로",
    ),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("추출 신뢰도. high=모든 핵심 필드 명확, low=가격/제목이 흐림"),
  notes: z.string().nullable().describe("추출 시 주의사항. 없으면 null"),
});

export type Extracted = z.infer<typeof ExtractedSchema>;

const SYSTEM_PROMPT = `당신은 한국 온라인 쇼핑몰 캡처 화면에서 상품 정보를 추출하는 전문가입니다.

캡처는 네이버 스마트스토어, 쿠팡, 11번가, 지마켓, 다나와, 인스타그램 DM 등에서 온 한국 쇼핑 화면입니다.

추출 규칙:
- 상품 제목은 광고 카피나 옵션 텍스트가 아닌 본문에 표기된 정식 명칭을 사용합니다.
- 가격은 판매가(현재 결제 시 청구되는 가격)를 추출합니다. 정가/할인가 함께 보이면 할인가를 사용합니다. 옵션별 추가금은 무시합니다.
- 브랜드는 셀러명(스토어 이름)이 아닌 제조사 또는 상품 브랜드입니다. 명확하지 않으면 null.
- search_keywords_zh는 이 상품을 1688에서 찾기 위한 중국어 키워드입니다. 한국어 제목을 직역하지 말고 1688에서 실제 통용되는 일반 용어로 변환하세요. 예: "무선 이어폰" → ["蓝牙耳机", "无线耳机", "TWS耳机"]. 나이키/애플 같은 영문 브랜드명은 중국어로 번역하지 말고 영문 그대로 사용합니다.
- 추출이 어렵거나 일부 필드가 흐릿하면 confidence를 medium 또는 low로 설정하고 notes에 사유를 적습니다.`;

export async function extractFromImage(
  imageBuffer: Buffer,
  mediaType: "image/png" | "image/jpeg" | "image/webp",
): Promise<Extracted> {
  const base64 = imageBuffer.toString("base64");
  const response = await anthropic.messages.parse({
    model: "claude-opus-4-7",
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: base64,
            },
          },
          {
            type: "text",
            text: "이 캡처에서 상품 정보를 추출하세요.",
          },
        ],
      },
    ],
    output_config: {
      format: zodOutputFormat(ExtractedSchema),
    },
  });
  if (!response.parsed_output) {
    throw new Error(
      `Vision 추출 결과 파싱 실패 (stop_reason: ${response.stop_reason})`,
    );
  }
  return response.parsed_output;
}
