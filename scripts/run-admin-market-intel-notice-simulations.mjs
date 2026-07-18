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

console.log(
  `Admin Market Intel notice simulations: ${
    noticePages.length - failed.length
  }/${noticePages.length} passed.`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
