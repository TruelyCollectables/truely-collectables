import { readFileSync } from "node:fs";
import { getInventoryActivationBlockers } from "../src/lib/inventory-activation";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const intakeSource = readFileSync(
  "src/app/api/account/seller/instacomp-scan/intake/route.ts",
  "utf8",
);
const scannerSource = readFileSync(
  "src/app/seller/instacomp-scan/page.tsx",
  "utf8",
);
const localClientSource = readFileSync(
  "src/lib/instacomp-ai-local.ts",
  "utf8",
);

assert(
  intakeSource.includes('code: "BACK_IMAGE_REQUIRED"'),
  "Listing intake does not reject a missing back image.",
);
assert(
  intakeSource.includes('code: "FRONT_BACK_IMAGES_DUPLICATE"'),
  "Listing intake does not reject the same image used for front and back.",
);
assert(
  intakeSource.includes("if (!imagePairSha256 || !frontSha256 || !backSha256)"),
  "Listing intake does not require a complete front/back scan receipt.",
);
assert(
  intakeSource.includes("const scan = await analyzeWithInstaCompAiLocal({ front, back });"),
  "Listing intake is not sending both required images to the Mac service.",
);
assert(
  scannerSource.includes("disabled={busy || !front || !back}"),
  "Phone listing scanner can still submit without both images.",
);
assert(
  scannerSource.includes("Back photo *"),
  "Phone listing scanner does not visibly mark the back image as required.",
);
assert(
  scannerSource.includes('body.append("back", back);'),
  "Phone listing scanner does not always send the selected back image.",
);
assert(
  localClientSource.includes("back?: Blob | null"),
  "One-off InstaComp analysis no longer permits an optional back image.",
);

const frontOnlyListing = getInventoryActivationBlockers({
  sku: "TEST-FRONT-ONLY",
  price: 5,
  quantity: 1,
  imageUrl: "https://example.com/front.jpg",
  title: "Example Card",
  category: "Trading Card Singles",
  metadata: {
    instacomp: {
      source: "mac_registry_scanner",
      hasBackImage: false,
      backSha256: null,
    },
  },
});
assert(
  frontOnlyListing.includes("missing_back_image"),
  "A front-only InstaComp listing is not blocked from publication.",
);

const completeListing = getInventoryActivationBlockers({
  sku: "TEST-FRONT-BACK",
  price: 5,
  quantity: 1,
  imageUrl: "https://example.com/front.jpg",
  title: "Example Card",
  category: "Trading Card Singles",
  metadata: {
    instacomp: {
      source: "mac_registry_scanner",
      hasBackImage: true,
      backSha256: "b".repeat(64),
    },
  },
});
assert(
  !completeListing.includes("missing_back_image"),
  "A complete front/back listing is incorrectly blocked.",
);

const oneOffAnalysis = getInventoryActivationBlockers({
  sku: "QUICK-CHECK",
  price: 5,
  quantity: 1,
  imageUrl: "https://example.com/front.jpg",
  title: "One-off InstaComp Quick Check",
  category: "Trading Card Singles",
  metadata: {},
});
assert(
  !oneOffAnalysis.includes("missing_back_image"),
  "The listing-only front/back rule leaked into ordinary one-off analysis.",
);

console.log("InstaComp front/back listing regressions passed.");
