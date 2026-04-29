export type AnalysisStatus =
  | "pending"
  | "scraping"
  | "matching"
  | "completed"
  | "scrape_failed"
  | "no_match_found"
  | "legal_hidden"
  | "dead_letter";

export type AnalysisState =
  | "confident_match"
  | "likely_domestic"
  | "unknown"
  | null;

export type Extracted = {
  title_ko: string;
  brand: string | null;
  price_krw: number | null;
  category_hint: string | null;
  search_keywords_zh: string[];
  confidence: "high" | "medium" | "low";
  notes: string | null;
};

export type HeroData = {
  title?: string;
  price?: number;
  image?: string;
  category?: string;
  brand?: string;
  mallName?: string;
};

export type Match = {
  title?: string;
  image?: string;
  price?: number;
  vendor?: string;
  similarity?: number;
  link?: string;
  source?: "1688" | "taobao" | "ali";
};

export type Analysis = {
  id: string;
  url: string | null;
  image_path: string | null;
  extracted: Extracted | null;
  status: AnalysisStatus;
  state: AnalysisState;
  hero_data: HeroData | null;
  matches: Match[] | null;
  top1_similarity: number | null;
  confidence_note: string | null;
  retry_count: number;
  next_attempt_at: string;
  processing_started_at: string | null;
  last_error: string | null;
  created_at: string;
  view_count: number;
};
