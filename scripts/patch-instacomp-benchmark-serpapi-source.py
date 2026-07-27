from __future__ import annotations

import re
from pathlib import Path


ROUTE = Path("src/app/api/instacomp/benchmark/ebay-25/route.ts")
JOB_SERVER = Path("src/lib/instacomp-job-server.ts")
SCAN_ROUTE = Path("src/app/api/instacomp/scan/route.ts")
LIVE_ROUTE = Path("src/app/api/instacomp/live-scan/route.ts")


def patch_benchmark_source() -> None:
    text = ROUTE.read_text()
    replacement = r'''async function searchEbay(testCase: InstaCompEbayBenchmarkCase) {
  const apiKey = clean(process.env.SERPAPI_API_KEY);
  if (!apiKey) {
    throw new Error("SERPAPI_API_KEY is not visible to the isolated benchmark runtime.");
  }

  const searchUrl = new URL("https://serpapi.com/search.json");
  searchUrl.searchParams.set("engine", "ebay");
  searchUrl.searchParams.set("ebay_domain", "ebay.com");
  searchUrl.searchParams.set("_nkw", testCase.searchQuery);
  searchUrl.searchParams.set("_ipg", String(MAX_EBAY_RESULTS));
  searchUrl.searchParams.set("api_key", apiKey);

  const searchResponse = await fetch(searchUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  const searchPayload: any = await searchResponse.json().catch(() => ({}));
  if (!searchResponse.ok || searchPayload?.error) {
    throw new Error(
      sanitizeInstaCompProviderError(
        `SerpApi eBay search failed (${searchResponse.status}): ${clean(searchPayload?.error || searchResponse.statusText)}`,
      ),
    );
  }

  const rows: any[] = Array.isArray(searchPayload?.organic_results)
    ? searchPayload.organic_results
    : [];
  const ranked = rows
    .map((row: any) => {
      const title = clean(row?.title);
      const productId = clean(row?.product_id || row?.productId);
      return {
        row,
        title,
        productId,
        score: titleScore(title, testCase.expected),
      };
    })
    .filter(
      (candidate: any) =>
        candidate.productId &&
        candidate.title &&
        benchmarkTitleEligible(candidate.title, testCase) &&
        candidate.score >= 65,
    )
    .sort((left: any, right: any) => right.score - left.score)
    .slice(0, MAX_CANDIDATES_TO_HYDRATE);

  const attempts: Array<Record<string, unknown>> = [];
  for (const candidate of ranked) {
    const productUrl = new URL("https://serpapi.com/search.json");
    productUrl.searchParams.set("engine", "ebay_product");
    productUrl.searchParams.set("product_id", candidate.productId);
    productUrl.searchParams.set("api_key", apiKey);

    const productResponse = await fetch(productUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const productPayload: any = await productResponse.json().catch(() => ({}));
    const product: any =
      productPayload?.product_results && typeof productPayload.product_results === "object"
        ? productPayload.product_results
        : {};
    const hydratedTitle = clean(product?.title || candidate.title);
    const media: any[] = Array.isArray(product?.media) ? product.media : [];
    const images = media
      .filter((entry: any) => clean(entry?.type).toLowerCase() === "image")
      .flatMap((entry: any) => (Array.isArray(entry?.image) ? entry.image : []))
      .map((image: any) => ({
        url: fullResolutionEbayImageUrl(image?.link),
        width: Number(image?.size?.width) || 0,
        height: Number(image?.size?.height) || 0,
      }))
      .filter((image: { url: string; width: number; height: number }) => Boolean(image.url));
    const bestByPictureId = new Map<
      string,
      { url: string; width: number; height: number }
    >();
    for (const image of images) {
      const pictureId = image.url.match(/\/images\/g\/([^/]+)\//)?.[1] || image.url;
      const current = bestByPictureId.get(pictureId);
      if (!current || image.width * image.height > current.width * current.height) {
        bestByPictureId.set(pictureId, image);
      }
    }
    const urls: string[] = Array.from(bestByPictureId.values())
      .sort(
        (left, right) =>
          right.width * right.height - left.width * left.height,
      )
      .map((image) => image.url);

    attempts.push({
      itemId: candidate.productId,
      title: hydratedTitle,
      titleScore: candidate.score,
      productHttpStatus: productResponse.status,
      mediaCount: media.length,
      imageCount: urls.length,
      productError: clean(productPayload?.error) || null,
    });

    if (
      productResponse.ok &&
      !productPayload?.error &&
      benchmarkTitleEligible(hydratedTitle, testCase) &&
      urls.length >= 2
    ) {
      const item: EbayItemSummary = {
        itemId: candidate.productId,
        legacyItemId: candidate.productId,
        title: hydratedTitle,
        itemWebUrl: clean(product?.product_link || candidate.row?.link),
        categories: Array.isArray(product?.categories)
          ? product.categories.map((category: any) => ({
              categoryId: clean(category?.id || category?.category_id) || undefined,
              categoryName: clean(category?.name || category?.category_name) || undefined,
            }))
          : [],
        localizedAspects: Array.isArray(product?.specifications)
          ? product.specifications.map((specification: any) => ({
              name: clean(specification?.name) || undefined,
              value: clean(specification?.value) || undefined,
            }))
          : [],
      };
      return { item, urls: urls.slice(0, 8), attempts, rawCount: rows.length };
    }
  }

  return { item: null, urls: [] as string[], attempts, rawCount: rows.length };
}'''

    pattern = re.compile(
        r"async function searchEbay\(testCase: InstaCompEbayBenchmarkCase\) \{.*?\n\}\n\nfunction outputText",
        re.S,
    )
    updated, count = pattern.subn(replacement + "\n\nfunction outputText", text, count=1)
    if count != 1:
        raise SystemExit("Could not replace the benchmark eBay source function exactly once.")
    ROUTE.write_text(updated)


def patch_ephemeral_admin_auth() -> None:
    text = JOB_SERVER.read_text()
    old_start = '''  // Fail closed before authentication. These routes must never silently fall
  // back to the anon key when they read or mutate the private job queue.
  const supabase = requireInstaCompJobSupabase();

  const storeId = getActiveStoreId();
  const token = bearerToken(request);
'''
    new_start = '''  const storeId = getActiveStoreId();

  // A cryptographically signed TCOS admin session can authorize a direct,
  // ephemeral scan without touching the persistent Supabase job queue.
  for (const cookieName of ADMIN_SESSION_COOKIE_NAMES) {
    const adminSession = cookieValue(request, cookieName);

    if (await isValidAdminSessionValue(adminSession)) {
      return {
        type: "admin",
        storeId,
        sellerAccountId: null,
      };
    }
  }

  // Seller bearer-token authentication and every persistent job operation
  // still fail closed unless the service-role client is configured.
  const supabase = requireInstaCompJobSupabase();
  const token = bearerToken(request);
'''
    if new_start not in text:
        if old_start not in text:
            raise SystemExit("Could not locate the InstaComp actor authentication prelude.")
        text = text.replace(old_start, new_start, 1)

    old_admin = '''  for (const cookieName of ADMIN_SESSION_COOKIE_NAMES) {
    const adminSession = cookieValue(request, cookieName);

    if (await isValidAdminSessionValue(adminSession)) {
      return {
        type: "admin",
        storeId,
        sellerAccountId: null,
      };
    }
  }

'''
    first = text.find(old_admin)
    second = text.find(old_admin, first + len(old_admin)) if first >= 0 else -1
    if second >= 0:
        text = text[:second] + text[second + len(old_admin):]
    JOB_SERVER.write_text(text)


def patch_identity_rate_limit() -> None:
    text = SCAN_ROUTE.read_text()
    old = '''    const rateLimit = await checkPublicEndpointRateLimit({
      request: req,
      endpointKey: "instacomp_scan",
      subjectKey:
        actor.type === "seller"
          ? `seller:${actor.sellerAccountId}`
          : `admin:${actor.storeId}`,
      maxAttempts: 1200,
      windowSeconds: 24 * 60 * 60,
    });

    if (!rateLimit.allowed) {
      const blocked = publicEndpointRateLimitResponse(rateLimit);
      return NextResponse.json(blocked.body, { status: blocked.status });
    }
'''
    new = '''    if (!ephemeralBenchmark) {
      const rateLimit = await checkPublicEndpointRateLimit({
        request: req,
        endpointKey: "instacomp_scan",
        subjectKey:
          actor.type === "seller"
            ? `seller:${actor.sellerAccountId}`
            : `admin:${actor.storeId}`,
        maxAttempts: 1200,
        windowSeconds: 24 * 60 * 60,
      });

      if (!rateLimit.allowed) {
        const blocked = publicEndpointRateLimitResponse(rateLimit);
        return NextResponse.json(blocked.body, { status: blocked.status });
      }
    }
'''
    if new not in text:
        if old not in text:
            raise SystemExit("Could not locate the identity-scan rate-limit block.")
        text = text.replace(old, new, 1)
    SCAN_ROUTE.write_text(text)


def patch_live_rate_limit() -> None:
    text = LIVE_ROUTE.read_text()
    helper = '''function authorizedEphemeralBenchmark(request: NextRequest) {
  if (String(process.env.VERCEL_ENV || "").trim() !== "preview") return false;
  const expected = String(process.env.INSTACOMP_BENCHMARK_TOKEN || "").trim();
  const supplied = String(request.headers.get("x-instacomp-benchmark-ephemeral") || "").trim();
  if (expected.length < 32 || supplied.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  }
  return mismatch === 0;
}

'''
    marker = 'async function authorizeLiveScan(request: NextRequest) {'
    if helper not in text:
        if marker not in text:
            raise SystemExit("Could not locate live-scan authorization helper.")
        text = text.replace(marker, helper + marker, 1)

    old = '''async function authorizeLiveScan(request: NextRequest) {
  const actor = await requireInstaCompJobActor(request);
  const rateLimit = await checkPublicEndpointRateLimit({
    request,
    endpointKey: "instacomp_live_scan",
    subjectKey:
      actor.type === "seller"
        ? `seller:${actor.sellerAccountId}`
        : `admin:${actor.storeId}`,
    maxAttempts: 600,
    windowSeconds: 24 * 60 * 60,
  });

  if (!rateLimit.allowed) {
    const blocked = publicEndpointRateLimitResponse(rateLimit);
    return NextResponse.json(blocked.body, { status: blocked.status });
  }

  return null;
}
'''
    new = '''async function authorizeLiveScan(request: NextRequest) {
  const actor = await requireInstaCompJobActor(request);
  if (authorizedEphemeralBenchmark(request)) return null;

  const rateLimit = await checkPublicEndpointRateLimit({
    request,
    endpointKey: "instacomp_live_scan",
    subjectKey:
      actor.type === "seller"
        ? `seller:${actor.sellerAccountId}`
        : `admin:${actor.storeId}`,
    maxAttempts: 600,
    windowSeconds: 24 * 60 * 60,
  });

  if (!rateLimit.allowed) {
    const blocked = publicEndpointRateLimitResponse(rateLimit);
    return NextResponse.json(blocked.body, { status: blocked.status });
  }

  return null;
}
'''
    if new not in text:
        if old not in text:
            raise SystemExit("Could not locate the live-scan rate-limit block.")
        text = text.replace(old, new, 1)
    LIVE_ROUTE.write_text(text)


def main() -> None:
    patch_benchmark_source()
    patch_ephemeral_admin_auth()
    patch_identity_rate_limit()
    patch_live_rate_limit()


if __name__ == "__main__":
    main()
