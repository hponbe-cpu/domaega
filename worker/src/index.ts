import express from "express";
import { config } from "./config.js";
import { search1688 } from "./search.js";

const app = express();
app.use(express.json({ limit: "16kb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.post("/search1688", async (req, res) => {
  const auth = req.header("authorization") ?? "";
  if (auth !== `Bearer ${config.sharedSecret}`) {
    res.status(401).json({ ok: false, reason: "unauthorized" });
    return;
  }
  const query = req.body?.query;
  if (typeof query !== "string" || query.trim().length === 0) {
    res.status(400).json({ ok: false, reason: "query (string) required" });
    return;
  }
  const startedAt = Date.now();
  let result;
  try {
    result = await search1688(query);
  } catch (e) {
    const reason = (e as Error).message;
    console.log(
      JSON.stringify({
        msg: "search1688",
        query,
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
      msg: "search1688",
      query,
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
      count: result.ok ? result.results.length : 0,
      elapsedMs,
    }),
  );
  res.status(result.ok ? 200 : 502).json(result);
});

app.listen(config.port, () => {
  console.log(JSON.stringify({ msg: "worker up", port: config.port }));
});
