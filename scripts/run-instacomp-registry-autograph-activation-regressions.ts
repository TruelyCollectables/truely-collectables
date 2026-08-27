import { getInventoryActivationBlockers } from "../src/lib/inventory-activation";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const common = {
  sku: "AUTO-TEST",
  price: 125,
  quantity: 1,
  imageUrl: "https://example.com/autograph-card.jpg",
  title: "2024-25 Upper Deck Example Player #A1 Auto",
  category: "Trading Card Singles",
};

const registryConfirmed = getInventoryActivationBlockers({
  ...common,
  metadata: {
    instacomp: {
      checklistIdentity: {
        source: "checklist_registry",
        registryIdentityId: "registry-auto-identity",
        registryFingerprintSha256: "a".repeat(64),
      },
    },
    collectible_asset: {
      autograph: true,
    },
  },
});
assert(
  !registryConfirmed.includes("missing_authenticity_disclosure"),
  "Registry-confirmed manufacturer autograph was treated as an unsupported generic signature",
);

const missingFingerprint = getInventoryActivationBlockers({
  ...common,
  metadata: {
    instacomp: {
      checklistIdentity: {
        source: "checklist_registry",
        registryIdentityId: "registry-auto-identity",
        registryFingerprintSha256: null,
      },
    },
    collectible_asset: {
      autograph: true,
    },
  },
});
assert(
  missingFingerprint.includes("missing_authenticity_disclosure"),
  "Autograph provenance bypassed the Registry fingerprint requirement",
);

const genericSignedItem = getInventoryActivationBlockers({
  ...common,
  title: "Example Player Signed Card",
  metadata: {},
});
assert(
  genericSignedItem.includes("missing_authenticity_disclosure"),
  "Generic signed item bypassed the authenticity disclosure firewall",
);

console.log(
  JSON.stringify(
    {
      schema: "tcos.instacomp.registry-autograph-activation.v1",
      status: "passed",
      registryConfirmedManufacturerAutograph: true,
      registryFingerprintRequired: true,
      genericSignedDisclosureRequired: true,
    },
    null,
    2,
  ),
);
