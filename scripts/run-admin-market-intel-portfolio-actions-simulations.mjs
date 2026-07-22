import { readFile } from "node:fs/promises";

const sources = {
  buy: await readFile(
    new URL("../src/app/admin/market-intel/buy/page.tsx", import.meta.url),
    "utf8",
  ),
  comps: await readFile(
    new URL("../src/app/admin/market-intel/comps/page.tsx", import.meta.url),
    "utf8",
  ),
  compDetail: await readFile(
    new URL("../src/app/admin/market-intel/comps/[id]/page.tsx", import.meta.url),
    "utf8",
  ),
  discovery: await readFile(
    new URL("../src/app/admin/market-intel/discovery/page.tsx", import.meta.url),
    "utf8",
  ),
  purchaseLedger: await readFile(
    new URL("../src/app/admin/market-intel/purchases/page.tsx", import.meta.url),
    "utf8",
  ),
  offlinePurchaseNew: await readFile(
    new URL("../src/app/admin/market-intel/purchases/new/page.tsx", import.meta.url),
    "utf8",
  ),
  purchaseDetail: await readFile(
    new URL("../src/app/admin/market-intel/purchases/[id]/page.tsx", import.meta.url),
    "utf8",
  ),
  ebayPurchaseIntake: await readFile(
    new URL(
      "../src/app/admin/market-intel/purchases/ebay-intake/page.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  ebayPurchaseRoute: await readFile(
    new URL(
      "../src/app/api/admin/market-intel/purchases/ebay-intake/route.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  ebayBuyerOrders: await readFile(
    new URL("../src/lib/ebay-buyer-orders.ts", import.meta.url),
    "utf8",
  ),
  deals: await readFile(
    new URL("../src/app/admin/market-intel/deals/page.tsx", import.meta.url),
    "utf8",
  ),
  ingestion: await readFile(
    new URL("../src/app/admin/market-intel/ingestion/page.tsx", import.meta.url),
    "utf8",
  ),
  growthSpecs: await readFile(
    new URL("../src/app/admin/market-intel/growth-specs/page.tsx", import.meta.url),
    "utf8",
  ),
  growthLayout: await readFile(
    new URL("../src/app/admin/market-intel/growth-specs/layout.tsx", import.meta.url),
    "utf8",
  ),
  growthProspects: await readFile(
    new URL(
      "../src/app/admin/market-intel/growth-specs/prospects/page.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  dealListingActions: await readFile(
    new URL(
      "../src/app/admin/market-intel/deals/DealListingActions.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  listingPurchaseRoute: await readFile(
    new URL(
      "../src/app/api/admin/market-intel/listings/[id]/purchase/route.ts",
      import.meta.url,
    ),
    "utf8",
  ),
};

const scenarios = [];

function scenario(name, run) {
  scenarios.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function countAdminSubmitButtons(source) {
  return (source.match(/<AdminSubmitButton/g) || []).length;
}

scenario("purchase desk and purchase detail forms label native submits", () => {
  assert(
    sources.buy.includes('import AdminSubmitButton from "../../AdminSubmitButton";'),
    "Expected purchase desk to import the shared admin submit button.",
  );
  assert(
    sources.buy.includes("Creating purchase position..."),
    "Expected purchase desk pending label.",
  );
  for (const fragment of [
    "Create a Market Intel purchase position from this deal candidate using the final delivered cost basis.",
    "This records the purchase position only; it does not buy the listing for you.",
  ]) {
    assert(
      sources.buy.includes(fragment),
      `Expected purchase desk action-scope fragment ${fragment}.`,
    );
  }

  assert(
    sources.purchaseDetail.includes('import AdminSubmitButton from "../../../AdminSubmitButton";'),
    "Expected purchase detail to import the shared admin submit button.",
  );
  assert(
    countAdminSubmitButtons(sources.purchaseDetail) >= 2,
    "Expected purchase detail receive and sale forms to use pending-aware submits.",
  );

  for (const label of ["Marking received...", "Saving sale..."]) {
    assert(
      sources.purchaseDetail.includes(label),
      `Expected purchase detail pending label ${label}.`,
    );
  }

  for (const fragment of [
    "const saleSaveDisabledReason =",
    "All purchased units have already been recorded as sold.",
    "disabledReason={saleSaveDisabledReason}",
    "Save this sale and recalculate realized gross profit.",
    "Mark this purchase lot as received so it can move from inbound tracking into inventory review.",
    "Updates receipt status only; sale recording and realized profit stay separate.",
  ]) {
    assert(
      sources.purchaseDetail.includes(fragment),
      `Expected purchase detail disabled reason ${fragment}.`,
    );
  }
});

scenario("eBay Purchase Inbox actions expose pending state", () => {
  assert(
    sources.ebayPurchaseIntake.includes(
      'import AdminSubmitButton from "../../../AdminSubmitButton";',
    ),
    "Expected eBay Purchase Inbox to import the shared admin submit button.",
  );
  assert(
    countAdminSubmitButtons(sources.ebayPurchaseIntake) >= 4,
    "Expected eBay Purchase Inbox add, move, and skip actions to use pending-aware submits.",
  );

  for (const fragment of [
    'name="action"',
    'value="move_resale"',
    'value="move_hold"',
    'value="skip"',
    "Importing eBay purchase...",
    "Moving to resale...",
    "Moving to hold review...",
    "Skipping selected...",
    "order.ebay.com/ord/show?orderId=...",
    "Connect / Reconnect eBay",
    "disabled={Boolean(loadError)}",
    "Import the eBay order into Purchase Inbox only; exact-card review and ledger recording happen after this step.",
    "Import creates pending inbox rows from the receipt. Nothing reaches the Purchase Ledger",
    "until exact identity is confirmed and Record as Purchased is used.",
    "Move selected pending purchase rows into Resale exact-card review without recording them in the ledger yet.",
    "Move selected pending purchase rows into Hold / Investment exact-card review without recording them in the ledger yet.",
    "Skip selected pending purchase rows so they leave the active review queue without creating ledger records.",
    "Select at least one row. Moving sends rows to exact-card review; skipping removes",
    "them from pending review without creating Purchase Ledger entries.",
  ]) {
    assert(
      sources.ebayPurchaseIntake.includes(fragment),
      `Expected eBay Purchase Inbox pending/action fragment ${fragment}.`,
    );
  }
});

scenario("purchase ledger and intake pages use professional command presentation", () => {
  for (const [key, label] of [
    ["purchaseLedger", "purchase ledger"],
    ["offlinePurchaseNew", "offline purchase intake"],
    ["ebayPurchaseIntake", "eBay purchase inbox"],
  ]) {
    for (const fragment of [
      "rounded-[2rem] border border-neutral-900 bg-neutral-950",
      "shadow-2xl shadow-neutral-950/10",
      "rounded-3xl border border-neutral-200 bg-white/95",
      "shadow-sm ring-1 ring-black/[0.02]",
      "rounded-full border border-white/15 bg-white/10",
    ]) {
      assert(
        sources[key].includes(fragment),
        `Expected ${label} presentation fragment ${fragment}.`,
      );
    }
  }

  for (const [key, label] of [
    ["offlinePurchaseNew", "offline purchase intake"],
    ["ebayPurchaseIntake", "eBay purchase inbox"],
  ]) {
    assert(
      sources[key].includes("focus:ring-4 focus:ring-black/10"),
      `Expected ${label} polished form focus styling.`,
    );
  }
});

scenario("eBay Purchase Inbox resolves authenticated buyer order links", () => {
  for (const fragment of [
    "parseEbayOrderId",
    "fetchEbayBuyerOrder",
    "for (const line of order.lines)",
    "externalOrderId: order.orderId",
    'reconnect: "1"',
  ]) {
    assert(
      sources.ebayPurchaseRoute.includes(fragment),
      `Expected eBay buyer-order route fragment ${fragment}.`,
    );
  }

  for (const fragment of [
    '"X-EBAY-API-CALL-NAME": "GetOrders"',
    '"X-EBAY-API-IAF-TOKEN": accessToken',
    "<OrderRole>Buyer</OrderRole>",
    "OrderIDArray",
    '"RECONNECT_REQUIRED"',
    "allocateMoney",
  ]) {
    assert(
      sources.ebayBuyerOrders.includes(fragment),
      `Expected authenticated eBay buyer-order helper fragment ${fragment}.`,
    );
  }
});

scenario("deal and ingestion operations expose pending state", () => {
  assert(
    sources.deals.includes('import AdminSubmitButton from "../../AdminSubmitButton";'),
    "Expected deals page to import the shared admin submit button.",
  );
  assert(
    countAdminSubmitButtons(sources.deals) >= 2,
    "Expected save listing and rescore forms to use pending-aware submits.",
  );

  for (const label of ["Saving and scoring...", "Rescoring..."]) {
    assert(sources.deals.includes(label), `Expected deals pending label ${label}.`);
  }

  for (const fragment of [
    "Save this listing, attach its exact identity, and calculate its deal score from current comps and delivered cost.",
    "Records and scores the listing for review; buying and ending listings remain separate actions.",
    "Recalculate deal scores for saved listings from the latest comps, fees, risk, and delivered-cost data.",
    "Refreshes ranking math only; it does not create purchases or end listings.",
  ]) {
    assert(
      sources.deals.includes(fragment),
      `Expected deals action-scope fragment ${fragment}.`,
    );
  }

  assert(
    sources.ingestion.includes("Running cleanup..."),
    "Expected ingestion cleanup pending label.",
  );
  for (const fragment of [
    "Run the Market Intel cleanup pass to expire stale records and remove old rejected/expired staging rows.",
    "Cleanup affects stale Market Intel staging data only; purchases, sales, and exact identities remain intact.",
  ]) {
    assert(
      sources.ingestion.includes(fragment),
      `Expected ingestion cleanup action-scope fragment ${fragment}.`,
    );
  }
});

scenario("comp and discovery admin actions explain scope", () => {
  for (const fragment of [
    "Create a reusable exact-card identity for comps, scanner matching, deal scoring, and purchase review.",
    "Saves identity metadata only; sold comps and listing scores are added in later steps.",
  ]) {
    assert(
      sources.comps.includes(fragment),
      `Expected comps identity action-scope fragment ${fragment}.`,
    );
  }

  for (const fragment of [
    "Recalculate the market-value snapshot from verified, included, non-outlier sold comps for this exact identity.",
    "Updates market-value math only; sold comp rows stay unchanged.",
    "Save this verified sold comp and include or exclude it from the exact-card market-value calculation based on the form flags.",
    "Adds one sold-comp row; market value uses only verified, included, non-outlier comps.",
  ]) {
    assert(
      sources.compDetail.includes(fragment),
      `Expected comp detail action-scope fragment ${fragment}.`,
    );
  }

  for (const fragment of [
    "Run the Market Intel eBay scanner for the selected watchlist scope and save review candidates.",
    "Finds and stages candidates for review; it does not approve identities, buy listings, or publish anything.",
    "Approve this candidate as an exact-card identity, attach it to the listing, and calculate the listing score.",
    "Moves the candidate into exact review data and scoring; it does not buy the listing.",
    "Reject this discovery candidate with the entered reason and remove it from the approval queue.",
    "Rejecting documents the reason and keeps the source listing unchanged.",
  ]) {
    assert(
      sources.discovery.includes(fragment),
      `Expected discovery action-scope fragment ${fragment}.`,
    );
  }
});

scenario("growth spec forms and value-list refreshes label long-running posts", () => {
  for (const [key, importPath] of [
    ["growthSpecs", 'import AdminSubmitButton from "../../AdminSubmitButton";'],
    ["growthLayout", 'import AdminSubmitButton from "../../AdminSubmitButton";'],
    ["growthProspects", 'import AdminSubmitButton from "../../../AdminSubmitButton";'],
  ]) {
    assert(
      sources[key].includes(importPath),
      `Expected ${key} to import the shared admin submit button.`,
    );
  }

  for (const label of [
    "Saving growth spec...",
    "Saving model...",
    "Refreshing lists...",
    "Setting ",
    "Save this future-growth thesis and calculate its projected exit, risk, and hold-period math.",
    "Saves a scenario model only; it does not buy inventory or change active listings.",
    "Save the default $25-per-card growth model for this scanned lot without purchasing the listing.",
    "Creates a reviewable growth-spec model from this lot; buying stays manual.",
    "Mark this Growth Spec thesis as ${label.toLowerCase()} for tracking without changing purchase or listing records.",
    "Updates this thesis status only; purchase and listing records stay unchanged.",
    "Refresh the curated Market Intel value watchlists while preserving exact-card research and history.",
    "Reapplies prospect priorities and card-scope rules; saved exact cards, comps, purchases, and sales stay intact.",
    "Refresh the curated value universe while preserving existing exact cards, comps, listings, purchases, and sales history.",
    "Reapplies current prospect priorities and card-scope rules without deleting saved research history.",
  ]) {
    assert(
      sources.growthSpecs.includes(label) ||
        sources.growthLayout.includes(label) ||
        sources.growthProspects.includes(label),
      `Expected growth pending label fragment ${label}.`,
    );
  }
});

scenario("deal listing client actions retain inline busy and failure feedback", () => {
  for (const fragment of [
    "dealListingActionRunningRef",
    "function dealListingActionBlockedReason(action: string)",
    "function showDealListingActionBlocked(action: string)",
    "function togglePurchasePanel()",
    "function cancelEndConfirmation()",
    "Finish the current deal listing action before ${action}.",
    "Ending listing...",
    "Creating purchase position...",
    'aria-live={tone === "info" ? "polite" : "assertive"}',
    'aria-busy={busy === "end"}',
    'aria-busy={busy === "purchase"}',
    "aria-disabled={busy !== null || !hasExactIdentity}",
    "aria-disabled={busy !== null || purchaseMissing.length > 0}",
    "Could not end listing.",
    "Could not record purchase.",
    "Purchase disabled until this listing has an exact collectible identity.",
    "This does not record a purchase.",
    'normalized.includes("needs")',
    'normalized.includes("disabled")',
  ]) {
    assert(
      sources.dealListingActions.includes(fragment),
      `Expected deal listing action feedback ${fragment}.`,
    );
  }
});

scenario("listing purchase route rejects stale deal-desk purchases", () => {
  for (const fragment of [
    'String(listing.listing_status || "") !== "active"',
    "Listing is no longer active; refresh the deal desk before recording a purchase.",
    "Purchase #",
    "was already recorded for this listing.",
  ]) {
    assert(
      sources.listingPurchaseRoute.includes(fragment),
      `Expected stale purchase guard fragment ${fragment}.`,
    );
  }
});

const failed = [];

for (const item of scenarios) {
  try {
    item.run();
    console.log(`✓ ${item.name}`);
  } catch (error) {
    failed.push({ name: item.name, error });
    console.error(`✗ ${item.name}`);
    console.error(error);
  }
}

console.log(
  `Admin Market Intel portfolio action simulations: ${
    scenarios.length - failed.length
  }/${scenarios.length} passed.`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
