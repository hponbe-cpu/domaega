import { chromium, type Browser } from "playwright";
import { config } from "./config.js";

let browser: Browser | null = null;
let consecutiveFailures = 0;

async function getBrowser(): Promise<Browser> {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    headless: true,
    proxy: {
      server: `http://${config.proxy.host}:${config.proxy.port}`,
      username: config.proxy.user,
      password: config.proxy.pass,
    },
  });
  return browser;
}

async function resetBrowser(): Promise<void> {
  try {
    await browser?.close();
  } catch {}
  browser = null;
}

export type ScrapeResult =
  | { ok: true; og_title: string; status: number }
  | { ok: false; reason: string; status?: number };

export async function scrape(url: string): Promise<ScrapeResult> {
  const b = await getBrowser();
  const ctx = await b.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "ko-KR",
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  try {
    const res = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: config.scrapeTimeoutMs,
    });
    const status = res?.status() ?? 0;
    if (!res || status >= 400) {
      consecutiveFailures++;
      if (consecutiveFailures >= 3) await resetBrowser();
      return { ok: false, reason: `HTTP ${status}`, status };
    }
    const og = await page
      .locator('meta[property="og:title"]')
      .first()
      .getAttribute("content")
      .catch(() => null);
    const title = (og ?? (await page.title())).trim();
    if (!title) {
      return { ok: false, reason: "title 추출 실패", status };
    }
    consecutiveFailures = 0;
    return { ok: true, og_title: title, status };
  } catch (e) {
    consecutiveFailures++;
    if (consecutiveFailures >= 3) await resetBrowser();
    return { ok: false, reason: (e as Error).message };
  } finally {
    await ctx.close().catch(() => {});
  }
}
