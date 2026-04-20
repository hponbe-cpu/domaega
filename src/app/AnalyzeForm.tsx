"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AnalyzeForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "요청을 처리하지 못했습니다.");
        setSubmitting(false);
        return;
      }
      // Fire-and-forget worker tick — the result page subscribes to Realtime.
      fetch("/api/worker/tick", { method: "POST" }).catch(() => {});
      router.push(data.permalink);
    } catch {
      setError("네트워크 오류. 다시 시도해주세요.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="flex gap-2 items-center border-t border-b border-ink py-3.5 mb-3">
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="smartstore.naver.com/.../products/..."
          className="flex-1 bg-transparent outline-none text-base placeholder:text-ink-muted"
          aria-label="네이버 스마트스토어 상품 URL"
          disabled={submitting}
        />
        <button
          type="submit"
          disabled={submitting || url.trim().length === 0}
          className="bg-ink text-paper px-3.5 py-2 text-sm font-semibold tracking-[0.02em] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? "분석 중" : "분석"}
        </button>
      </div>
      <div className="text-xs text-ink-muted">
        {error ? (
          <span className="text-state-domestic">{error}</span>
        ) : (
          "익명, 무료, 90일간 저장"
        )}
      </div>
    </form>
  );
}
