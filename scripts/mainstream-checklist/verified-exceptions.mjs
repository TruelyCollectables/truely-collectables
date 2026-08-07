// Operational marker: final 319-promotable / 8-exception production promotion pass.
export const VERIFIED_NON_PROMOTABLE_SOURCES = Object.freeze([
  {
    id: "SR-0229",
    sourceUrl: "https://www.cardboardconnection.com/2018-leaf-perfect-game-draft-day-bonus-baseball-cards",
    classification: "no_finite_checklist",
    reason:
      "2018 Leaf Perfect Game Draft Day Bonus reuses cards from prior 2018 Leaf Perfect Game products with bonus-only parallels; contemporaneous product documentation explicitly states that no checklist is available for this product.",
  },
  {
    id: "SR-0231",
    sourceUrl: "https://www.cardboardconnection.com/2019-leaf-all-american-football-vault-cards",
    classification: "repack_without_standalone_checklist",
    reason:
      "2019 Leaf All-American Football Vault contains a sealed prior-year U.S. Army All-American box plus a four-autograph 2019 Leaf Metal All-American bonus box. It does not define a standalone finite card universe separate from its parent products.",
  },
  {
    id: "SR-0233",
    sourceUrl: "https://www.cardboardconnection.com/2020-topps-wwe-raw-vs-smackdown-wrestling-cards",
    classification: "cancelled_product",
    reason:
      "2020 Topps WWE Raw vs. SmackDown was cancelled before release; proposed mockups and preliminary configuration must not create live card identities.",
  },
]);

export const VERIFIED_NON_PROMOTABLE_IDS = new Set(
  VERIFIED_NON_PROMOTABLE_SOURCES.map((entry) => entry.id),
);

export function isVerifiedNonPromotable(entry) {
  return VERIFIED_NON_PROMOTABLE_IDS.has(entry?.id);
}
