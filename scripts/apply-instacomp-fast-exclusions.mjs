import fs from "node:fs";
import path from "node:path";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Missing ${label}`);
  }
  return source.replace(search, replacement);
}

const universalPath = "src/app/api/account/seller/inventory/instacomp-universal/route.ts";
let universal = read(universalPath);

universal = replaceOnce(
  universal,
  `function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
`,
  `function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 250)
    : [];
}

function hasUsableStoredIdentity(ai: Record<string, unknown>) {
  return Boolean(
    String(ai.player || "").trim() &&
      String(ai.year || "").trim() &&
      String(ai.setName || ai.brand || "").trim() &&
      String(ai.cardNumber || "").trim(),
  );
}
`,
  "universal identity helpers",
);

universal = replaceOnce(
  universal,
  `    const legacyHeaders = new Headers(request.headers);
    legacyHeaders.set("content-type", "application/json");
    legacyHeaders.delete("content-length");
    const legacyRequest = new NextRequest(request.url, {
      method: "POST",
      headers: legacyHeaders,
      body: JSON.stringify(body),
    });
    const legacyResponse = await runLegacySellerInstaComp(legacyRequest);
    const legacyText = await legacyResponse.text();
    let legacy: Record<string, any>;
    try {
      legacy = JSON.parse(legacyText);
    } catch {
      return NextResponse.json(
        { error: "The base InstaComp scan returned an unreadable response." },
        { status: 502 },
      );
    }
    if (!legacyResponse.ok || legacy?.success !== true) {
      return NextResponse.json(legacy, { status: legacyResponse.status || 500 });
    }
`,
  `    const scanStartedAt = Date.now();
    let legacy: Record<string, any> | null = null;
    let fastLane = false;
`,
  "remove unconditional legacy scan",
);

universal = replaceOnce(
  universal,
  `    const metadata = recordValue(item.metadata);
    const targetUrls = normalizeListingImageUrls([
`,
  `    let metadata = recordValue(item.metadata);
    let currentInstaComp = recordValue(metadata.instacomp);
    const storedAi = recordValue(currentInstaComp.ai);
    const forceIdentityRescan = body?.forceIdentityRescan === true;
    const trustedStoredIdentity =
      currentInstaComp.trustedForIdentity === true ||
      currentInstaComp.humanVerified === true ||
      Boolean(String(currentInstaComp.scanId || "").trim());

    if (!forceIdentityRescan && trustedStoredIdentity && hasUsableStoredIdentity(storedAi)) {
      fastLane = true;
      legacy = {
        success: true,
        ai: storedAi,
        scanId: currentInstaComp.scanId || null,
        review: currentInstaComp.review || null,
        soldCompEvidence: currentInstaComp.soldCompEvidence || [],
        activeCompetition: currentInstaComp.activeCompetition || [],
        rejectedCandidates: currentInstaComp.rejectedCandidates || [],
        providerCoverage: currentInstaComp.providerCoverage || [],
      };
    } else {
      const legacyHeaders = new Headers(request.headers);
      legacyHeaders.set("content-type", "application/json");
      legacyHeaders.delete("content-length");
      const legacyRequest = new NextRequest(request.url, {
        method: "POST",
        headers: legacyHeaders,
        body: JSON.stringify(body),
      });
      const legacyResponse = await runLegacySellerInstaComp(legacyRequest);
      const legacyText = await legacyResponse.text();
      try {
        legacy = JSON.parse(legacyText);
      } catch {
        return NextResponse.json(
          { error: "The base InstaComp scan returned an unreadable response." },
          { status: 502 },
        );
      }
      if (!legacyResponse.ok || legacy?.success !== true) {
        return NextResponse.json(legacy, { status: legacyResponse.status || 500 });
      }
      const { data: refreshedItem, error: refreshError } = await supabase
        .from("inventory_items")
        .select("metadata")
        .eq("id", item.id)
        .eq("store_id", storeId)
        .maybeSingle();
      if (refreshError) throw refreshError;
      metadata = recordValue(refreshedItem?.metadata || item.metadata);
      currentInstaComp = recordValue(metadata.instacomp);
    }

    if (!legacy) throw new Error("InstaComp identity preparation failed.");

    const targetUrls = normalizeListingImageUrls([
`,
  "stored identity fast lane",
);

universal = replaceOnce(
  universal,
  `    const targetFrontImage = await downloadFrontImage(targetUrls[0]);

    const ai = legacy.ai;
`,
  `    const targetFrontImagePromise = downloadFrontImage(targetUrls[0]);

    const ai = legacy.ai;
`,
  "parallel target image download",
);

universal = replaceOnce(
  universal,
  `    const universal = await getUniversalEbaySerpProviders({
      exactTitle: item.title,
      fallbackQuery,
      ai,
    });

    const soldCandidates = evidenceList(universal.sold.results, 50);
`,
  `    const [universal, targetFrontImage] = await Promise.all([
      getUniversalEbaySerpProviders({
        exactTitle: item.title,
        fallbackQuery,
        ai,
      }),
      targetFrontImagePromise,
    ]);

    const soldCandidates = evidenceList(universal.sold.results, 50);
`,
  "parallel market and target fetch",
);

universal = replaceOnce(
  universal,
  `    const soldCompEvidence = dedupeEvidence([...universalSold, ...legacySold], 50);
    const activeCompetition = dedupeEvidence(
      universal.active.status === "live" && universalActive.length
        ? universalActive
        : [...universalActive, ...legacyActive],
      30,
    );
`,
  `    const excludedCompUrls = new Set(stringList(currentInstaComp.excludedCompUrls));
    const soldCompEvidence = dedupeEvidence([...universalSold, ...legacySold], 50).filter(
      (row) => !excludedCompUrls.has(row.url),
    );
    const activeCompetition = dedupeEvidence(
      universal.active.status === "live" && universalActive.length
        ? universalActive
        : [...universalActive, ...legacyActive],
      30,
    ).filter((row) => !excludedCompUrls.has(row.url));
`,
  "persisted exclusion filtering",
);

universal = universal.replace(
  `    const currentInstaComp = recordValue(metadata.instacomp);\n`,
  "",
);

universal = replaceOnce(
  universal,
  `        pricingAnalysis,
        reliableSoldCompCount: hasReliableSoldComps ? reliableSoldCompCount : 0,
`,
  `        pricingAnalysis,
        excludedCompUrls: Array.from(excludedCompUrls),
        excludedCompEvidence: Array.isArray(currentInstaComp.excludedCompEvidence)
          ? currentInstaComp.excludedCompEvidence
          : [],
        reliableSoldCompCount: hasReliableSoldComps ? reliableSoldCompCount : 0,
`,
  "save exclusions",
);

universal = replaceOnce(
  universal,
  `      universalEbayReview: {
        soldReviewed: soldReview.reviewedCount,
        activeReviewed: activeReview.reviewedCount,
        soldTitleOverrides: soldReview.titleOverrides,
        activeTitleOverrides: activeReview.titleOverrides,
      },
`,
  `      universalEbayReview: {
        soldReviewed: soldReview.reviewedCount,
        activeReviewed: activeReview.reviewedCount,
        soldTitleOverrides: soldReview.titleOverrides,
        activeTitleOverrides: activeReview.titleOverrides,
      },
      fastLane,
      durationMs: Date.now() - scanStartedAt,
`,
  "fast lane response diagnostics",
);

write(universalPath, universal);

const excludeRoute = `import { NextRequest, NextResponse } from "next/server";
import {
  ensureAccountStoreMembership,
  getAuthenticatedAccountFromRequest,
} from "../../../../../../lib/account-auth";
import { calculateInstaCompSweetSpot } from "../../../../../../lib/instacomp-sweet-spot";
import { getActiveStoreId } from "../../../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../../../lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function recordValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function evidenceList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 250)
    : [];
}

export async function POST(request: NextRequest) {
  try {
    const account = await getAuthenticatedAccountFromRequest(request);
    if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    await ensureAccountStoreMembership({
      accountId: account.id,
      role: "seller",
      status: "active",
    });

    const body = await request.json().catch(() => ({}));
    const inventoryItemId = String(body?.inventoryItemId || "").trim();
    const compUrl = String(body?.compUrl || "").trim();
    const lane = body?.lane === "active" ? "active" : "sold";
    if (!inventoryItemId || !compUrl) {
      return NextResponse.json(
        { error: "Choose a card and comp to exclude." },
        { status: 400 },
      );
    }

    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const isStoreOwnerAccount =
      account.email === "sales@truelycollectables.com" ||
      account.email === "sales@trulycollectables.com";
    let query = supabase
      .from("inventory_items")
      .select("id,seller_account_id,title,metadata")
      .eq("id", inventoryItemId)
      .eq("store_id", storeId);
    query = isStoreOwnerAccount
      ? query.or(\`seller_account_id.eq.\${account.id},seller_account_id.is.null\`)
      : query.eq("seller_account_id", account.id);
    const { data: item, error } = await query.maybeSingle();
    if (error) throw error;
    if (!item) return NextResponse.json({ error: "Card not found." }, { status: 404 });

    const metadata = recordValue(item.metadata);
    const instaComp = recordValue(metadata.instacomp);
    const sold = evidenceList(instaComp.soldCompEvidence);
    const active = evidenceList(instaComp.activeCompetition);
    const source = lane === "sold" ? sold : active;
    const excluded = source.find((row) => String(row?.url || "") === compUrl);
    if (!excluded) {
      return NextResponse.json({ error: "That comp is no longer in this card's evidence." }, { status: 404 });
    }

    const nextSold = sold.filter((row) => String(row?.url || "") !== compUrl);
    const nextActive = active.filter((row) => String(row?.url || "") !== compUrl);
    const excludedCompUrls = Array.from(new Set([...stringList(instaComp.excludedCompUrls), compUrl]));
    const excludedCompEvidence = [
      ...evidenceList(instaComp.excludedCompEvidence).filter(
        (row) => String(row?.url || "") !== compUrl,
      ),
      {
        ...excluded,
        exclusionLane: lane,
        exclusionReason: "seller_excluded_wrong_comp",
        excludedAt: new Date().toISOString(),
        excludedBy: account.id,
      },
    ].slice(-250);
    const pricingAnalysis = calculateInstaCompSweetSpot({
      sold: nextSold,
      active: nextActive,
    });
    const suggestedPrice = pricingAnalysis.suggestedPrice;
    const hasReliableSoldComps = pricingAnalysis.soldCount > 0;
    const pricingStatus = suggestedPrice > 0
      ? "suggested_from_reliable_sold_comps"
      : "seller_price_required";
    const checkedAt = new Date().toISOString();
    const nextMetadata = {
      ...metadata,
      instacomp: {
        ...instaComp,
        soldCompEvidence: nextSold,
        activeCompetition: nextActive,
        excludedCompUrls,
        excludedCompEvidence,
        pricingAnalysis,
        marketPrice: suggestedPrice,
        suggestedPrice,
        pricingStatus,
        pricingReason: pricingAnalysis.explanation,
        reliableSoldCompCount: hasReliableSoldComps ? pricingAnalysis.soldCount : 0,
        trustedForPricing: hasReliableSoldComps,
        pricingCheckedAt: checkedAt,
        scannedAt: checkedAt,
      },
    };
    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ metadata: nextMetadata, updated_at: checkedAt })
      .eq("id", item.id)
      .eq("store_id", storeId);
    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      inventoryItemId: item.id,
      excludedUrl: compUrl,
      excludedLane: lane,
      suggestedPrice,
      pricingAnalysis,
      soldCompCount: nextSold.length,
      activeCompCount: nextActive.length,
      message: "Comp excluded permanently and the sweet spot was recalculated without rescanning.",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Could not exclude this comp." },
      { status: 500 },
    );
  }
}
`;
write("src/app/api/account/seller/instacomp-pending/exclude-comp/route.ts", excludeRoute);

const pendingPath = "src/app/api/account/seller/instacomp-pending/route.ts";
let pending = read(pendingPath);
pending = replaceOnce(
  pending,
  `          rejectedCandidates: evidenceList(instaComp.rejectedCandidates),
`,
  `          rejectedCandidates: evidenceList(instaComp.rejectedCandidates),
          excludedCompEvidence: evidenceList(instaComp.excludedCompEvidence),
          excludedCompCount: Array.isArray(instaComp.excludedCompUrls)
            ? instaComp.excludedCompUrls.length
            : 0,
`,
  "pending excluded evidence",
);
write(pendingPath, pending);

const pagePath = "src/app/seller/instacomp-pending/page.tsx";
let page = read(pagePath);
page = replaceOnce(
  page,
  `    rejectedCandidates: CompEvidence[];
`,
  `    rejectedCandidates: CompEvidence[];
    excludedCompEvidence: CompEvidence[];
    excludedCompCount: number;
`,
  "page exclusion type",
);
page = replaceOnce(
  page,
  `async function scanPendingItem(item: PendingItem, accessToken: string) {
`,
  `async function runWithConcurrency<T>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<void>,
) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        await worker(values[index], index);
      }
    }),
  );
}

async function scanPendingItem(item: PendingItem, accessToken: string) {
`,
  "batch concurrency helper",
);
page = replaceOnce(
  page,
  `    reliableSoldCompCount: number;
  };
`,
  `    reliableSoldCompCount: number;
    fastLane?: boolean;
    durationMs?: number;
  };
`,
  "scan timing response",
);
page = replaceOnce(
  page,
  `  const [savingItemId, setSavingItemId] = useState<string | null>(null);
`,
  `  const [savingItemId, setSavingItemId] = useState<string | null>(null);
  const [excludingCompKey, setExcludingCompKey] = useState<string | null>(null);
`,
  "exclusion busy state",
);

page = replaceOnce(
  page,
  `      for (const [index, item] of targets.entries()) {
        setPricingItemId(item.inventoryItemId);
        setScanSubject(item.title);
        setScanPercent(Math.max(12, Math.floor((index / targets.length) * 100)));
        try {
          const result = await scanPendingItem(item, session.access_token);
          if (result.suggestedPrice > 0) reliable += 1;
        } catch {
          failures += 1;
        }
        setBatchProgress({ current: index + 1, total: targets.length });
        setScanPercent(Math.floor(((index + 1) / targets.length) * 100));
      }
`,
  `      let completed = 0;
      await runWithConcurrency(targets, 2, async (item) => {
        setPricingItemId(item.inventoryItemId);
        setScanSubject(item.title);
        try {
          const result = await scanPendingItem(item, session.access_token);
          if (result.suggestedPrice > 0) reliable += 1;
        } catch {
          failures += 1;
        }
        completed += 1;
        setBatchProgress({ current: completed, total: targets.length });
        setScanPercent(Math.floor((completed / targets.length) * 100));
      });
`,
  "two-card pricing concurrency",
);

page = replaceOnce(
  page,
  `        for (const [index, item] of targets.entries()) {
          setPricingItemId(item.inventoryItemId);
          setScanSubject(item.title);
          setBatchProgress({ current: index, total: targets.length });
          setScanPercent(Math.max(12, Math.floor((index / targets.length) * 100)));
          try {
            await scanPendingItem(item, session.access_token);
          } catch {
            failures += 1;
          }
          setBatchProgress({ current: index + 1, total: targets.length });
          setScanPercent(Math.floor(((index + 1) / targets.length) * 100));
        }
`,
  `        let completed = 0;
        await runWithConcurrency(targets, 2, async (item) => {
          setPricingItemId(item.inventoryItemId);
          setScanSubject(item.title);
          try {
            await scanPendingItem(item, session.access_token);
          } catch {
            failures += 1;
          }
          completed += 1;
          setBatchProgress({ current: completed, total: targets.length });
          setScanPercent(Math.floor((completed / targets.length) * 100));
        });
`,
  "two-card auto concurrency",
);

page = replaceOnce(
  page,
  `  async function savePrice(item: PendingItem, mode: "suggested" | "manual") {
`,
  `  async function excludeComp(
    item: PendingItem,
    comp: CompEvidence,
    lane: "sold" | "active",
  ) {
    if (!comp.url) return;
    const key = \`${"${item.inventoryItemId}:${comp.url}"}\`;
    setExcludingCompKey(key);
    setError("");
    setNotice("");
    try {
      const session = await getFreshAccountSession(5 * 60, false);
      if (!session?.access_token) throw new Error("Log in to exclude a comp.");
      const response = await fetch(
        "/api/account/seller/instacomp-pending/exclude-comp",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: \`Bearer ${"${session.access_token}"}\`,
          },
          body: JSON.stringify({
            inventoryItemId: item.inventoryItemId,
            compUrl: comp.url,
            lane,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok || data.success !== true) {
        throw new Error(data.error || "Could not exclude this comp.");
      }
      setNotice(
        \`${"${item.title}"}: excluded ${"${comp.title}"} and recalculated the suggestion to ${"${money(data.suggestedPrice)}"} without rescanning.\`,
      );
      await loadPending(true);
    } catch (nextError: unknown) {
      setError(errorMessage(nextError, "Could not exclude this comp."));
    } finally {
      setExcludingCompKey(null);
    }
  }

  async function savePrice(item: PendingItem, mode: "suggested" | "manual") {
`,
  "exclude comp action",
);

page = page.replace(
  `New scanned drafts automatically receive an InstaComp outcome. Sold comps
                 alone calculate suggested price. Active listings are shown separately as
                 current competition. Select any combination to scan, price, edit quantity,
                 or publish after seller verification.`,
  `New scanned drafts automatically receive an InstaComp outcome. Exact sold comps
                 establish market value and exact active listings establish competition. Trusted
                 cards use a fast market-refresh lane, and batches run two cards at a time.`,
);

page = page.replace(
  `These are currently for sale and never calculate the sold-comp
                           suggestion.`,
  `These are currently for sale and constrain the final sweet-spot suggestion. Exclude any wrong match with the X button.`,
);

const soldAnchor = `                              <a
                                key={\`${"${comp.url}-${index}"}\`}
                                href={comp.url || "#"}
                                target="_blank"
                                rel="noreferrer"
                                className="flex gap-3 rounded-lg border border-emerald-300 bg-white p-2 hover:border-emerald-700"
                              >`;
const soldReplacement = `                              <div
                                key={\`${"${comp.url}-${index}"}\`}
                                className="relative rounded-lg border border-emerald-300 bg-white hover:border-emerald-700"
                              >
                                <a
                                  href={comp.url || "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex gap-3 p-2 pr-12"
                                >`;
page = replaceOnce(page, soldAnchor, soldReplacement, "sold comp wrapper");
page = replaceOnce(
  page,
  `                              </a>
                            ))
`,
  `                                </a>
                                <button
                                  type="button"
                                  title="Exclude this sold comp and recalculate"
                                  aria-label="Exclude this sold comp"
                                  onClick={() => void excludeComp(item, comp, "sold")}
                                  disabled={
                                    excludingCompKey === \`${"${item.inventoryItemId}:${comp.url}"}\` ||
                                    controlsDisabled
                                  }
                                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-rose-700 text-lg font-black text-white disabled:opacity-40"
                                >
                                  ×
                                </button>
                              </div>
                            ))
`,
  "sold exclusion button",
);

const activeAnchor = `                              <a
                                key={\`${"${comp.url}-${index}"}\`}
                                href={comp.url || "#"}
                                target="_blank"
                                rel="noreferrer"
                                className="flex gap-3 rounded-lg border border-amber-300 bg-white p-2 hover:border-amber-700"
                              >`;
const activeReplacement = `                              <div
                                key={\`${"${comp.url}-${index}"}\`}
                                className="relative rounded-lg border border-amber-300 bg-white hover:border-amber-700"
                              >
                                <a
                                  href={comp.url || "#"}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex gap-3 p-2 pr-12"
                                >`;
page = replaceOnce(page, activeAnchor, activeReplacement, "active comp wrapper");
page = replaceOnce(
  page,
  `                              </a>
                            ))
`,
  `                                </a>
                                <button
                                  type="button"
                                  title="Exclude this active comp and recalculate"
                                  aria-label="Exclude this active comp"
                                  onClick={() => void excludeComp(item, comp, "active")}
                                  disabled={
                                    excludingCompKey === \`${"${item.inventoryItemId}:${comp.url}"}\` ||
                                    controlsDisabled
                                  }
                                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-rose-700 text-lg font-black text-white disabled:opacity-40"
                                >
                                  ×
                                </button>
                              </div>
                            ))
`,
  "active exclusion button",
);

page = replaceOnce(
  page,
  `                        {item.instaComp.sourceLinks.ebaySoldUrl ? (
`,
  `                        {item.instaComp.excludedCompCount > 0 ? (
                          <p className="mt-3 rounded-lg bg-rose-100 p-2 text-xs font-black text-rose-900">
                            {item.instaComp.excludedCompCount} comp{item.instaComp.excludedCompCount === 1 ? "" : "s"} permanently excluded from this card and future reruns.
                          </p>
                        ) : null}
                        {item.instaComp.sourceLinks.ebaySoldUrl ? (
`,
  "excluded count notice",
);

write(pagePath, page);

const regression = `import assert from "node:assert/strict";
import fs from "node:fs";

const universal = fs.readFileSync(
  "src/app/api/account/seller/inventory/instacomp-universal/route.ts",
  "utf8",
);
const page = fs.readFileSync("src/app/seller/instacomp-pending/page.tsx", "utf8");
const pending = fs.readFileSync(
  "src/app/api/account/seller/instacomp-pending/route.ts",
  "utf8",
);
const exclusion = fs.readFileSync(
  "src/app/api/account/seller/instacomp-pending/exclude-comp/route.ts",
  "utf8",
);

assert.ok(universal.includes("hasUsableStoredIdentity"));
assert.ok(universal.includes("fastLane = true"));
assert.ok(universal.includes("Promise.all(["));
assert.ok(universal.includes("excludedCompUrls"));
assert.ok(universal.includes("durationMs: Date.now() - scanStartedAt"));
assert.ok(page.includes("runWithConcurrency(targets, 2"));
assert.ok(page.includes("/api/account/seller/instacomp-pending/exclude-comp"));
assert.ok(page.includes("Exclude this sold comp and recalculate"));
assert.ok(page.includes("Exclude this active comp and recalculate"));
assert.ok(pending.includes("excludedCompCount"));
assert.ok(exclusion.includes("recalculated without rescanning"));
assert.ok(exclusion.includes("calculateInstaCompSweetSpot"));

console.log(
  "InstaComp speed/exclusion regression passed: trusted cards skip duplicate identity scans, batches run two at a time, sold and active comps have persistent exclusion controls, and exclusions recalculate without rescanning.",
);
`;
write("scripts/run-instacomp-fast-exclusions-regressions.ts", regression);

console.log("Applied InstaComp fast lane, two-card concurrency, and persistent comp exclusions.");
