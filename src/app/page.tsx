import AnalyzeForm from "./AnalyzeForm";

export default function Page() {
  return (
    <main className="min-h-screen px-6 pt-12 pb-16 sm:px-8 sm:pt-20">
      <div className="max-w-content mx-auto">
        <header className="mb-16">
          <div className="font-serif-kr font-bold text-xl tracking-tight">
            도매가
          </div>
        </header>

        <section className="mb-12">
          <h1 className="font-serif-kr font-bold text-3xl sm:text-4xl tracking-tighter leading-[1.15]">
            마진을 알고
            <br />
            결정하세요.
          </h1>
          <p className="mt-5 text-ink-muted text-base max-w-sm leading-relaxed">
            상품 페이지 캡처를 올리면 중국 도매 시세를 보여드립니다.
          </p>
        </section>

        <section>
          <AnalyzeForm />
        </section>

        <footer className="mt-24 pt-4 border-t border-rule text-2xs text-ink-muted tracking-[0.04em]">
          중립적 도매가 시세선 · 캡처 기반 분석
        </footer>
      </div>
    </main>
  );
}
