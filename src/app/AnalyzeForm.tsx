"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

export default function AnalyzeForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  function pickFile(f: File | null) {
    setError(null);
    if (!f) return;
    if (!ALLOWED_MIME.includes(f.type)) {
      setError("PNG / JPEG / WebP 이미지만 지원합니다.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("5MB 이하 이미지만 가능합니다.");
      return;
    }
    setFile(f);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "요청을 처리하지 못했습니다.");
        setSubmitting(false);
        return;
      }
      router.push(data.permalink);
    } catch {
      setError("네트워크 오류. 다시 시도해주세요.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <label
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          pickFile(e.dataTransfer.files[0] ?? null);
        }}
        className={`block border ${dragOver ? "border-ink" : "border-rule"} border-dashed py-10 px-6 cursor-pointer mb-4 transition-colors`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          disabled={submitting}
          aria-label="상품 캡처 이미지"
        />
        <div className="text-center">
          {file ? (
            <>
              <div className="text-sm font-mono break-all">{file.name}</div>
              <div className="text-xs text-ink-muted mt-1.5">
                {(file.size / 1024).toFixed(0)} KB · 클릭해서 다른 이미지 선택
              </div>
            </>
          ) : (
            <>
              <div className="text-xs tracking-[0.16em] uppercase font-semibold text-ink-muted mb-2">
                상품 캡처 업로드
              </div>
              <div className="text-sm text-ink-muted leading-relaxed">
                여기로 끌어오거나 클릭해 선택
                <br />
                PNG / JPEG / WebP · 5MB 이하
              </div>
            </>
          )}
        </div>
      </label>
      <div className="flex justify-between items-center">
        <div className="text-xs text-ink-muted">
          {error ? (
            <span className="text-state-domestic">{error}</span>
          ) : (
            "익명, 무료, 90일간 저장"
          )}
        </div>
        <button
          type="submit"
          disabled={submitting || !file}
          className="bg-ink text-paper px-3.5 py-2 text-sm font-semibold tracking-[0.02em] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? "분석 중" : "분석"}
        </button>
      </div>
    </form>
  );
}
