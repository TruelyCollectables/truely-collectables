import "server-only";

import { createSupabaseServerClient } from "./supabase-server";
import type { PortfolioBucket } from "./market-intel-purchase-intelligence";

export type OfflineAcquisitionChannel =
  | "card_show"
  | "card_shop"
  | "private_deal"
  | "trade"
  | "other";

export type ManualPurchaseInput = {
  acquisitionChannel: OfflineAcquisitionChannel;
  sourceName: string;
  sourceLocation: string;
  purchaseDate: string;
  portfolioBucket: PortfolioBucket;
  alreadyReceived: boolean;
  playerName: string;
  sportOrCategory: string;
  seasonYear: string;
  manufacturer: string;
  brand: string;
  productLine: string;
  setName: string;
  insertName: string;
  cardNumber: string;
  parallelName: string;
  variationName: string;
  serialNumberedTo: number | null;
  autograph: boolean;
  memorabilia: boolean;
  rookieDesignation: boolean;
  conditionType: string;
  gradingCompany: string;
  grade: string;
  quantity: number;
  itemSubtotal: number;
  inboundShipping: number;
  salesTax: number;
  buyerFees: number;
  otherCost: number;
  notes: string;
};

function slug(value: string | null | undefined) {
  return (
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "none"
  );
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function validMoney(value: number) {
  return Number.isFinite(value) && value >= 0;
}

async function resolveSubject(input: ManualPurchaseInput) {
  const supabase = createSupabaseServerClient({ admin: true });
  const playerName = input.playerName.trim();
  if (!playerName) throw new Error("Player name is required.");

  const { data: existing, error: lookupError } = await supabase
    .from("tcos_mi_subjects")
    .select("id,name,sport_or_category")
    .eq("subject_type", "player")
    .ilike("name", playerName)
    .limit(1)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (existing?.id) return existing;

  const { data, error } = await supabase
    .from("tcos_mi_subjects")
    .insert({
      subject_type: "player",
      name: playerName,
      sport_or_category: input.sportOrCategory.trim() || "Other Sports Card",
      league_or_brand: "Offline Purchase",
      team_or_affiliation: null,
      priority: 40,
      active: true,
      notes: "[OFFLINE_PURCHASE] Created from Card Show / Card Shop purchase intake.",
    })
    .select("id,name,sport_or_category")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function resolveIdentity(
  input: ManualPurchaseInput,
  subject: {
    id: string;
    name: string;
    sport_or_category: string | null;
  },
) {
  const supabase = createSupabaseServerClient({ admin: true });
  const parallelName = input.parallelName.trim() || "Base";
  const conditionType = input.conditionType.trim() || "raw";
  const conditionLabel =
    conditionType === "graded"
      ? `${input.gradingCompany.trim()} ${input.grade.trim()}`.trim()
      : conditionType.replaceAll("_", " ");
  const productLabel =
    input.insertName.trim() || input.setName.trim() || input.productLine.trim();
  const displayName = [
    input.seasonYear.trim(),
    input.manufacturer.trim(),
    input.productLine.trim(),
    productLabel && productLabel !== input.productLine.trim() ? productLabel : null,
    subject.name,
    `#${input.cardNumber.trim()}`,
    parallelName !== "Base" ? parallelName : null,
    input.variationName.trim() || null,
    input.serialNumberedTo ? `/${input.serialNumberedTo}` : null,
    conditionLabel,
  ]
    .filter(Boolean)
    .join(" — ");

  const identityKey = [
    "sports-card",
    subject.name,
    input.seasonYear,
    input.manufacturer,
    input.productLine,
    input.setName,
    input.insertName,
    input.cardNumber,
    parallelName,
    input.variationName,
    input.serialNumberedTo ? String(input.serialNumberedTo) : "unnumbered",
    input.autograph ? "auto" : "no-auto",
    input.memorabilia ? "memorabilia" : "no-memorabilia",
    conditionType,
    input.gradingCompany,
    input.grade,
  ]
    .map(slug)
    .join("|");

  const { data: existing, error: lookupError } = await supabase
    .from("tcos_mi_collectible_identities")
    .select("id,display_name")
    .eq("identity_key", identityKey)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (existing?.id) return existing;

  const { data, error } = await supabase
    .from("tcos_mi_collectible_identities")
    .insert({
      subject_id: subject.id,
      collectible_type: "sports_card",
      sport_or_category: subject.sport_or_category || input.sportOrCategory,
      season_year: input.seasonYear.trim(),
      manufacturer: input.manufacturer.trim(),
      brand: input.brand.trim() || input.manufacturer.trim(),
      product_line: input.productLine.trim() || null,
      set_name: input.setName.trim() || null,
      insert_name: input.insertName.trim() || null,
      card_number: input.cardNumber.trim().toUpperCase(),
      parallel_name: parallelName,
      variation_name: input.variationName.trim() || null,
      serial_numbered_to: input.serialNumberedTo,
      autograph: input.autograph,
      memorabilia: input.memorabilia,
      rookie_designation: input.rookieDesignation,
      condition_type: conditionType,
      grading_company:
        conditionType === "graded" ? input.gradingCompany.trim() : null,
      grade: conditionType === "graded" ? input.grade.trim() : null,
      identity_key: identityKey,
      display_name: displayName,
      identity_confidence: 100,
      active: true,
    })
    .select("id,display_name")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function createManualMarketIntelPurchase(input: ManualPurchaseInput) {
  if (!input.purchaseDate) throw new Error("Purchase date is required.");
  if (
    !input.seasonYear.trim() ||
    !input.manufacturer.trim() ||
    !input.cardNumber.trim()
  ) {
    throw new Error(
      "Year, manufacturer, and card number are required for exact-card tracking.",
    );
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error("Quantity must be a positive whole number.");
  }
  if (
    input.serialNumberedTo !== null &&
    (!Number.isInteger(input.serialNumberedTo) || input.serialNumberedTo <= 0)
  ) {
    throw new Error("Serial numbering must be a positive whole number.");
  }
  if (
    input.conditionType === "graded" &&
    (!input.gradingCompany.trim() || !input.grade.trim())
  ) {
    throw new Error("Graded cards require a grading company and grade.");
  }

  const costs = [
    input.itemSubtotal,
    input.inboundShipping,
    input.salesTax,
    input.buyerFees,
    input.otherCost,
  ];
  if (!costs.every(validMoney)) {
    throw new Error("All purchase costs must be zero or greater.");
  }

  const subject = await resolveSubject(input);
  const identity = await resolveIdentity(input, subject);
  const total = roundMoney(costs.reduce((sum, value) => sum + value, 0));
  const purchasedAt = new Date(`${input.purchaseDate}T12:00:00`).toISOString();
  const now = new Date().toISOString();
  const supabase = createSupabaseServerClient({ admin: true });

  const sourceTypeLabel = input.acquisitionChannel
    .replaceAll("_", " ")
    .toUpperCase();
  const sourceName = input.sourceName.trim() || sourceTypeLabel;
  const sourceLocation = input.sourceLocation.trim();
  const strategyLabel =
    input.portfolioBucket === "pc"
      ? "Personal Collection"
      : input.portfolioBucket === "hold"
        ? "Hold / Investment"
        : "Resale";

  const { data, error } = await supabase
    .from("tcos_mi_purchase_lots")
    .insert({
      collectible_identity_id: identity.id,
      marketplace_id: null,
      source_listing_id: null,
      purchased_at: purchasedAt,
      status: input.alreadyReceived ? "in_inventory" : "awaiting_receipt",
      quantity_purchased: input.quantity,
      item_subtotal: roundMoney(input.itemSubtotal),
      inbound_shipping: roundMoney(input.inboundShipping),
      buyer_fees: roundMoney(input.buyerFees),
      sales_tax: roundMoney(input.salesTax),
      other_acquisition_cost: roundMoney(input.otherCost),
      received_at: input.alreadyReceived ? now : null,
      source_url: null,
      deal_label: null,
      notes:
        input.notes.trim() ||
        `Purchased from ${sourceName}${sourceLocation ? ` at ${sourceLocation}` : ""}. Total paid $${total.toFixed(2)}. Strategy: ${strategyLabel}.`,
      metadata: {
        beta_one_purchase_source: "offline_purchase_intake",
        acquisition_channel: input.acquisitionChannel,
        acquisition_source_name: sourceName,
        acquisition_location: sourceLocation || null,
        portfolio_bucket: input.portfolioBucket,
        actual_item_subtotal: roundMoney(input.itemSubtotal),
        actual_inbound_shipping: roundMoney(input.inboundShipping),
        actual_sales_tax: roundMoney(input.salesTax),
        actual_buyer_fees: roundMoney(input.buyerFees),
        actual_other_cost: roundMoney(input.otherCost),
        actual_out_the_door_cost: total,
        manual_offline_purchase: true,
        created_at: now,
      },
    })
    .select("id,purchase_number")
    .single();
  if (error) throw new Error(error.message);

  return {
    purchaseId: String(data.id),
    purchaseNumber: Number(data.purchase_number),
    identityId: String(identity.id),
  };
}
