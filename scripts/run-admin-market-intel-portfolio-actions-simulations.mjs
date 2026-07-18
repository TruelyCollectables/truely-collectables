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
    "Ending listing...",
    "Creating purchase position...",
    'aria-live={tone === "info" ? "polite" : "assertive"}',
    'aria-busy={busy === "end"}',
    'aria-busy={busy === "purchase"}',
    "Could not end listing.",
    "Could not record purchase.",
    "Purchase disabled until this listing has an exact collectible identity.",
    "This does not record a purchase.",
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
