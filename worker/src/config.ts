import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const config = {
  port: parseInt(process.env.PORT ?? "8080", 10),
  sharedSecret: required("WORKER_SHARED_SECRET"),
  proxy: {
    host: required("PROXY_HOST"),
    port: parseInt(required("PROXY_PORT"), 10),
    user: required("PROXY_USER"),
    pass: required("PROXY_PASS"),
  },
  scrapeTimeoutMs: parseInt(process.env.SCRAPE_TIMEOUT_MS ?? "20000", 10),
};
