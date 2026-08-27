import assert from "node:assert/strict";
import {
  instaCompPendingDraftParityBlockers,
  synchronizeInstaCompPendingDraftMetadata,
} from "../src/lib/instacomp-pending-edit";

const originalMetadata = {
  instacomp: {
    scanId: "scan-1",
    source: "mac_registry_scanner",
    checklistIdentity: {
      status: "identified",
      source: "checklist_registry",
      registryIdentityId: "identity-1",
      registryFingerprintSha256: "fingerprint-1",
      checkedAt: "2026-08-05T12:00:00.000Z",
      lockedFields: {
        year: "2023-24",
        manufacturer: "Upper Deck",
        cardNumber: "1",
        player: "Wrong Player",
      },
    },
    channelDraft: {
      schemaVersion: "tcos.instacomp.channel-draft.v1",
      registryIdentityId: "identity-1",
      registryFingerprintSha256: "fingerprint-1",
      canonical: {
        title: "Wrong title",
        description: "Wrong description",
        condition: "Ungraded",
        quantity: 1,
      },
      website: {
        title: "Wrong title",
        description: "Wrong description",
        condition: "Ungraded",
        quantity: 1,
      },
      ebay: {
        title: "Wrong title",
        description: "Wrong description",
        condition: "Ungraded",
        quantity: 1,
      },
      contentParity: true,
      sellerReviewRequired: true,
      executableByInstaComp: false,
    },
  },
  seller_review: {
    identity_confirmed: true,
    confirmed_at: "2026-08-05T12:01:00.000Z",
    confirmed_by: "sales@truelycollectables.com",
  },
};

const corrected = synchronizeInstaCompPendingDraftMetadata({
  metadata: originalMetadata,
  previous: {
    title: "Wrong title",
    description: "Wrong description",
    condition: "Ungraded",
    quantity: 1,
  },
  next: {
    title: "Correct title",
    description: "Correct description",
    condition: "Ungraded",
    quantity: 2,
  },
  editedAt: "2026-08-05T13:00:00.000Z",
  editedBy: "sales@truelycollectables.com",
});

const instacomp = corrected.instacomp as Record<string, any>;
const channelDraft = instacomp.channelDraft as Record<string, any>;
for (const lane of ["canonical", "website", "ebay"] as const) {
  assert.equal(channelDraft[lane].title, "Correct title");
  assert.equal(channelDraft[lane].description, "Correct description");
  assert.equal(channelDraft[lane].quantity, 2);
}
assert.equal(channelDraft.contentParity, true);
assert.equal(channelDraft.sellerReviewRequired, true);
assert.equal(channelDraft.executableByInstaComp, false);
assert.equal(
  (corrected.seller_review as Record<string, any>).identity_confirmed,
  false,
);
assert.equal(
  (instacomp.checklistIdentity as Record<string, any>).registryIdentityId,
  "identity-1",
);
assert.deepEqual(
  instaCompPendingDraftParityBlockers({
    metadata: corrected,
    content: {
      title: "Correct title",
      description: "Correct description",
      condition: "Ungraded",
      quantity: 2,
    },
  }),
  [],
);
assert.deepEqual(
  instaCompPendingDraftParityBlockers({
    metadata: corrected,
    content: {
      title: "Different top-level title",
      description: "Correct description",
      condition: "Ungraded",
      quantity: 2,
    },
  }),
  [
    "canonical_draft_content_mismatch",
    "website_draft_content_mismatch",
    "ebay_draft_content_mismatch",
  ],
);
assert.equal(
  (originalMetadata.instacomp.channelDraft.canonical as Record<string, any>).title,
  "Wrong title",
  "The synchronizer must not mutate the previous metadata object.",
);

console.log("InstaComp pending edit persistence regressions passed.");
