"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Analysis, Extracted, Match } from "@/types/analysis";

const STATE_LABELS: Record<NonNullable<Analysis["state"]>, string> = {
  confident_match: "신뢰 높음",
  likely_domestic: "국내/정품 추정",
  unknown: "불확실",
};

const STATE_CLASS: Record<NonNullable<Analysis["state"]>, string> = {
  confident_match: "bg-state-confident",
  likely_domestic: "bg-state-domestic",
  unknown: "bg-state-unknown",
};

const CONFIDENCE_LABELS: Record<Extracted["confidence"], string> = {
  high: "추출 신뢰도 높음",
  medium: "추출 신뢰도 보통",
  low: "추출 신뢰도 낮음",
};

const CONFIDENCE_CLASS: Record<Extracted["confidence"], string> = {
  high: "bg-state-confident",
  medium: "bg-state-domestic",
  low: "bg-state-unknown",
};

function formatKRW(n: number): string {
  return `${n.toLocaleString("ko-KR")}원`;
}

function formatCNY(n: number): string {
  return `¥${n.toFixed(2)}`;
}

function priceRange(matches: Match[]): { min: number; max: number } | null {
  const prices = matches
    .slice(0, 5)
    .map((m) => m.price)
    .filter((p): p is number => typeof p === "number");
  if (prices.length === 0) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

export default function ResultView({ initial }: { initial: Analysis }) {
  const [row, setRow] = useState<Analysis>(initial);
  const tickFiredFor = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (
      row.status === "completed" ||
      row.status === "no_match_found" ||
      row.status === "scrape_failed" ||
      row.status === "dead_letter"
    ) {
      return;
    }
    const supabase = createClient();
    const channel = supabase
      .channel(`analysis:${row.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "product_analyses",
          filter: `id=eq.${row.id}`,
        },
        (payload) => {
          setRow(payload.new as Analysis);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [row.id, row.status]);

  // pending과 matching 진입 시 tick 발사. form에서 띄우면 router.push가 fetch를 취소하므로
  // ResultView mount 후 안정된 컨텍스트에서 트리거하는 게 안전.
  useEffect(() => {
    if (
      (row.status === "pending" || row.status === "matching") &&
      !tickFiredFor.current.has(row.status)
    ) {
      tickFiredFor.current.add(row.status);
      fetch("/api/worker/tick", { method: "POST" }).catch(() => {});
    }
  }, [row.status]);

  return (
    <main className="min-h-screen px-6 pt-10 pb-16 sm:px-8 sm:pt-14">
      <div className="max-w-content mx-auto">
        <div className="text-2xs tracking-[0.16em] uppercase text-ink-muted mb-5 font-mono">
          /p/{row.id}
        </div>

        <ProductHeader row={row} />

        {row.status === "pending" ||
        row.status === "scraping" ||
        row.status === "matching" ? (
          <PendingHero status={row.status} />
        ) : row.status === "completed" && row.state === "confident_match" ? (
          <ConfidentHero row={row} />
        ) : row.status === "completed" && row.state === "likely_domestic" ? (
          <DomesticHero />
        ) : row.status === "completed" && row.extracted ? (
          <ExtractedPreview
            extracted={row.extracted}
            note={row.confidence_note}
          />
        ) : row.status === "completed" && row.state === "unknown" ? (
          <UnknownHero note={row.confidence_note} />
        ) : row.status === "no_match_found" ? (
          <NoMatchHero />
        ) : row.status === "scrape_failed" ? (
          <FailureHero
            reason={
              row.confidence_note ??
              "분석 실패. 다른 캡처로 다시 시도해 주세요."
            }
          />
        ) : row.status === "dead_letter" ? (
          <FailureHero reason="처리 지연. 잠시 후 재시도해 주세요." />
        ) : null}

        {row.status === "completed" &&
        row.state === "confident_match" &&
        row.matches &&
        row.matches.length > 0 ? (
          <MatchList matches={row.matches} />
        ) : null}

        <ShareRow />

        <footer className="mt-8 pt-3 border-t border-rule text-2xs text-ink-muted tracking-[0.08em] flex justify-between">
          <span>
            <span className="font-mono tabular-nums">
              {new Date(row.created_at)
                .toISOString()
                .slice(0, 10)
                .replace(/-/g, "")}
            </span>
            {" · 90일 저장"}
          </span>
          <span>도매가</span>
        </footer>
      </div>
    </main>
  );
}

function ProductHeader({ row }: { row: Analysis }) {
  const title = row.hero_data?.title ?? "상품 정보 추출 중";
  const retail = row.hero_data?.price;
  const brand = row.hero_data?.brand;
  const category = row.hero_data?.category;
  const secondary = retail
    ? formatKRW(retail)
    : (brand ?? category ?? null);
  return (
    <div className="flex gap-3.5 items-start mb-12 pb-5 border-b border-rule">
      <div
        className="w-14 h-14 flex-shrink-0 rounded-[2px] bg-rule"
        style={
          row.hero_data?.image
            ? {
                backgroundImage: `url(${row.hero_data.image})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      />
      <div>
        <div className="text-sm font-medium leading-snug mb-1">{title}</div>
        {secondary ? (
          <div className="text-sm text-ink-muted">
            {retail ? (
              <span className="font-mono tabular-nums">{secondary}</span>
            ) : (
              secondary
            )}
            {retail && brand ? <> · {brand}</> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PendingHero({ status }: { status: Analysis["status"] }) {
  const label =
    status === "pending"
      ? "대기 중"
      : status === "scraping"
        ? "캡처 분석 중"
        : "도매 매칭 중";
  return (
    <section className="text-center py-16">
      <div className="text-xs tracking-[0.2em] uppercase text-ink-muted mb-5">
        분석 진행
      </div>
      <div className="font-display font-medium text-3xl tracking-tightest text-ink-muted">
        {label}…
      </div>
      <div className="mt-4 text-sm text-ink-muted">
        최대 1분. 페이지를 닫아도 결과는 저장됩니다.
      </div>
    </section>
  );
}

function ConfidentHero({ row }: { row: Analysis }) {
  const range = row.matches ? priceRange(row.matches) : null;
  const fxRate = 186;
  return (
    <section className="text-center py-10">
      <div className="text-xs tracking-[0.2em] uppercase text-ink-muted mb-5">
        예상 도매가 범위
      </div>
      <div className="font-display font-medium text-4xl tracking-tightest tabular-nums">
        {range
          ? `${formatCNY(range.min)} – ${formatCNY(range.max)}`
          : formatCNY(0)}
      </div>
      {range ? (
        <div className="mt-2.5 text-sm text-ink-muted font-mono tabular-nums">
          ≈ {formatKRW(Math.round(range.min * fxRate))} –{" "}
          {formatKRW(Math.round(range.max * fxRate))}
        </div>
      ) : null}
      <StatePill state={row.state ?? "unknown"} top1={row.top1_similarity} />
    </section>
  );
}

function DomesticHero() {
  return (
    <section className="text-center py-10">
      <div className="text-xs tracking-[0.2em] uppercase text-ink-muted mb-5">
        도매 매칭 없음
      </div>
      <div className="font-serif-kr font-bold text-3xl tracking-tighter">
        국내·정품 가능성
      </div>
      <StatePill state="likely_domestic" top1={null} />
    </section>
  );
}

function ExtractedPreview({
  extracted,
  note,
}: {
  extracted: Extracted;
  note: string | null;
}) {
  return (
    <section className="py-6">
      <div className="text-xs tracking-[0.2em] uppercase text-ink-muted mb-5 text-center">
        추출 정보
      </div>
      <dl className="border-t border-rule">
        {extracted.brand ? (
          <Row label="브랜드" value={extracted.brand} />
        ) : null}
        {extracted.price_krw ? (
          <Row label="판매가" value={formatKRW(extracted.price_krw)} mono />
        ) : null}
        {extracted.category_hint ? (
          <Row label="카테고리" value={extracted.category_hint} />
        ) : null}
        <Row
          label="1688 키워드"
          value={extracted.search_keywords_zh.join(" · ")}
        />
        {extracted.notes ? (
          <Row label="비고" value={extracted.notes} />
        ) : null}
      </dl>
      <div className="mt-7 mb-10 flex justify-center">
        <span
          className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-white ${CONFIDENCE_CLASS[extracted.confidence]}`}
        >
          <span>{CONFIDENCE_LABELS[extracted.confidence]}</span>
        </span>
      </div>
      {note ? (
        <div className="text-sm text-ink-muted max-w-md mx-auto leading-relaxed text-center">
          {note}
        </div>
      ) : null}
    </section>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3.5 py-3 border-b border-rule">
      <dt className="text-xs tracking-caps uppercase font-semibold text-ink-muted self-center">
        {label}
      </dt>
      <dd
        className={`text-sm leading-snug ${mono ? "font-mono tabular-nums" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function UnknownHero({ note }: { note: string | null }) {
  return (
    <section className="text-center py-10">
      <div className="text-xs tracking-[0.2em] uppercase text-ink-muted mb-5">
        확신 어려움
      </div>
      <div className="font-serif-kr font-bold text-3xl tracking-tighter">
        판단 유보
      </div>
      <StatePill state="unknown" top1={null} />
      {note ? (
        <div className="mt-2 text-sm text-ink-muted max-w-md mx-auto leading-relaxed">
          {note}
        </div>
      ) : null}
    </section>
  );
}

function NoMatchHero() {
  return (
    <section className="text-center py-10">
      <div className="text-xs tracking-[0.2em] uppercase text-ink-muted mb-5">
        매칭 결과 없음
      </div>
      <div className="font-serif-kr font-bold text-3xl tracking-tighter">
        1688에서 찾지 못함
      </div>
      <div className="mt-4 text-sm text-ink-muted">
        국내 제작 또는 도매 소스가 다른 상품일 수 있습니다.
      </div>
    </section>
  );
}

function FailureHero({ reason }: { reason: string }) {
  return (
    <section className="text-center py-10">
      <div className="text-xs tracking-[0.2em] uppercase text-ink-muted mb-5">
        분석 중단
      </div>
      <div className="font-serif-kr font-bold text-2xl tracking-tight text-ink-muted">
        {reason}
      </div>
    </section>
  );
}

function StatePill({
  state,
  top1,
}: {
  state: NonNullable<Analysis["state"]>;
  top1: number | null;
}) {
  return (
    <div className="mt-7 mb-14 flex justify-center">
      <span
        className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold text-white ${STATE_CLASS[state]}`}
      >
        <span>{STATE_LABELS[state]}</span>
        {typeof top1 === "number" ? (
          <>
            <span className="opacity-60" aria-hidden>
              ·
            </span>
            <span className="font-mono uppercase tracking-caps-tight tabular-nums">
              top-1 sim {top1.toFixed(2)}
            </span>
          </>
        ) : null}
      </span>
    </div>
  );
}

function MatchList({ matches }: { matches: Match[] }) {
  const shown = matches.slice(0, 5);
  return (
    <section>
      <div className="flex justify-between items-baseline border-b border-ink pb-2.5 mb-0">
        <span className="text-xs tracking-caps uppercase font-semibold">
          선정된 매칭
        </span>
        <span className="text-xs text-ink-muted font-mono tabular-nums">
          {shown.length} / {matches.length} top
        </span>
      </div>
      {shown.map((m, i) => (
        <div
          key={i}
          className="grid grid-cols-[40px_1fr_auto_auto] gap-3.5 items-center py-3.5 border-b border-rule"
        >
          <div
            className="w-10 h-10 rounded-[2px] bg-rule"
            style={
              m.image
                ? {
                    backgroundImage: `url(${m.image})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : undefined
            }
          />
          <div>
            <div className="text-sm leading-snug">{m.title ?? "—"}</div>
            <div className="text-xs text-ink-muted mt-0.5">
              {m.vendor ?? "—"} · {m.source ?? "1688"}
            </div>
          </div>
          <div className="font-mono tabular-nums text-sm font-medium">
            {typeof m.price === "number" ? formatCNY(m.price) : "—"}
          </div>
          <div className="font-mono text-xs text-ink-muted tabular-nums">
            {typeof m.similarity === "number" ? m.similarity.toFixed(2) : "—"}
          </div>
        </div>
      ))}
    </section>
  );
}

function ShareRow() {
  async function copyLink() {
    if (typeof window === "undefined") return;
    await navigator.clipboard.writeText(window.location.href);
  }
  return (
    <div className="flex gap-4 mt-10 mb-6 text-sm">
      <button
        onClick={copyLink}
        className="underline underline-offset-4 decoration-[1px] hover:text-accent"
      >
        링크 복사
      </button>
      <a
        href="#"
        onClick={(e) => e.preventDefault()}
        className="underline underline-offset-4 decoration-[1px] hover:text-accent text-ink-muted"
      >
        카카오톡
      </a>
      <a
        href="#"
        onClick={(e) => e.preventDefault()}
        className="underline underline-offset-4 decoration-[1px] hover:text-accent text-ink-muted"
      >
        트위터
      </a>
    </div>
  );
}
