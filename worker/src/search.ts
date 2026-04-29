import { chromium as chromiumExtra } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import type { Browser, BrowserContext, Page } from "playwright";
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

async function newSearchContext(): Promise<BrowserContext> {
  const b = await getBrowser();
  return b.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1280, height: 800 },
  });
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

export type ImageSearchInput = {
  imageBase64: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
};

async function extractOfferResults(page: Page): Promise<Item1688[]> {
  await page
    .waitForSelector('a[href*="detail.1688.com/offer/"]', { timeout: 15000 })
    .catch(() => null);

  return page.evaluate(() => {
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
      for (let i = 0; i < 8 && container; i++) {
        const img = container.querySelector("img");
        const text = container.textContent || "";
        const priceMatch =
          text.match(/[¥￥]\s*([\d,.]+)/) ?? text.match(/\b(\d+\.\d{2})\b/);
        const titleAttr = link.getAttribute("title");
        const titleText =
          titleAttr ??
          (link.textContent || "").trim() ??
          container.querySelector("[title]")?.getAttribute("title") ??
          "";

        if (img && titleText && titleText.length > 4) {
          const price = priceMatch
            ? parseFloat(priceMatch[1].replace(/,/g, ""))
            : NaN;
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
}

async function logEmptyResults(
  page: Page,
  msg: string,
  extra: Record<string, unknown>,
): Promise<void> {
  const pageTitle = await page.title().catch(() => "");
  const finalUrl = page.url();
  const snippet = await page
    .evaluate(() => (document.body?.innerText || "").trim().slice(0, 400))
    .catch(() => "");
  const offerLinkCount = await page
    .evaluate(
      () =>
        document.querySelectorAll('a[href*="detail.1688.com/offer/"]').length,
    )
    .catch(() => 0);
  console.log(
    JSON.stringify({
      msg,
      ...extra,
      pageTitle,
      finalUrl,
      offerLinkCount,
      bodySnippet: snippet,
    }),
  );
}

export async function search1688(query: string): Promise<Search1688Result> {
  const url = `https://s.1688.com/selloffer/offer_search.htm?keywords=${encodeURIComponent(query)}`;
  const ctx = await newSearchContext();
  const page = await ctx.newPage();

  try {
    const res = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 40000,
    });
    const status = res?.status() ?? 0;
    if (!res || status >= 400) {
      consecutiveFailures++;
      if (consecutiveFailures >= 3) await resetBrowser();
      return { ok: false, reason: `1688 HTTP ${status}` };
    }

    const results = await extractOfferResults(page);
    if (results.length === 0) {
      await logEmptyResults(page, "search1688.empty", { query });
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

export async function search1688ByImage({
  imageBase64,
  mediaType,
}: ImageSearchInput): Promise<Search1688Result> {
  const ctx = await newSearchContext();
  const page = await ctx.newPage();
  const imageBuffer = Buffer.from(imageBase64, "base64");
  const extension =
    mediaType === "image/png" ? "png" : mediaType === "image/webp" ? "webp" : "jpg";

  try {
    await page.goto("https://www.1688.com/", {
      waitUntil: "domcontentloaded",
      timeout: 40000,
    });

    const cameraSelectors = [
      '[class*="camera"]',
      '[class*="image"]',
      '[class*="pic"]',
      '[title*="图片"]',
      '[aria-label*="图片"]',
      'text=图片',
      'text=搜图',
      'text=拍照',
    ];
    for (const selector of cameraSelectors) {
      const target = page.locator(selector).first();
      if ((await target.count()) > 0) {
        await target.click({ timeout: 1500 }).catch(() => {});
        break;
      }
    }

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.waitFor({ state: "attached", timeout: 10000 });
    await fileInput.setInputFiles({
      name: `query.${extension}`,
      mimeType: mediaType,
      buffer: imageBuffer,
    });

    await Promise.race([
      page.waitForURL(/1688\.com|alicdn\.com/, { timeout: 45000 }),
      page.waitForSelector('a[href*="detail.1688.com/offer/"]', {
        timeout: 45000,
      }),
      page.waitForLoadState("networkidle", { timeout: 45000 }),
    ]).catch(() => null);

    const results = await extractOfferResults(page);
    if (results.length === 0) {
      await logEmptyResults(page, "search1688.image.empty", {
        bytes: imageBuffer.length,
        mediaType,
      });
    }

    consecutiveFailures = 0;
    return { ok: true, results, query: "image" };
  } catch (e) {
    consecutiveFailures++;
    if (consecutiveFailures >= 3) await resetBrowser();
    return { ok: false, reason: (e as Error).message };
  } finally {
    await ctx.close().catch(() => {});
  }
}
