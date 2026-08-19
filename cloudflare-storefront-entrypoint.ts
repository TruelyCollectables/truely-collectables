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
  // Tracking parameters do not change storefront content and would otherwise
  // create thousands of duplicate cache entries.
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"]) {
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

async function refreshSnapshot(
  request: Request,
  env: any,
  ctx: ExecutionContextLike,
  cache: WorkerCache,
) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    STOREFRONT_COLD_RENDER_TIMEOUT_MS,
  );

  try {
    const liveRequest = new Request(request, { signal: controller.signal });
    const response = await appWorker.fetch(liveRequest, env, ctx);
    if (!canSnapshot(response)) return;
    await cache.put(cacheKey(request), responseForStorage(response.clone()));
  } finally {
    clearTimeout(timeout);
  }
}

function emergencyBrowseResponse() {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Truely Collectables</title></head><body style="font-family:system-ui,sans-serif;margin:0;background:#f6f2e8;color:#111318"><main style="max-width:760px;margin:0 auto;padding:48px 24px"><h1 style="font-size:42px;margin:0 0 18px">Truely Collectables</h1><p style="font-size:20px;font-weight:700">Inventory is reconnecting.</p><p>The storefront is online, but the live catalog could not be loaded safely. Retry in a moment. Checkout is never allowed to guess inventory.</p><p><a href="/shop" style="font-weight:800;color:#111318">Retry the shop →</a></p></main></body></html>`,
    {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store, max-age=0",
        "x-truely-origin": "cloudflare-worker",
        "x-truely-edge-snapshot": "MISS",
      },
    },
  );
}

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContextLike) {
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

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      STOREFRONT_COLD_RENDER_TIMEOUT_MS,
    );

    try {
      const liveRequest = new Request(request, { signal: controller.signal });
      const response = await appWorker.fetch(liveRequest, env, ctx);
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
    } finally {
      clearTimeout(timeout);
    }
  },

  async scheduled(controller: any, env: any, ctx: ExecutionContextLike) {
    return appWorker.scheduled?.(controller, env, ctx);
  },
};
