import { readFile } from "node:fs/promises";

const quickToolsUrl = new URL(
  "../src/app/components/AdminInstaCompMobileShortcut.tsx",
  import.meta.url,
);
const adminPageUrl = new URL("../src/app/admin/page.tsx", import.meta.url);
const dealHunterPageUrl = new URL(
  "../src/app/admin/market-intel/deal-hunter/page.tsx",
  import.meta.url,
);
const evaluationRouteUrl = new URL(
  "../src/app/api/instacomp/deal-hunter/evaluate/route.ts",
  import.meta.url,
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [quickTools, adminPage, dealHunterPage, evaluationRoute] =
  await Promise.all([
    readFile(quickToolsUrl, "utf8"),
    readFile(adminPageUrl, "utf8"),
    readFile(dealHunterPageUrl, "utf8"),
    readFile(evaluationRouteUrl, "utf8"),
  ]);

assert(
  quickTools.includes('href: "/admin/market-intel/deal-hunter"'),
  "Admin quick tools must link directly to the Deal Hunter dashboard.",
);
assert(
  quickTools.includes('label: "Deal Hunter"') &&
    quickTools.includes('icon: "🎯"'),
  "Admin quick tools must expose the Deal Hunter label and icon.",
);
assert(
  quickTools.includes('if (pathname !== "/admin") return null;'),
  "Deal Hunter quick tool must remain scoped to the main admin page.",
);
assert(
  quickTools.includes("grid grid-cols-3") &&
    quickTools.includes("sm:flex sm:items-center"),
  "Admin quick tools must remain usable on mobile and desktop with six actions.",
);
assert(
  adminPage.includes('"/admin/market-intel/deal-hunter"'),
  "Admin static route contract must include the Deal Hunter destination.",
);
assert(
  dealHunterPage.includes("InstaComp AI Deal Hunter"),
  "Deal Hunter destination page must render its expected dashboard heading.",
);
assert(
  dealHunterPage.includes('href="/admin/market-intel"'),
  "Deal Hunter destination must retain a return path to Market Intel.",
);
assert(
  evaluationRoute.includes('"/api/instacomp/live-scan"'),
  "Deal Hunter evaluation route must remain wired to the hardened InstaComp live-scan pipeline.",
);
assert(
  evaluationRoute.includes('from("tcos_deal_hunter_candidates")'),
  "Deal Hunter evaluation route must persist candidate results.",
);

console.log("✓ Shared admin quick bar links to Deal Hunter on mobile and desktop");
console.log("✓ Deal Hunter destination page exists and returns to Market Intel");
console.log("✓ Deal Hunter evaluation remains wired to live scan and persistence");
console.log("Admin Deal Hunter link simulation: 3/3 passed.");
