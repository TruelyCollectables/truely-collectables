import worker from "./cloudflare-worker";

type ExecutionContextLike = {
  waitUntil(promise: Promise<unknown>): void;
};

type WorkerLike = {
  fetch(
    request: Request,
    env: any,
    ctx: ExecutionContextLike,
  ): Promise<Response>;
  scheduled?: (
    controller: any,
    env: any,
    ctx: ExecutionContextLike,
  ) => Promise<void> | void;
};

type WorkerCache = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

const appWorker = worker as WorkerLike;
const STOREFRONT_EDGE_RETENTION_SECONDS = 7 * 24 * 60 * 60;
const STOREFRONT_EDGE_FRESH_MS = 60_000;
const STOREFRONT_COLD_RENDER_TIMEOUT_MS = 5_000;
const EDGE_FAILSAFE_VERSION = "storefront-failsafe-v2";

function getDefaultCache(): WorkerCache | null {
  try {
    const cacheStorage = (globalThis as any).caches as
      | { default?: WorkerCache }
      | undefined;
    return cacheStorage?.default || null;
  } catch {
    return null;
  }
}

function isPublicBrowseRequest(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (request.headers.has("authorization")) return false;

  const url = new URL(request.url);
  return (
    url.pathname === "/" ||
    url.pathname === "/shop" ||
    url.pathname.startsWith("/product/")
  );
}

function cacheKey(request: Request) {
  const url = new URL(request.url);
  for (const key of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "fbclid",
    "gclid",
  ]) {
    url.searchParams.delete(key);
  }
  return new Request(url.toString(), { method: "GET" });
}

function snapshotAgeMs(response: Response) {
  const generatedAt = Number(response.headers.get("x-truely-edge-snapshot-at"));
  return Number.isFinite(generatedAt)
    ? Math.max(0, Date.now() - generatedAt)
    : Number.POSITIVE_INFINITY;
}

function cachedResponseForBrowser(response: Response, state: "HIT" | "STALE") {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("x-truely-edge-snapshot", state);
  headers.set("x-truely-origin", "cloudflare-worker");
  headers.set("x-truely-edge-version", EDGE_FAILSAFE_VERSION);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function responseForStorage(response: Response) {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  headers.set(
    "cache-control",
    `public, max-age=0, s-maxage=${STOREFRONT_EDGE_RETENTION_SECONDS}`,
  );
  headers.set("x-truely-edge-snapshot-at", String(Date.now()));
  headers.set("x-truely-origin", "cloudflare-worker");
  headers.set("x-truely-edge-version", EDGE_FAILSAFE_VERSION);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function canSnapshot(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  return response.ok && contentType.toLowerCase().includes("text/html");
}

async function renderAppWithHardTimeout(
  request: Request,
  env: any,
  ctx: ExecutionContextLike,
): Promise<Response> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const liveRequest = new Request(request, { signal: controller.signal });
    return await Promise.race([
      appWorker.fetch(liveRequest, env, ctx),
      new Promise<Response>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("storefront_origin_hard_timeout"));
        }, STOREFRONT_COLD_RENDER_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function refreshSnapshot(
  request: Request,
  env: any,
  ctx: ExecutionContextLike,
  cache: WorkerCache,
) {
  const response = await renderAppWithHardTimeout(request, env, ctx);
  if (!canSnapshot(response)) return;
  await cache.put(cacheKey(request), responseForStorage(response.clone()));
}

function edgeHealthResponse() {
  return new Response(
    JSON.stringify({
      ok: true,
      schema: "TRUELY_EDGE_HEALTH_V1",
      databaseIndependent: true,
      failsafeVersion: EDGE_FAILSAFE_VERSION,
      now: new Date().toISOString(),
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-truely-origin": "cloudflare-worker",
        "x-truely-edge-version": EDGE_FAILSAFE_VERSION,
      },
    },
  );
}

function emergencyBrowseResponse() {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Truely Collectables</title><style>body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;background:#f6f2e8;color:#111318}main{max-width:820px;margin:0 auto;padding:48px 24px}h1{font-size:42px;margin:0 0 18px}.box{background:white;border:1px solid #d8d2c4;border-radius:18px;padding:24px;box-shadow:0 10px 30px rgba(0,0,0,.06)}.strong{font-size:20px;font-weight:800}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px}a{display:inline-block;padding:12px 16px;border-radius:10px;background:#111318;color:white;text-decoration:none;font-weight:800}a.secondary{background:#ece7db;color:#111318}</style></head><body><main><h1>Truely Collectables</h1><div class="box"><p class="strong">The live inventory connection is temporarily unavailable.</p><p>Our storefront edge is still online. We will not guess inventory or accept a checkout against stale quantity data.</p><p>You can retry the shop, or contact us directly while the live catalog reconnects.</p><div class="actions"><a href="/shop">Retry the shop</a><a class="secondary" href="mailto:sales@truelycollectables.com">Email sales</a></div></div></main></body></html>`,
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store, max-age=0",
        "x-truely-origin": "cloudflare-worker",
        "x-truely-edge-snapshot": "MISS",
        "x-truely-edge-fallback": "EMERGENCY",
        "x-truely-edge-version": EDGE_FAILSAFE_VERSION,
      },
    },
  );
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContextLike) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/__edge-health") {
      return edgeHealthResponse();
    }

    if (request.method === "GET" && url.pathname === "/__emergency-store") {
      return emergencyBrowseResponse();
    }

    if (!isPublicBrowseRequest(request)) {
      return appWorker.fetch(request, env, ctx);
    }

    const cache = getDefaultCache();
    const key = cacheKey(request);
    const cached = cache ? await cache.match(key) : undefined;

    if (cached) {
      const age = snapshotAgeMs(cached);
      if (age > STOREFRONT_EDGE_FRESH_MS && cache) {
        ctx.waitUntil(
          refreshSnapshot(request, env, ctx, cache).catch((error) => {
            console.warn("Background storefront edge refresh failed", error);
          }),
        );
      }
      return cachedResponseForBrowser(
        cached,
        age <= STOREFRONT_EDGE_FRESH_MS ? "HIT" : "STALE",
      );
    }

    try {
      const response = await renderAppWithHardTimeout(request, env, ctx);
      if (cache && canSnapshot(response)) {
        ctx.waitUntil(
          cache
            .put(cacheKey(request), responseForStorage(response.clone()))
            .catch((error) => {
              console.warn("Storefront edge snapshot write failed", error);
            }),
        );
      }
      return response;
    } catch (error) {
      console.error("Cold storefront render failed", error);
      return emergencyBrowseResponse();
    }
  },

  async scheduled(controller: any, env: any, ctx: ExecutionContextLike) {
    return appWorker.scheduled?.(controller, env, ctx);
  },
};
