export const INSTACOMP_CAPABILITY_SCHEMA_VERSION =
  "tcos.instacomp.capability-registry.v1" as const;

export type InstaCompWorkerPreference =
  | "mac_local"
  | "cloud"
  | "hybrid"
  | "provider_specific";

export type InstaCompCapabilityDefinition = {
  label: string;
  description: string;
  identityRequired: boolean;
  workerPreference: InstaCompWorkerPreference;
  canonicalIdentityAuthority: "central_checklist_registry";
  intelligenceOwner: "instacomp_ai";
  executionOwner: "kingmaker";
  sellerMutationAllowed: false;
};

export const INSTACOMP_CAPABILITIES = {
  scan_identification: {
    label: "Scan identification",
    description:
      "Extract visible evidence from front and back images without treating model output as canonical identity.",
    identityRequired: false,
    workerPreference: "mac_local",
    canonicalIdentityAuthority: "central_checklist_registry",
    intelligenceOwner: "instacomp_ai",
    executionOwner: "kingmaker",
    sellerMutationAllowed: false,
  },
  registry_resolution: {
    label: "Registry resolution",
    description:
      "Resolve extracted evidence through the authenticated central Checklist Registry.",
    identityRequired: false,
    workerPreference: "cloud",
    canonicalIdentityAuthority: "central_checklist_registry",
    intelligenceOwner: "instacomp_ai",
    executionOwner: "kingmaker",
    sellerMutationAllowed: false,
  },
  marketplace_comps: {
    label: "Marketplace comps",
    description:
      "Find and normalize exact sold evidence and separate it from active competition.",
    identityRequired: true,
    workerPreference: "provider_specific",
    canonicalIdentityAuthority: "central_checklist_registry",
    intelligenceOwner: "instacomp_ai",
    executionOwner: "kingmaker",
    sellerMutationAllowed: false,
  },
  price_recommendation: {
    label: "Price recommendation",
    description:
      "Recommend a transparent seller-review price from verified evidence without publishing or changing inventory.",
    identityRequired: true,
    workerPreference: "hybrid",
    canonicalIdentityAuthority: "central_checklist_registry",
    intelligenceOwner: "instacomp_ai",
    executionOwner: "kingmaker",
    sellerMutationAllowed: false,
  },
  market_research: {
    label: "Market research",
    description:
      "Compare current demand, supply, velocity, and market movement with preserved provenance.",
    identityRequired: false,
    workerPreference: "hybrid",
    canonicalIdentityAuthority: "central_checklist_registry",
    intelligenceOwner: "instacomp_ai",
    executionOwner: "kingmaker",
    sellerMutationAllowed: false,
  },
  release_research: {
    label: "Release research",
    description:
      "Harvest approved manufacturer releases, checklists, configurations, and corrections.",
    identityRequired: false,
    workerPreference: "cloud",
    canonicalIdentityAuthority: "central_checklist_registry",
    intelligenceOwner: "instacomp_ai",
    executionOwner: "kingmaker",
    sellerMutationAllowed: false,
  },
  grader_verification: {
    label: "Grader verification",
    description:
      "Verify grading-company, grade, certification, and label evidence against approved sources.",
    identityRequired: true,
    workerPreference: "provider_specific",
    canonicalIdentityAuthority: "central_checklist_registry",
    intelligenceOwner: "instacomp_ai",
    executionOwner: "kingmaker",
    sellerMutationAllowed: false,
  },
  listing_content: {
    label: "Listing content",
    description:
      "Recommend accurate listing facts, title structure, and description content from trusted evidence.",
    identityRequired: true,
    workerPreference: "hybrid",
    canonicalIdentityAuthority: "central_checklist_registry",
    intelligenceOwner: "instacomp_ai",
    executionOwner: "kingmaker",
    sellerMutationAllowed: false,
  },
  sourcing_analysis: {
    label: "Sourcing analysis",
    description:
      "Evaluate acquisition cost, likely fees, margin, evidence quality, and buy/pass considerations.",
    identityRequired: true,
    workerPreference: "hybrid",
    canonicalIdentityAuthority: "central_checklist_registry",
    intelligenceOwner: "instacomp_ai",
    executionOwner: "kingmaker",
    sellerMutationAllowed: false,
  },
  inventory_repricing: {
    label: "Inventory repricing",
    description:
      "Research existing inventory and create seller-review repricing recommendations without changing prices directly.",
    identityRequired: true,
    workerPreference: "hybrid",
    canonicalIdentityAuthority: "central_checklist_registry",
    intelligenceOwner: "instacomp_ai",
    executionOwner: "kingmaker",
    sellerMutationAllowed: false,
  },
} as const satisfies Record<string, InstaCompCapabilityDefinition>;

export type InstaCompCapability = keyof typeof INSTACOMP_CAPABILITIES;

export const INSTACOMP_CAPABILITY_KEYS = Object.freeze(
  Object.keys(INSTACOMP_CAPABILITIES) as InstaCompCapability[],
);

export function isInstaCompCapability(
  value: string,
): value is InstaCompCapability {
  return Object.hasOwn(INSTACOMP_CAPABILITIES, value);
}

export function getInstaCompCapability(
  capability: InstaCompCapability,
): InstaCompCapabilityDefinition {
  return INSTACOMP_CAPABILITIES[capability];
}
