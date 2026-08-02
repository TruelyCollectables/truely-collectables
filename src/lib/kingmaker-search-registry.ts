export type KingmakerSearchLane =
  | "sports_cards"
  | "shoes"
  | "signed_baseballs"
  | "seller_sweep"
  | "general_collectibles";

export type KingmakerSearchSource = {
  id: string;
  name: string;
  lane: KingmakerSearchLane;
  status: "active" | "planned" | "disabled";
  marketplaces: string[];
  cadence: string;
  decisionDestination: "acquisition_radar";
  portfolioDestination: "purchase_ledger";
  outcomeDestination: "opportunity_vault";
  description: string;
};

export const KINGMAKER_SEARCH_SOURCES: readonly KingmakerSearchSource[] =
  Object.freeze([
    {
      id: "profit-hunter-shark-list",
      name: "Profit Hunter + Shark List",
      lane: "sports_cards",
      status: "active",
      marketplaces: ["eBay"],
      cadence: "7 AM, 11 AM, 3 PM, 6 PM, 9 PM America/Denver",
      decisionDestination: "acquisition_radar",
      portfolioDestination: "purchase_ledger",
      outcomeDestination: "opportunity_vault",
      description:
        "Verified card opportunities, mislistings, lots, price changes, and manual-review leads.",
    },
    {
      id: "demidov-card-watch",
      name: "Ivan Demidov Card Watch",
      lane: "sports_cards",
      status: "active",
      marketplaces: ["eBay", "Mercari", "Poshmark"],
      cadence: "7 AM, 11 AM, 3 PM, 7 PM America/Denver",
      decisionDestination: "acquisition_radar",
      portfolioDestination: "purchase_ledger",
      outcomeDestination: "opportunity_vault",
      description:
        "Exact-card and lot opportunities for Ivan Demidov with delivered-cost and resale evidence.",
    },
    {
      id: "wnba-card-watch",
      name: "WNBA Card Watch",
      lane: "sports_cards",
      status: "active",
      marketplaces: ["eBay"],
      cadence: "Included in Profit Hunter production runs",
      decisionDestination: "acquisition_radar",
      portfolioDestination: "purchase_ledger",
      outcomeDestination: "opportunity_vault",
      description:
        "Rookies, parallels, lots, and exact-card opportunities across the active WNBA target roster.",
    },
    {
      id: "shoe-deal-watch",
      name: "Shoe Deal Watch",
      lane: "shoes",
      status: "active",
      marketplaces: ["Mercari", "Poshmark"],
      cadence: "7 AM, 10 AM, 1 PM, 4 PM, 8 PM America/Denver",
      decisionDestination: "acquisition_radar",
      portfolioDestination: "purchase_ledger",
      outcomeDestination: "opportunity_vault",
      description:
        "Brand-new New Balance, Adidas, and Timberland Pro deals with flip economics.",
    },
    {
      id: "raw-prospect-ball-watch",
      name: "Raw Prospect Ball Watch",
      lane: "signed_baseballs",
      status: "active",
      marketplaces: ["eBay"],
      cadence: "Included in Profit Hunter production runs",
      decisionDestination: "acquisition_radar",
      portfolioDestination: "purchase_ledger",
      outcomeDestination: "opportunity_vault",
      description:
        "Signed prospect baseball leads requiring authentication, condition, inscription, and ball-type review.",
    },
    {
      id: "seller-sweep",
      name: "Seller Sweep",
      lane: "seller_sweep",
      status: "planned",
      marketplaces: ["eBay"],
      cadence: "Trusted-seller triggered",
      decisionDestination: "acquisition_radar",
      portfolioDestination: "purchase_ledger",
      outcomeDestination: "opportunity_vault",
      description:
        "Future full-store sweeps for sellers proven to generate repeatable realized profit.",
    },
  ]);

export const KINGMAKER_SEARCH_CONTRACT = Object.freeze({
  version: "kingmaker.search-source.v1",
  discover: "Searches discover opportunities.",
  decide: "Project KINGMAKER Beta 1.0 makes the decision.",
  record: "The canonical Purchase Ledger records confirmed purchases.",
  learn: "Outcome history measures which searches and sellers actually make money.",
  noAutomaticPurchase: true,
  exactIdentityRequiredForVerifiedCardBuy: true,
  minimumIndependentCompletedSales: 2,
});
