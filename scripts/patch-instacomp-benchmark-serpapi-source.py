from __future__ import annotations

import re
from pathlib import Path


ROUTE = Path("src/app/api/instacomp/benchmark/ebay-25/route.ts")


def main() -> None:
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
  const searchPayload = await searchResponse.json().catch(() => ({}));
  if (!searchResponse.ok || searchPayload?.error) {
    throw new Error(
      sanitizeInstaCompProviderError(
        `SerpApi eBay search failed (${searchResponse.status}): ${clean(searchPayload?.error || searchResponse.statusText)}`,
      ),
    );
  }

  const rows = Array.isArray(searchPayload?.organic_results)
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
    const productPayload = await productResponse.json().catch(() => ({}));
    const product =
      productPayload?.product_results && typeof productPayload.product_results === "object"
        ? productPayload.product_results
        : {};
    const hydratedTitle = clean(product?.title || candidate.title);
    const media = Array.isArray(product?.media) ? product.media : [];
    const urls = Array.from(
      new Set(
        media
          .filter((entry: any) => clean(entry?.type).toLowerCase() === "image")
          .flatMap((entry: any) => (Array.isArray(entry?.image) ? entry.image : []))
          .map((image: any) => ({
            url: fullResolutionEbayImageUrl(image?.link),
            width: Number(image?.size?.width) || 0,
            height: Number(image?.size?.height) || 0,
          }))
          .filter((image: any) => image.url)
          .sort(
            (left: any, right: any) =>
              right.width * right.height - left.width * left.height,
          )
          .map((image: any) => image.url),
      ),
    );

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


if __name__ == "__main__":
    main()
