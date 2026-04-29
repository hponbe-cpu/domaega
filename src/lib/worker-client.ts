export type Item1688 = {
  title: string;
  price?: number;
  image?: string;
  link?: string;
};

type WorkerSearchResponse =
  | { ok: true; results: Item1688[]; query: string }
  | { ok: false; reason: string };

function workerConfig(): { url: string; secret: string } {
  const url = process.env.WORKER_URL;
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!url || !secret) {
    throw new Error("WORKER_URL / WORKER_SHARED_SECRET is not configured");
  }
  return { url, secret };
}

async function parseWorkerSearchResponse(
  res: Response,
  endpoint: string,
): Promise<Item1688[]> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`worker ${endpoint} ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as WorkerSearchResponse;
  if (!data.ok) throw new Error(data.reason);
  return data.results;
}

export async function search1688(query: string): Promise<Item1688[]> {
  const { url, secret } = workerConfig();
  const res = await fetch(`${url}/search1688`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ query }),
    cache: "no-store",
    signal: AbortSignal.timeout(50000),
  });
  return parseWorkerSearchResponse(res, "/search1688");
}

export async function search1688ByImage(
  imageBuffer: Buffer,
  mediaType: "image/png" | "image/jpeg" | "image/webp",
): Promise<Item1688[]> {
  const { url, secret } = workerConfig();
  const res = await fetch(`${url}/search1688/image`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      imageBase64: imageBuffer.toString("base64"),
      mediaType,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(55000),
  });
  return parseWorkerSearchResponse(res, "/search1688/image");
}
