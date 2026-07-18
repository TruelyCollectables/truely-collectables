import { readFile } from "node:fs/promises";

const sources = {
  buy: await readFile(
    new URL("../src/app/admin/market-intel/buy/page.tsx", import.meta.url),
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

  assert(
    sources.ingestion.includes("Running cleanup..."),
    "Expected ingestion cleanup pending label.",
  );
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
