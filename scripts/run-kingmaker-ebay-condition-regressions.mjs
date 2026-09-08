import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pendingClient = read("src/app/kingmaker/pending/PendingClient.tsx");
const pendingRoute = read("src/app/api/account/seller/instacomp-pending/route.ts");
const channelRoute = read("src/app/api/account/seller/instacomp-pending/channel/route.ts");
const strictPublisher = read("src/lib/ebay-inventory-publisher-strict.ts");
const auditedPublisher = read("src/lib/ebay-inventory-publisher-audited.ts");

assert(
  pendingClient.includes("eBay Card Condition"),
  "KINGMAKER must expose an eBay Card Condition control for raw cards.",
);
assert(
  pendingClient.includes("cardCondition: cardCondition || undefined"),
  "KINGMAKER must send the seller-selected card condition to the channel API.",
);
assert(
  pendingClient.includes("!ebayCardConditionReady"),
  "eBay publishing buttons must fail closed when an ungraded card has no condition.",
);
assert(
  pendingClient.includes("EBAY BLOCKED: choose eBay Card Condition"),
  "bulk eBay publishing must clearly explain the missing-condition blocker.",
);
assert(
  pendingRoute.includes("ebayCardCondition: textValue(dualEbay.cardCondition)"),
  "pending inventory API must round-trip the saved eBay card condition.",
);
assert(
  pendingRoute.includes("ebayLastError: textValue(dualEbay.lastError)"),
  "pending inventory API must expose the last eBay publishing error.",
);
assert(
  channelRoute.includes("lastError: ebayError"),
  "channel API must persist a failed eBay publishing reason.",
);
assert(
  channelRoute.includes("/v1/kingmaker/accounting/ebay-bridge") && channelRoute.includes('{ mode: "readiness" }'),
  "channel API must expose a safe authenticated eBay readiness probe.",
);
assert(
  strictPublisher.includes('"Near Mint or Better"') &&
    strictPublisher.includes('"Excellent"') &&
    strictPublisher.includes('"Very Good"') &&
    strictPublisher.includes('"Poor"'),
  "sports-card condition choices must stay aligned with the strict publisher contract.",
);

assert(
  auditedPublisher.includes("Number(row?.errorId) === 25713") &&
    auditedPublisher.includes("if (!offerDoesNotExist) throw error"),
  "new eBay SKUs must treat error 25713 as no existing offer and continue to create one.",
);

console.log("PASS KINGMAKER eBay raw-card condition regressions");
