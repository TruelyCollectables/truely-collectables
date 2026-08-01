import fs from "node:fs";

const routePath = "src/app/api/instacomp/scan/route.ts";
const decisionPath = "src/lib/instacomp-v2.ts";

let route = fs.readFileSync(routePath, "utf8");
let decision = fs.readFileSync(decisionPath, "utf8");

function replaceExactlyOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${count}.`);
  }
  return source.replace(before, after);
}

route = replaceExactlyOnce(
  route,
  `function isMarketValueComp(comp: InstaCompComp) {
  return comp.sourceCategory !== "reference";
}

function isExactListingGuidanceComp(comp: InstaCompComp) {
  return (
    (comp.sourceCategory === "sold" || comp.sourceCategory === "marketplace") &&
    comp.price > 0 &&
    !comp.flags.includes("excluded") &&
    !comp.flags.includes("guidance comp") &&
    !comp.flags.includes("not used for pricing")
  );
}

`,
  "",
  "obsolete pricing helper removal",
);

route = replaceExactlyOnce(
  route,
  `      note:
        scanReview.trustedForPricing
          ? "Market value, high, low, and sold ranges are calculated from included live matches only. Registered sources remain visible until provider access is configured."
          : canUseListingGuidance
            ? "InstaComp™ found exact active marketplace listing guidance. Sold comps may still be unavailable, so review the row before trusting market value, draft title, activation, or comps."
          : "InstaComp™ found provider candidates, but exact card identity/pricing evidence is not strong enough. Review the row before trusting market value, draft title, activation, or comps.",`,
  `      note:
        scanReview.trustedForPricing
          ? "Transactional value is based only on independently verified completed sales. Current asks, guide prices, and internal inventory remain display-only."
          : "InstaComp™ found provider candidates, but identity review or insufficient independently verified completed sales prevents transaction value, buy calls, ROI, and auto-pricing.",`,
  "verified-sale-only response note",
);

decision = replaceExactlyOnce(
  decision,
  `function displayedCompPrice(comp: InstaCompV2Comp) {
  const price = positiveMoney(comp.price);
  if (price !== null) return price;
  const item = positiveMoney(comp.itemPrice);
  if (item === null) return null;
  const shipping = nonNegative(comp.shippingPrice, 0);
  return rounded(item + shipping);
}

`,
  "",
  "unused displayed comp helper removal",
);

for (const forbidden of [
  "canUseListingGuidance",
  "function isMarketValueComp",
  "function isExactListingGuidanceComp",
  "function displayedCompPrice",
]) {
  if (route.includes(forbidden) || decision.includes(forbidden)) {
    throw new Error(`Hardening follow-up left forbidden marker: ${forbidden}`);
  }
}

fs.writeFileSync(routePath, route);
fs.writeFileSync(decisionPath, decision);
console.log("Fixed InstaComp hardening TypeScript and removed obsolete pricing helpers.");
