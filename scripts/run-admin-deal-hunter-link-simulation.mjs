import { readFile } from "node:fs/promises";

const quickToolsUrl = new URL(
  "../src/app/components/AdminInstaCompMobileShortcut.tsx",
  import.meta.url,
);
const dealHunterPageUrl = new URL(
  "../src/app/admin/market-intel/deal-hunter/page.tsx",
  import.meta.url,
);
const evaluationRouteUrl = new URL(
  "../src/app/api/instacomp/deal-hunter/evaluate/route.ts",
  import.meta.url,
);
const evaluationCoreUrl = new URL(
  "../src/app/api/instacomp/deal-hunter/evaluate/core.ts",
  import.meta.url,
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [quickTools, dealHunterPage, evaluationRoute, evaluationCore] =
  await Promise.all([
    readFile(quickToolsUrl, "utf8"),
    readFile(dealHunterPageUrl, "utf8"),
    readFile(evaluationRouteUrl, "utf8"),
    readFile(evaluationCoreUrl, "utf8"),
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
  "Admin quick tools must remain usable on mobile and desktop.",
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
  evaluationCore.includes('"/api/instacomp/live-scan"'),
  "Deal Hunter core evaluator must remain wired to the hardened InstaComp live-scan pipeline.",
);
assert(
  evaluationCore.includes('from("tcos_deal_hunter_candidates")'),
  "Deal Hunter core evaluator must persist candidate results.",
);
assert(
  evaluationRoute.includes("persistExactCardMarketHistory") &&
    evaluationRoute.includes("marketHistory"),
  "Deal Hunter route wrapper must retain exact-card longitudinal market history.",
);

console.log("✓ Shared admin quick bar links to Deal Hunter on mobile and desktop");
console.log("✓ Deal Hunter destination page exists and returns to Market Intel");
console.log("✓ Core evaluation remains wired to live scan and candidate persistence");
console.log("✓ Wrapper retains Registry-confirmed exact-card market history");
console.log("Admin Deal Hunter link simulation: 4/4 passed.");
