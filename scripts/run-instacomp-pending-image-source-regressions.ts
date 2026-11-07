import { readFileSync } from "node:fs";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const pendingRoute = readFileSync(
  "src/app/api/account/seller/instacomp-pending/route.ts",
  "utf8",
);
const repairRoute = readFileSync(
  "src/app/api/instacomp/pending-image-repair-push/route.ts",
  "utf8",
);

assert(
  !pendingRoute.includes('.from("inventory_images")') &&
    !pendingRoute.includes("createSupabaseServerClient"),
  "Pending Listings must not read scan images from Supabase.",
);
assert(
  pendingRoute.includes("textValue(instaComp.frontImageUrl)") &&
    pendingRoute.includes("textValue(instaComp.backImageUrl)") &&
    pendingRoute.includes("displayFrontUrl") &&
    pendingRoute.includes("displayBackUrl"),
  "Pending Listings must derive front/back images from Mac-projected scan metadata.",
);
assert(
  pendingRoute.includes("backImageUrl: displayBackUrl") &&
    pendingRoute.includes("frontImageUrl: displayFrontUrl"),
  "Pending Listings must return both stored image URLs.",
);
assert(
  pendingRoute.includes("imageAudit:") &&
    pendingRoute.includes("missingBackImage"),
  "Pending response must include a server-side image audit summary.",
);
assert(
  !pendingRoute.includes("hasBackImage: instaComp.hasBackImage === true"),
  "Pending Listings cannot trust only the stale metadata flag.",
);
assert(
  repairRoute.includes('.from("inventory_images")') &&
    repairRoute.includes('alt_text: `${row.title || "Card"} back`') &&
    repairRoute.includes("hasBackImage: true"),
  "Repair must persist a distinct back image row and mark the draft repaired.",
);

console.log("InstaComp pending image source-of-truth regressions passed.");
