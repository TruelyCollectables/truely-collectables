import type { InstaCompListingOutput } from "./instacomp-listing-output";

export const INSTACOMP_CHANNEL_DRAFT_SCHEMA_VERSION =
  "tcos.instacomp.channel-draft.v1" as const;

export type InstaCompChannelListingContent = {
  title: string;
  description: string;
  condition: string;
  quantity: number;
};

export type InstaCompChannelDraftV1 = {
  schemaVersion: typeof INSTACOMP_CHANNEL_DRAFT_SCHEMA_VERSION;
  registryIdentityId: string;
  registryFingerprintSha256: string;
  canonical: InstaCompChannelListingContent;
  website: InstaCompChannelListingContent;
  ebay: InstaCompChannelListingContent;
  contentParity: true;
  publicationStatus: InstaCompListingOutput["publicationStatus"];
  reviewReasons: string[];
  sellerReviewRequired: true;
  executableByInstaComp: false;
};

function clean(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

function normalizedContent(
  value: InstaCompChannelListingContent,
): InstaCompChannelListingContent {
  const title = clean(value.title);
  const description = value.description.normalize("NFKC").trim();
  const condition = clean(value.condition);
  const quantity = Math.trunc(value.quantity);
  if (!title || !description || !condition) {
    throw new Error("Channel listing content is incomplete.");
  }
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw new Error("Channel listing quantity must be a positive integer.");
  }
  return { title, description, condition, quantity };
}

function sameContent(
  left: InstaCompChannelListingContent,
  right: InstaCompChannelListingContent,
) {
  return (
    left.title === right.title &&
    left.description === right.description &&
    left.condition === right.condition &&
    left.quantity === right.quantity
  );
}

export function buildInstaCompChannelDraft(params: {
  registryIdentityId: string;
  registryFingerprintSha256: string;
  content: InstaCompChannelListingContent;
  listingOutput: InstaCompListingOutput;
}): InstaCompChannelDraftV1 {
  const registryIdentityId = params.registryIdentityId.trim();
  const registryFingerprintSha256 = params.registryFingerprintSha256.trim();
  if (!registryIdentityId || !registryFingerprintSha256) {
    throw new Error("CHECKLIST_IDENTITY_REQUIRED");
  }

  const canonical = normalizedContent(params.content);
  const website = { ...canonical };
  const ebay = { ...canonical };
  if (!sameContent(website, ebay)) {
    throw new Error("CHANNEL_CONTENT_PARITY_FAILED");
  }

  return {
    schemaVersion: INSTACOMP_CHANNEL_DRAFT_SCHEMA_VERSION,
    registryIdentityId,
    registryFingerprintSha256,
    canonical,
    website,
    ebay,
    contentParity: true,
    publicationStatus: params.listingOutput.publicationStatus,
    reviewReasons: [...params.listingOutput.publicationReviewReasons],
    sellerReviewRequired: true,
    executableByInstaComp: false,
  };
}

export function assertInstaCompChannelDraftParity(
  draft: InstaCompChannelDraftV1,
): InstaCompChannelDraftV1 {
  if (draft.schemaVersion !== INSTACOMP_CHANNEL_DRAFT_SCHEMA_VERSION) {
    throw new Error("Unsupported InstaComp channel-draft schema version.");
  }
  if (!sameContent(draft.canonical, draft.website)) {
    throw new Error("Website listing content diverged from the canonical draft.");
  }
  if (!sameContent(draft.canonical, draft.ebay)) {
    throw new Error("eBay listing content diverged from the canonical draft.");
  }
  if (draft.sellerReviewRequired !== true || draft.executableByInstaComp !== false) {
    throw new Error("Channel drafts must remain seller-reviewed and non-executable.");
  }
  return draft;
}
