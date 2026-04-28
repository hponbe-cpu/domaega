// playwright-extra + stealth로 1688의 __baxia__ 헤드리스 탐지 우회.
import { chromium as chromiumExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser } from "playwright";
import { config } from "./config.js";

chromiumExtra.use(StealthPlugin());

let browser: Browser | null = null;
let consecutiveFailures = 0;

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  browser = (await chromiumExtra.launch({
    headless: true,
    proxy: {
      server: `http://${config.proxy.host}:${config.proxy.port}`,
      username: config.proxy.user,
      password: config.proxy.pass,
    },
  })) as Browser;
  return browser;
}

async function resetBrowser(): Promise<void> {
  try {
    await browser?.close();
  } catch {}
  browser = null;
}

export type Item1688 = {
  title: string;
  price?: number;
  image?: string;
  link?: string;
};

export type Search1688Result =
  | { ok: true; results: Item1688[]; query: string }
  | { ok: false; reason: string };

export async function search1688(query: string): Promise<Search1688Result> {
  const url = `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(query)}`;
  const b = await getBrowser();
  const ctx = await b.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  try {
    const res = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });
    const status = res?.status() ?? 0;
    if (!res || status >= 400) {
      consecutiveFailures++;
      if (consecutiveFailures >= 3) await resetBrowser();
      return { ok: false, reason: `1688 HTTP ${status}` };
    }
    // 결과 카드 등장까지 대기. 1688은 React-driven이라 selector가 자주 바뀌어
    // detail offer 링크 anchor를 시그널로 사용.
    await page
      .waitForSelector('a[href*="detail.1688.com/offer/"]', { timeout: 15000 })
      .catch(() => null);

    const results = await page.evaluate(() => {
      const offerLinks = Array.from(
        document.querySelectorAll('a[href*="detail.1688.com/offer/"]'),
      );
      const seen = new Set<string>();
      const out: Array<{
        title: string;
        price?: number;
        image?: string;
        link?: string;
      }> = [];
      for (const link of offerLinks) {
        const href = (link as HTMLAnchorElement).href;
        const m = href.match(/offer\/(\d+)\.html/);
        if (!m || seen.has(m[1])) continue;
        seen.add(m[1]);
        let container: Element | null = link;
        for (let i = 0; i < 6 && container; i++) {
          const img = container.querySelector("img");
          const text = container.textContent || "";
          const priceMatch = text.match(/¥\s*([\d,.]+)/);
          const titleAttr = link.getAttribute("title");
          const titleText =
            titleAttr ??
            (link.textContent || "").trim() ??
            container.querySelector("[title]")?.getAttribute("title") ??
            "";
          if (img && priceMatch && titleText && titleText.length > 4) {
            const price = parseFloat(priceMatch[1].replace(/,/g, ""));
            const imgEl = img as HTMLImageElement;
            const imgSrc = imgEl.src || imgEl.getAttribute("data-src") || "";
            out.push({
              title: titleText.slice(0, 200),
              price: Number.isFinite(price) ? price : undefined,
              image: imgSrc.startsWith("//") ? `https:${imgSrc}` : imgSrc,
              link: href.split("?")[0],
            });
            break;
          }
          container = container.parentElement;
        }
        if (out.length >= 10) break;
      }
      return out;
    });

    if (results.length === 0) {
      const pageTitle = await page.title().catch(() => "");
      const finalUrl = page.url();
      const snippet = await page
        .evaluate(() =>
          (document.body?.innerText || "").trim().slice(0, 400),
        )
        .catch(() => "");
      const offerLinkCount = await page
        .evaluate(
          () =>
            document.querySelectorAll('a[href*="detail.1688.com/offer/"]')
              .length,
        )
        .catch(() => 0);
      console.log(
        JSON.stringify({
          msg: "search1688.empty",
          query,
          pageTitle,
          finalUrl,
          offerLinkCount,
          bodySnippet: snippet,
        }),
      );
    }

    consecutiveFailures = 0;
    return { ok: true, results, query };
  } catch (e) {
    consecutiveFailures++;
    if (consecutiveFailures >= 3) await resetBrowser();
    return { ok: false, reason: (e as Error).message };
  } finally {
    await ctx.close().catch(() => {});
  }
}
