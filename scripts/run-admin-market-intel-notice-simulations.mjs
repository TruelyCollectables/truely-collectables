import { readFile } from "node:fs/promises";

const noticePages = [
  {
    name: "Market Intel reports",
    path: "../src/app/admin/market-intel/reports/page.tsx",
    role: 'role={error ? "alert" : "status"}',
    live: 'aria-live={error ? "assertive" : "polite"}',
  },
  {
    name: "Market Intel watchlist",
    path: "../src/app/admin/market-intel/watchlist/page.tsx",
    role: 'role={error ? "alert" : "status"}',
    live: 'aria-live={error ? "assertive" : "polite"}',
  },
  {
    name: "Market Intel comp detail",
    path: "../src/app/admin/market-intel/comps/[id]/page.tsx",
    role: 'role={error ? "alert" : "status"}',
    live: 'aria-live={error ? "assertive" : "polite"}',
  },
  {
    name: "Market Intel delivery",
    path: "../src/app/admin/market-intel/delivery/page.tsx",
    role: 'role={error ? "alert" : "status"}',
    live: 'aria-live={error ? "assertive" : "polite"}',
  },
  {
    name: "Market Intel growth specs",
    path: "../src/app/admin/market-intel/growth-specs/page.tsx",
    role: 'role={error ? "alert" : "status"}',
    live: 'aria-live={error ? "assertive" : "polite"}',
  },
  {
    name: "Market Intel eBay scanner",
    path: "../src/app/admin/market-intel/ebay/page.tsx",
    role: 'role={error ? "alert" : "status"}',
    live: 'aria-live={error ? "assertive" : "polite"}',
  },
  {
    name: "Market Intel deals",
    path: "../src/app/admin/market-intel/deals/page.tsx",
    role: 'role={error ? "alert" : "status"}',
    live: 'aria-live={error ? "assertive" : "polite"}',
  },
  {
    name: "Market Intel discovery",
    path: "../src/app/admin/market-intel/discovery/page.tsx",
    role: 'role={error ? "alert" : "status"}',
    live: 'aria-live={error ? "assertive" : "polite"}',
  },
  {
    name: "Market Intel ingestion",
    path: "../src/app/admin/market-intel/ingestion/page.tsx",
    role: 'role={error ? "alert" : "status"}',
    live: 'aria-live={error ? "assertive" : "polite"}',
  },
  {
    name: "Market Intel purchase detail",
    path: "../src/app/admin/market-intel/purchases/[id]/page.tsx",
    role: 'role={tone === "error" ? "alert" : "status"}',
    live: 'aria-live={tone === "error" ? "assertive" : "polite"}',
  },
  {
    name: "Market Intel deal listing actions",
    path: "../src/app/admin/market-intel/deals/DealListingActions.tsx",
    role: 'role={tone === "error" ? "alert" : "status"}',
    live: 'aria-live={tone === "info" ? "polite" : "assertive"}',
  },
];

const failed = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const page of noticePages) {
  try {
    const source = await readFile(new URL(page.path, import.meta.url), "utf8");

    assert(
      source.includes(page.role),
      `Expected ${page.name} notice to expose ${page.role}.`,
    );
    assert(
      source.includes(page.live),
      `Expected ${page.name} notice to expose ${page.live}.`,
    );

    console.log(`✓ ${page.name} notices announce success and error feedback`);
  } catch (error) {
    failed.push({ name: page.name, error });
    console.error(`✗ ${page.name} notices announce success and error feedback`);
    console.error(error);
  }
}

try {
  const reportsSource = await readFile(
    new URL("../src/app/admin/market-intel/reports/page.tsx", import.meta.url),
    "utf8",
  );

  for (const fragment of [
    "Create, refresh, or expire alert outbox rows from the latest scored Market Intel listings.",
    "Updates alert rows only; it does not buy listings, send messages, or change purchase records.",
    "Build today's Market Intel report snapshot from current watchlists, comps, scores, and purchase ledger data.",
    "Creates a report snapshot for review; alerts remain separate until the outbox is synced.",
    "Mark alert ${alert.id} as sent after you have delivered or handled it outside this queue.",
    "Use after the alert has been handled; this removes it from the pending queue.",
    "Dismiss alert ${alert.id} without marking it sent or changing the source listing.",
    "Removes this alert from pending review without touching the listing or purchase ledger.",
  ]) {
    assert(
      reportsSource.includes(fragment),
      `Expected Market Intel report action-scope fragment ${fragment}.`,
    );
  }

  console.log("✓ Market Intel reports actions explain scope and side effects");
} catch (error) {
  failed.push({ name: "Market Intel reports action scope", error });
  console.error("✗ Market Intel reports actions explain scope and side effects");
  console.error(error);
}

console.log(
  `Admin Market Intel notice simulations: ${
    noticePages.length + 1 - failed.length
  }/${noticePages.length + 1} passed.`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
