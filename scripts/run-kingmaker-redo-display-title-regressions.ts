import assert from "node:assert/strict";
import { kingmakerPendingDisplayTitle } from "../src/lib/kingmaker-redo-display-title";

// The actual bug: authoritative saved REDO title lost to stale generated
// parser/AI identity containing old team and abbreviated parallel names.
const base = {
  queue: "redo_pending_resale",
  rawTitle: "2025 Panini Prizm WNBA #64 Azura Stevens White Seismic Prizm",
  rawIsGeneric: false,
  manualListingTitle: null,
  registryExactTitle: "2025 Panini Prizm WNBA #64 Azura Stevens - Los Angeles Sparks White Seismic",
  generatedTitle: "2025 Panini Prizm WNBA #64 Azura Stevens Los Angeles Sparks White Seismic",
  identityReadout: null,
  identitySummary: null,
};
assert.equal(kingmakerPendingDisplayTitle(base), base.rawTitle);
assert.equal(kingmakerPendingDisplayTitle({
  ...base,
  rawTitle: "2025 Panini Prizm WNBA #112 Stefanie Dolson Green Prizm",
  generatedTitle: "2025 Panini Prizm WNBA #112 Stefanie Dolson Washington Mystics Green",
}), "2025 Panini Prizm WNBA #112 Stefanie Dolson Green Prizm");
assert.equal(kingmakerPendingDisplayTitle({
  ...base,
  rawTitle: "2026 Topps Rookies #301 Fernando Mendoza",
  generatedTitle: "2026 Topps Rookies #301 Fernando Mendoza Las Vegas Raiders",
}), "2026 Topps Rookies #301 Fernando Mendoza");
// Preserve explicit seller-locked title when it exists.
assert.equal(kingmakerPendingDisplayTitle({
  ...base,
  manualListingTitle: "Seller approved custom listing title",
}), "Seller approved custom listing title");
// No change to other queues: registry/generated remains authoritative.
assert.equal(kingmakerPendingDisplayTitle({
  ...base,
  queue: "verification",
}), base.registryExactTitle);
// Never elevate a generic/placeholder REDO title above exact identity.
assert.equal(kingmakerPendingDisplayTitle({
  ...base,
  rawTitle: "REDO PENDING RESALE — 588d40f7-7d3c-4eec-8514-b97871a70a04",
}), base.registryExactTitle);
assert.equal(kingmakerPendingDisplayTitle({
  ...base,
  rawTitle: "Review required",
  rawIsGeneric: true,
}), base.registryExactTitle);
console.log("PASS: REDO UI displays the corrected Mac title; manual locks, placeholders, other queues retain precedence.");
