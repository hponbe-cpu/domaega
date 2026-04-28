export type Item1688 = {
  title: string;
  price?: number;
  image?: string;
  link?: string;
};

export async function search1688(query: string): Promise<Item1688[]> {
  const url = process.env.WORKER_URL;
  const secret = process.env.WORKER_SHARED_SECRET;
  if (!url || !secret) {
    throw new Error("WORKER_URL / WORKER_SHARED_SECRET 미설정");
  }
  const res = await fetch(`${url}/search1688`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ query }),
    cache: "no-store",
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`worker /search1688 ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as
    | { ok: true; results: Item1688[]; query: string }
    | { ok: false; reason: string };
  if (!data.ok) throw new Error(data.reason);
  return data.results;
}
