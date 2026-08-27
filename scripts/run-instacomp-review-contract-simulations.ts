import assert from "node:assert/strict";
import {
  instaCompAiLocalScanToAi,
  type InstaCompAiLocalScan,
} from "../src/lib/instacomp-ai-local";

const scan: InstaCompAiLocalScan = {
  schema_version: "tcos.instacomp-ai.scan.v1",
  scan_id: "review-contract-123",
  card_uuid: "00000000-0000-4000-8000-000000000001",
  status: "needs_review",
  pricing_allowed: false,
  learning_allowed: false,
  trusted_identity: null,
  local_suggestion: null,
  match_source: "none",
  checklist: {
    outcome: "input_incomplete",
    reasons: ["Printed evidence did not contain a labeled card number."],
    source_receipts: [],
  },
  next_action: "Review privately.",
};

const ai = instaCompAiLocalScanToAi(scan);
assert.ok(ai, "A valid review scan must never be converted to null");
assert.equal(ai.internalScanId, "review-contract-123");
assert.equal(ai.internalStatus, "needs_review");
assert.equal(ai.internalChecklistOutcome, "input_incomplete");
assert.deepEqual(ai.internalChecklistReasons, [
  "Printed evidence did not contain a labeled card number.",
]);
assert.equal(ai.confidence, 0);
assert.equal(ai.player, null);
assert.match(ai.notes || "", /Review privately/);
console.log("InstaComp review contract simulation passed.");
