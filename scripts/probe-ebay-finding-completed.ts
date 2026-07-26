import fs from "node:fs";

type Fixture = {
  cards: Array<{
    id: string;
    ai: {
      player?: string | null;
      year?: string | null;
      cardNumber?: string | null;
      parallel?: string | null;
      serialNumber?: string | null;
      gradingCompany?: string | null;
      gradeValue?: string | null;
    };
  }>;
};

function queryFor(card: Fixture["cards"][number]) {
  const denominator = String(card.ai.serialNumber || "").match(/\/(\d{1,6})\b/)?.[1];
  return [
    card.ai.year,
    card.ai.player,
    card.ai.cardNumber ? `#${String(card.ai.cardNumber).replace(/^#/, "")}` : null,
    card.ai.parallel && !/^base\b/i.test(card.ai.parallel) ? card.ai.parallel : null,
    denominator ? `/${Number(denominator)}` : null,
    card.ai.gradingCompany,
    card.ai.gradeValue,
  ]
    .filter(Boolean)
    .join(" ");
}

function first<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function main() {
  const appId = String(process.env.EBAY_CLIENT_ID || "").trim();
  if (!appId) throw new Error("EBAY_CLIENT_ID is not configured.");
  const fixture = JSON.parse(
    fs.readFileSync("scripts/fixtures/instacomp-batch-001-exact-market.json", "utf8"),
  ) as Fixture;

  const reports: Array<Record<string, unknown>> = [];
  for (const card of fixture.cards) {
    const query = queryFor(card);
    const url = new URL("https://svcs.ebay.com/services/search/FindingService/v1");
    url.searchParams.set("OPERATION-NAME", "findCompletedItems");
    url.searchParams.set("SERVICE-VERSION", "1.13.0");
    url.searchParams.set("SECURITY-APPNAME", appId);
    url.searchParams.set("RESPONSE-DATA-FORMAT", "JSON");
    url.searchParams.set("REST-PAYLOAD", "");
    url.searchParams.set("keywords", query);
    url.searchParams.set("itemFilter(0).name", "SoldItemsOnly");
    url.searchParams.set("itemFilter(0).value", "true");
    url.searchParams.set("paginationInput.entriesPerPage", "50");
    url.searchParams.set("outputSelector(0)", "SellerInfo");

    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(45_000),
        headers: { "User-Agent": "TCOS-InstaComp-Finding-Probe/1.0" },
      });
      const text = await response.text();
      let payload: any = null;
      try {
        payload = JSON.parse(text);
      } catch {}
      const root: any = first(payload?.findCompletedItemsResponse) || {};
      const ack = first(root.ack) || null;
      const error: any = first(root.errorMessage?.[0]?.error);
      const items: any[] = first<any>(root.searchResult)?.item || [];
      reports.push({
        id: card.id,
        query,
        httpStatus: response.status,
        ack,
        error: error
          ? {
              code: first(error.errorId) || null,
              severity: first(error.severity) || null,
              message: first(error.message) || null,
              parameter: error.parameter || null,
            }
          : null,
        count: Array.isArray(items) ? items.length : 0,
        samples: (Array.isArray(items) ? items : []).slice(0, 5).map((item: any) => ({
          itemId: first(item.itemId) || null,
          title: first(item.title) || null,
          url: first(item.viewItemURL) || null,
          imageUrl: first(item.galleryURL) || null,
          itemPrice: Number(first<any>(item.sellingStatus)?.currentPrice?.[0]?.__value__ || 0),
          shippingPrice: Number(first<any>(item.shippingInfo)?.shippingServiceCost?.[0]?.__value__ || 0),
          soldAt: first<any>(item.listingInfo)?.endTime?.[0] || null,
          sellingState: first(first<any>(item.sellingStatus)?.sellingState) || null,
        })),
        responsePrefix: payload ? null : text.slice(0, 500),
      });
    } catch (error) {
      reports.push({
        id: card.id,
        query,
        error: error instanceof Error ? error.message : String(error),
        count: 0,
        samples: [],
      });
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    provider: "ebay_finding_findCompletedItems",
    accessible: reports.some((row: any) => row.ack === "Success" && Number(row.count) > 0),
    reports,
  };
  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync(
    "docs/instacomp-ebay-finding-completed-probe.json",
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(JSON.stringify(result, null, 2));
  if (!result.accessible) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
