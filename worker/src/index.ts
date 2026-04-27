import express from "express";
import { config } from "./config.js";
import { scrape } from "./scrape.js";

const SMARTSTORE_HOSTS = new Set([
  "smartstore.naver.com",
  "m.smartstore.naver.com",
  "brand.naver.com",
  "shopping.naver.com",
]);

function isAllowedUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return SMARTSTORE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

const app = express();
app.use(express.json({ limit: "16kb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.post("/scrape", async (req, res) => {
  const auth = req.header("authorization") ?? "";
  if (auth !== `Bearer ${config.sharedSecret}`) {
    res.status(401).json({ ok: false, reason: "unauthorized" });
    return;
  }
  const url = req.body?.url;
  if (typeof url !== "string" || !isAllowedUrl(url)) {
    res.status(400).json({ ok: false, reason: "invalid url" });
    return;
  }
  const startedAt = Date.now();
  let result;
  try {
    result = await scrape(url);
  } catch (e) {
    const reason = (e as Error).message;
    console.log(
      JSON.stringify({
        msg: "scrape",
        url,
        ok: false,
        reason,
        elapsedMs: Date.now() - startedAt,
        threw: true,
      }),
    );
    res.status(500).json({ ok: false, reason });
    return;
  }
  const elapsedMs = Date.now() - startedAt;
  console.log(
    JSON.stringify({
      msg: "scrape",
      url,
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      status: "status" in result ? result.status : undefined,
      elapsedMs,
    }),
  );
  res.status(result.ok ? 200 : 502).json(result);
});

app.listen(config.port, () => {
  console.log(JSON.stringify({ msg: "worker up", port: config.port }));
});
