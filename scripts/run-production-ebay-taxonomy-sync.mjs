import fs from "node:fs";
import path from "node:path";

const origin = process.env.PRODUCTION_ORIGIN || "https://truelycollectables.com";
const limit = Number(process.env.EBAY_IMPORT_LIMIT || 100);
const maxPages = Number(process.env.EBAY_IMPORT_MAX_PAGES || 25);
const runId = `storefront-taxonomy-${process.env.GITHUB_RUN_ID || "manual"}-${Date.now()}`;
const outputDir = path.resolve("ebay-taxonomy-sync");
const pageDir = path.join(outputDir, "pages");
const storefrontDir = path.join(outputDir, "storefront");

fs.mkdirSync(pageDir, { recursive: true });
fs.mkdirSync(storefrontDir, { recursive: true });

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function cleanError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/\s+/g, " ")
    .slice(0, 1000);
}

async function fetchText(url, timeoutMs) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json,text/html;q=0.9,*/*;q=0.8",
      "cache-control": "no-cache",
      "user-agent": "TCOS-Authorized-Ebay-Taxonomy-Sync/2.0",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { response, text: await response.text() };
}

async function runImport() {
  const totals = {
    imported: 0,
    markedSold: 0,
    skipped: 0,
    policyAllowed: 0,
    policyNeedsReview: 0,
    policyBlocked: 0,
    received: 0,
  };
  const pages = [];
  let offset = 0;
  let finalImageSync = null;

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL("/api/ebay/import-listings", origin);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("runId", runId);
    console.log(`[import] page=${page} offset=${offset} limit=${limit}`);

    const { response, text } = await fetchText(url, 295_000);
    const receiptPath = path.join(
      pageDir,
      `page-${String(page).padStart(2, "0")}-offset-${offset}.json`,
    );
    fs.writeFileSync(receiptPath, `${text}\n`);

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      console.error(`[import] HTTP=${response.status} invalid-json=${text.slice(0, 500).replace(/\s+/g, " ")}`);
      throw new Error(`Import page ${page} returned HTTP ${response.status} without valid JSON.`);
    }

    const diagnostic = {
      page,
      httpStatus: response.status,
      success: payload?.success ?? response.ok,
      error: payload?.error || null,
      offset: payload?.offset ?? offset,
      received: payload?.received ?? null,
      imported: payload?.imported ?? null,
      skipped: payload?.skipped ?? null,
      markedSold: payload?.markedSold ?? null,
      nextOffset: payload?.nextOffset ?? null,
      debugReasons: Array.isArray(payload?.debugSamples)
        ? payload.debugSamples.map((sample) => String(sample?.reason || "unknown")).slice(0, 10)
        : [],
    };
    console.log(`[import] receipt=${JSON.stringify(diagnostic)}`);

    if (!response.ok || payload?.success === false) {
      throw new Error(
        `Import page ${page} failed with HTTP ${response.status}: ${cleanError(payload?.error || "unknown import failure")}`,
      );
    }
    if (Number(payload.offset) !== offset) {
      throw new Error(`Import page ${page} reported offset ${payload.offset}; expected ${offset}.`);
    }

    for (const key of Object.keys(totals)) {
      totals[key] += Number(payload[key] || 0);
    }

    pages.push({
      page,
      offset,
      limit: Number(payload.limit || limit),
      received: Number(payload.received || 0),
      imported: Number(payload.imported || 0),
      markedSold: Number(payload.markedSold || 0),
      skipped: Number(payload.skipped || 0),
      policyAllowed: Number(payload.policyAllowed || 0),
      policyNeedsReview: Number(payload.policyNeedsReview || 0),
      policyBlocked: Number(payload.policyBlocked || 0),
      nextOffset: payload.nextOffset ?? null,
      debugReasons: diagnostic.debugReasons,
    });

    if (payload.nextOffset === null || payload.nextOffset === undefined) {
      finalImageSync = payload.imageSync ?? null;
      break;
    }

    const nextOffset = Number(payload.nextOffset);
    if (!Number.isInteger(nextOffset) || nextOffset <= offset) {
      throw new Error(`Import did not advance: offset=${offset}, nextOffset=${payload.nextOffset}.`);
    }
    offset = nextOffset;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  if (!pages.length) throw new Error("Import produced no successful page receipts.");
  if (pages.at(-1)?.nextOffset !== null) {
    throw new Error(`Import exceeded the ${maxPages}-page safety cap before completion.`);
  }

  const summary = {
    schema: "truelycollectables.ebayTaxonomySync.v2",
    generatedAt: new Date().toISOString(),
    origin,
    runId,
    pageCount: pages.length,
    totals,
    finalImageSync,
    pages,
    success: true,
  };
  writeJson(path.join(outputDir, "summary.json"), summary);
  fs.writeFileSync(
    path.join(outputDir, "summary.md"),
    [
      "# Production eBay taxonomy sync",
      "",
      `- Run ID: ${runId}`,
      `- Pages: ${pages.length}`,
      `- Received: ${totals.received}`,
      `- Imported: ${totals.imported}`,
      `- Marked sold/inactive: ${totals.markedSold}`,
      `- Skipped: ${totals.skipped}`,
      `- Policy allowed: ${totals.policyAllowed}`,
      `- Policy review: ${totals.policyNeedsReview}`,
      `- Policy blocked: ${totals.policyBlocked}`,
      `- Final image sync: ${finalImageSync ? "reported" : "not reported"}`,
      "",
    ].join("\n"),
  );
  console.log(`[import] complete pages=${pages.length} totals=${JSON.stringify(totals)}`);
  return summary;
}

async function verifyStorefront() {
  const marker = "Sports stay in their correct section.";
  const checks = [
    { key: "all", pathname: "/shop", expected: "Shop Sports Cards", requireItems: true },
    { key: "wnba", pathname: "/shop?section=WNBA", expected: "WNBA", requireItems: true },
    { key: "baseball", pathname: "/shop?section=Baseball", expected: "Baseball", requireItems: true },
    { key: "autographs", pathname: "/shop?feature=autograph", expected: "Autographs", requireItems: true },
    { key: "legacy-autos-link", pathname: "/shop?q=autograph", expected: "Shop Sports Cards", requireItems: true },
  ];
  const results = [];

  for (const check of checks) {
    const url = new URL(check.pathname, origin);
    const { response, text: html } = await fetchText(url, 60_000);
    fs.writeFileSync(path.join(storefrontDir, `${check.key}.html`), html);
    const countMatch = html.match(/>([\d,]+) active cards</i);
    const activeCards = countMatch ? Number(countMatch[1].replaceAll(",", "")) : null;
    const result = {
      key: check.key,
      url: url.toString(),
      status: response.status,
      markerPresent: html.includes(marker),
      expectedPresent: html.includes(check.expected),
      activeCards,
    };
    results.push(result);
    console.log(`[storefront] ${JSON.stringify(result)}`);

    if (!response.ok) throw new Error(`${check.key} returned HTTP ${response.status}.`);
    if (!result.markerPresent) throw new Error(`${check.key} did not show the deployed taxonomy marker.`);
    if (!result.expectedPresent) throw new Error(`${check.key} did not show expected text ${check.expected}.`);
    if (check.requireItems && (!Number.isInteger(activeCards) || activeCards < 1)) {
      throw new Error(`${check.key} returned no active storefront items after sync.`);
    }
  }

  const verification = {
    generatedAt: new Date().toISOString(),
    success: true,
    results,
  };
  writeJson(path.join(outputDir, "storefront-verification.json"), verification);
  return verification;
}

try {
  const importSummary = await runImport();
  const storefrontVerification = await verifyStorefront();
  writeJson(path.join(outputDir, "final-result.json"), {
    success: true,
    importSummary,
    storefrontVerification,
  });
} catch (error) {
  const failure = {
    success: false,
    generatedAt: new Date().toISOString(),
    runId,
    error: cleanError(error),
  };
  writeJson(path.join(outputDir, "failure.json"), failure);
  console.error(`[failure] ${failure.error}`);
  process.exitCode = 1;
}
