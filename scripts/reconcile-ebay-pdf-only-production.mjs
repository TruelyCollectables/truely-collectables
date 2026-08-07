import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const RESULT_FILE = "ebay-pdf-only-reconciliation-result.json";
const EXPECTED_ORDER_COUNT = 25;
const EXPECTED_LINE_COUNT = 28;
const EXPECTED_ALL_IN_TOTAL = 528.52;

const H = {
  kikiRed75: "0801f6d8f7d5c6d75f480895169ad81d632d93f18b38c27df4cc380323090821",
  kiki12: "5a5991524fa9acfd8dbb462cfaa9c8a1e0a057bd1977e7dd784060d323895bdb",
  citronLogoAug6: "5ea3dc93db0c1b5b1a6178b1975c4de1bc0a1dd207a5ea7834f52e7188f4b1c9",
  multiAug6: "08973dda32e6ce2be4b8ebb7936f87092f86a17ab9fcb970c04c385c0b6932ab",
  kikiDonruss: "50dd91cb3343e85e0054443bd824f3eebd221475152f75b7d2e4c0d37a94a155",
  wnba17: "e9cbb7d47e9788d139901c151ceb7ba828f8a42b857825304b82e5f71a38705a",
  citronGroovy: "a040a23340a41ebdef6191fc640dec1d40569832f078b4a987dcade38a73ba8e",
  citronGreen148: "759794aaf7e3e0071ce3a1fc270f3758714103558796f0f062971069834d5f9c",
  citron5: "b138931b1a42b8f943f4a1796fd81fdbe5d03b90242f37409a945ff47e635888",
  compton199: "968a2b0db00d023c7d7c70f9ddfc73f9141f1faec14faa6e16001a7efe403706",
  malongaGroovy: "87d248edf449251b855bf20ed9f140397b81edc37ec6b4a55b88b7fb5c90782c",
  citronSilver253: "01806de13bb3b1334c73152afde1cffc7fa85000d06da6ac682b468f8bcd5e1f",
  midland: "82e9bfa02f28ebe12ea29d79e41a82dba7605ce707fded0511b1b6223631b818",
  citronSilver313: "accf4909164619d8f8a9e8741c247b98cbf3150b7ad9aadc2c77498035ba4d78",
  citronEnFuego: "42905016278441b82ae38caeb568d254221e6ac054e7d29ea0a53a264ac5f91d",
  citronFireworks: "44d641deb737ffe158b4e57b55eb5604db1c0135c253f7f8adcd100952c08691",
  citronSnapshots: "59beb36cb3b94fb6674310d10761ab2411e70c35cc574f5c0428c5e4264c4dd2",
  lombard499: "38acc32838f76f84706094296e51eec59fcf2d40f7e5fb4c91c270d0e22d7be5",
  citronSelect5: "6da3952584541d60f62be91cf5e3347cacaea8de23a316582a14d4934299c0bf",
  wnba92: "7cca87655edb6c06add807f09e0a6c5349133af97c890e97ae3c137d175fc13d",
  wnba20: "293065c9c01f1a22b7c59234f9a75ac3f88b372ecda458eacf5ab255f906aff9",
  citronLogoJul21: "b36036a4b340d1393282bba568e75886ff8af085fe8ff7e7b59db7566c1130d9",
  demidov100: "19ad41fce4ef315dcd02e6a1ba202015a1382790f1a12386b88e8d888aa228fc",
  citronVelocityRefund: "b13eedb8abea93f56a3c49a72d472d9ccec8159c127fb40db9ef8792a98bc263",
  citronSilver351: "53f65eb404ebf78f26cff6a213fdb2166b2c6b072f91582928d9be3966b6862c",
};

const LINES = [
  { orderHash: H.kikiRed75, date: "2026-08-06", title: "2025 Panini Prizm WNBA KIKI IRIAFEN #149 RC Variant Red Power /75 Color Match", allIn: 23.37, units: 1, sport: "Basketball" },
  { orderHash: H.kiki12, date: "2026-08-06", title: "Kiki Iriafen Mystics 2025 Rookie 12 different card lot Prizm/Select /Donruss", allIn: 17.14, units: 12, sport: "Basketball" },
  { orderHash: H.citronLogoAug6, date: "2026-08-06", title: "2025 Panini Prizm WNBA - Rookie Variation Sonia Citron #148 WNBA Logo Prizm (RC)", allIn: 19.48, units: 1, sport: "Basketball" },
  { orderHash: H.multiAug6, date: "2026-08-06", lineIndex: 1, lineCount: 4, title: "Dominique Malonga 2025 Panini Prizm, Select Card Lot (11 Cards) Blue, Rookie", allIn: 7.49, units: 11, sport: "Basketball" },
  { orderHash: H.multiAug6, date: "2026-08-06", lineIndex: 2, lineCount: 4, title: "Dominique Malonga 2025 Select, Prizm Card Lot (15 Cards) RC, Pink, Orange, Ice", allIn: 12.07, units: 15, sport: "Basketball" },
  { orderHash: H.multiAug6, date: "2026-08-06", lineIndex: 3, lineCount: 4, title: "Angel Reese 2024-2025 Panini Prizm, Instant Card Lot (10 Cards) RC, Deep Space", allIn: 18.92, units: 10, sport: "Basketball" },
  { orderHash: H.multiAug6, date: "2026-08-06", lineIndex: 4, lineCount: 4, title: "Dominique Malonga 2025 Prizm, Select Card Lot (10 Cards) Green Fireworks, RC", allIn: 5.57, units: 10, sport: "Basketball" },
  { orderHash: H.kikiDonruss, date: "2026-08-04", title: "2025 Donruss WNBA Kiki Iriafen RC Lot Net Marvels Rated Rookie Silver Lava", allIn: 4.77, units: 2, sport: "Basketball" },
  { orderHash: H.wnba17, date: "2026-08-03", title: "2025 WNBA Select Prizm Card Lot (17 Cards) Orange, Courtside, Premier Level", allIn: 11.26, units: 17, sport: "Basketball" },
  { orderHash: H.citronGroovy, date: "2026-08-02", title: "2025 Panini Prizm WNBA Sonia Citron Groovy #13 Red /99 RC Mystics Color Match", allIn: 23.95, units: 1, sport: "Basketball" },
  { orderHash: H.citronGreen148, date: "2026-08-02", title: "2025 Panini Prizm WNBA Base & Inserts You Pick Complete Your Set - GREEN PRIZM - 148 Sonia Cintron (RC)", allIn: 5.46, units: 1, sport: "Basketball" },
  { orderHash: H.citron5, date: "2026-08-02", title: "2025 WNBA Prizm Sonia Citron Rookie 5 Card Lot Green, Cracked Ice Base Mystics RC", allIn: 14.74, units: 5, sport: "Basketball" },
  { orderHash: H.compton199, date: "2026-08-02", title: "2025 Bowman Draft Brandon Compton Purple Mojo Auto /199 Marlins Chrome Rookie RC", allIn: 23.37, units: 1, sport: "Baseball" },
  { orderHash: H.malongaGroovy, date: "2026-08-02", title: "2025 Panini Prizm WNBA - Groovy Dominique Malonga #8 Red Prizm /99 (RC)", allIn: 20.13, units: 1, sport: "Basketball" },
  { orderHash: H.citronSilver253, date: "2026-08-02", title: "2025 Panini Select WNBA - Sonia Citron Silver Prizm #83 (RC) Washington Mystics", allIn: 2.53, units: 1, sport: "Basketball" },
  { orderHash: H.midland, date: "2026-08-02", title: "Five Posters Signed By Midland, Mark Wystrach, Jess Carson, And Cameron Duddy", allIn: 99.51, units: 5, sport: "Other Collectible" },
  { orderHash: H.citronSilver313, date: "2026-07-30", title: "Sonia Citron RC 2025 Panini Select WNBA Silver Prizm Concourse Level #83 Mystics", allIn: 3.13, units: 1, sport: "Basketball" },
  { orderHash: H.citronEnFuego, date: "2026-07-29", title: "2025 Panini Select WNBA #7 Sonia Citron En Fuego Silver Flash RC Mystics SSP", allIn: 8.26, units: 1, sport: "Basketball" },
  { orderHash: H.citronFireworks, date: "2026-07-28", title: "2025 Prizm WNBA Sonia Citron Green Fireworks Rookie RC #15 Mystics", allIn: 3.40, units: 1, sport: "Basketball" },
  { orderHash: H.citronSnapshots, date: "2026-07-25", title: "2025 Panini Select WNBA SONIA CITRON SNAPSHOTS ICE PRIZM MYSTICS #7", allIn: 4.08, units: 1, sport: "Basketball" },
  { orderHash: H.lombard499, date: "2026-07-25", title: "George Lombard Jr. 2024 Bowman Chrome Refractor 1st RC #BCP-79 #ed 173/499", allIn: 34.87, units: 1, sport: "Baseball" },
  { orderHash: H.citronSelect5, date: "2026-07-25", title: "Panini Sonia Citron Mystics 2025 Select + Prizm RC En Fuego 5-Card Lot", allIn: 12.86, units: 5, sport: "Basketball" },
  { orderHash: H.wnba92, date: "2026-07-23", title: "2025-26 WNBA Panini Prem Mixer (92Cards) PRIZMS, Inserts, RCs, Sonia Sophie", allIn: 33.57, units: 92, sport: "Basketball" },
  { orderHash: H.wnba20, date: "2026-07-23", title: "2025 Panini Prizm WNBA 20 Card Ice & Blue Parallel Lot RC Paige Bueckers HVL", allIn: 32.38, units: 20, sport: "Basketball" },
  { orderHash: H.citronLogoJul21, date: "2026-07-21", title: "Sonia Citron 2025 Panini Prizm WNBA #122 WNBA Logo Prizms Rookie", allIn: 20.56, units: 1, sport: "Basketball" },
  { orderHash: H.demidov100, date: "2026-07-20", title: "Lot of 50 2025-2026 Upper Deck Ivan Demidov National Hockey Day RC Bonus Card - Quantity 2", allIn: 61.83, units: 100, sport: "Hockey" },
  { orderHash: H.citronVelocityRefund, date: "2026-07-19", title: "2025 Panini Prizm WNBA - Sonia Citron #122 Blue Velocity Prizm (RC) Mystics - Partially Refunded", allIn: 0.31, units: 1, sport: "Basketball" },
  { orderHash: H.citronSilver351, date: "2026-07-19", title: "2025 Panini Select WNBA- Sonia Citron #122 Silver Prizm (RC)", allIn: 3.51, units: 1, sport: "Basketball" },
].map((line) => ({ ...line, lineIndex: line.lineIndex || 1, lineCount: line.lineCount || 1 }));

function sha(value) {
  return createHash("sha256").update(String(value || "").trim()).digest("hex");
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(["the", "and", "for", "with", "card", "cards", "lot", "panini", "wnba", "rookie", "rc", "2024", "2025", "2026"]);

function tokens(value) {
  return new Set(normalize(value).split(" ").filter((token) => token.length >= 2 && !STOP.has(token)));
}

function titleScore(left, right) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  return common / Math.min(a.size, b.size);
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function dateOnly(value) {
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "";
}

function orderHashesFromMetadata(metadata) {
  const row = record(metadata);
  const hashes = new Set();
  for (const key of ["external_order_hash_sha256", "pdf_order_hash_sha256"]) {
    const value = String(row[key] || "").trim();
    if (/^[a-f0-9]{64}$/i.test(value)) hashes.add(value.toLowerCase());
  }
  for (const key of ["external_order_id", "order_number", "ebay_order_id", "order_id", "receipt_order_id"]) {
    const value = String(row[key] || "").trim();
    if (value) hashes.add(sha(value));
  }
  return hashes;
}

function inboxHashes(row) {
  const hashes = orderHashesFromMetadata(row.metadata);
  const external = String(row.external_order_id || "").trim();
  if (external) hashes.add(sha(external));
  return hashes;
}

function lotTitle(lot, identityById) {
  const metadata = record(lot.metadata);
  return String(
    metadata.source_listing_title ||
      metadata.original_title ||
      metadata.purchase_title ||
      metadata.listing_title ||
      (lot.collectible_identity_id ? identityById.get(String(lot.collectible_identity_id)) : "") ||
      lot.notes ||
      "",
  );
}

function playerFromTitle(title) {
  const normalized = normalize(title);
  for (const name of ["Kiki Iriafen", "Sonia Citron", "Dominique Malonga", "Angel Reese", "Brandon Compton", "George Lombard Jr.", "Ivan Demidov", "Paige Bueckers"]) {
    if (normalized.includes(normalize(name))) return name;
  }
  if (normalized.includes("midland")) return "Midland";
  return "Mixed Purchase Lot";
}

function syntheticUrl(line) {
  return `https://www.ebay.com/mye/myebay/purchase#pdf-${line.orderHash.slice(0, 12)}-${line.lineIndex}`;
}

function moneyClose(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= 0.02;
}

function matchScoreForLot(line, lot, title, hashMatch) {
  const score = titleScore(line.title, title);
  const dateMatch = dateOnly(lot.purchased_at) === line.date;
  const costMatch = moneyClose(lot.total_acquisition_cost, line.allIn);
  if (hashMatch && line.lineCount === 1) return 100 + score;
  if (hashMatch && (score >= 0.34 || costMatch)) return 90 + score;
  if (dateMatch && costMatch && score >= 0.42) return 70 + score;
  if (dateMatch && score >= 0.72) return 60 + score;
  return -1;
}

function matchScoreForInbox(line, row) {
  const hashMatch = inboxHashes(row).has(line.orderHash);
  const score = titleScore(line.title, row.title);
  const dateMatch = dateOnly(row.purchased_at) === line.date;
  const costMatch = moneyClose(row.total_paid, line.allIn);
  if (hashMatch && line.lineCount === 1) return 100 + score;
  if (hashMatch && (score >= 0.34 || costMatch)) return 90 + score;
  if (dateMatch && costMatch && score >= 0.42) return 70 + score;
  return -1;
}

function chooseBest(candidates, label) {
  const eligible = candidates.filter((candidate) => candidate.score >= 0).sort((a, b) => b.score - a.score);
  if (!eligible.length) return null;
  if (eligible.length > 1 && eligible[0].score - eligible[1].score < 0.05 && eligible[0].id !== eligible[1].id) {
    throw new Error(`Ambiguous ${label}: two existing records scored equally; refusing to duplicate or overwrite.`);
  }
  return eligible[0];
}

async function main() {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceRole) throw new Error("Production Supabase credentials are unavailable inside the Vercel build.");

  const orderHashes = new Set(LINES.map((line) => line.orderHash));
  const total = roundMoney(LINES.reduce((sum, line) => sum + line.allIn, 0));
  if (LINES.length !== EXPECTED_LINE_COUNT || orderHashes.size !== EXPECTED_ORDER_COUNT || total !== EXPECTED_ALL_IN_TOTAL) {
    throw new Error(`PDF fixture integrity failure: ${LINES.length} lines, ${orderHashes.size} orders, $${total.toFixed(2)}.`);
  }

  const supabase = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: marketplaces, error: marketplaceError } = await supabase.from("tcos_mi_marketplaces").select("id,name,slug").eq("slug", "ebay").limit(2);
  if (marketplaceError) throw new Error(marketplaceError.message);
  if (!marketplaces || marketplaces.length !== 1) throw new Error("Exactly one eBay marketplace row is required.");
  const ebayMarketplaceId = String(marketplaces[0].id);

  const [inboxResult, lotResult] = await Promise.all([
    supabase.from("tcos_mi_purchase_inbox").select("id,external_order_id,external_listing_id,direct_url,title,purchased_at,quantity,total_paid,purchase_lot_id,status,metadata").limit(5000),
    supabase.from("tcos_mi_purchase_lots").select("id,purchase_number,purchased_at,quantity_purchased,item_subtotal,inbound_shipping,buyer_fees,sales_tax,other_acquisition_cost,total_acquisition_cost,unit_cost_basis,source_url,notes,metadata,collectible_identity_id,marketplace_id").order("purchase_number", { ascending: false }).limit(5000),
  ]);
  if (inboxResult.error) throw new Error(inboxResult.error.message);
  if (lotResult.error) throw new Error(lotResult.error.message);
  const inboxRows = [...(inboxResult.data || [])];
  const lots = [...(lotResult.data || [])];

  const identityIds = Array.from(new Set(lots.map((lot) => lot.collectible_identity_id).filter(Boolean).map(String)));
  const identityResult = identityIds.length
    ? await supabase.from("tcos_mi_collectible_identities").select("id,display_name").in("id", identityIds)
    : { data: [], error: null };
  if (identityResult.error) throw new Error(identityResult.error.message);
  const identityById = new Map((identityResult.data || []).map((row) => [String(row.id), String(row.display_name || "")]));

  const claimedLotIds = new Set();
  const claimedInboxIds = new Set();
  const represented = [];
  const summary = { created: 0, reused: 0, corrected: 0, inboxCreated: 0, inboxLinked: 0 };

  for (const line of LINES) {
    const inboxCandidate = chooseBest(
      inboxRows
        .filter((row) => !claimedInboxIds.has(String(row.id)))
        .map((row) => ({ id: String(row.id), row, score: matchScoreForInbox(line, row) })),
      `Purchase Inbox match for ${line.title}`,
    );
    let inbox = inboxCandidate?.row || null;
    if (inbox) claimedInboxIds.add(String(inbox.id));

    let lot = null;
    if (inbox?.purchase_lot_id) {
      const linked = lots.find((candidate) => String(candidate.id) === String(inbox.purchase_lot_id));
      if (linked && !claimedLotIds.has(String(linked.id))) lot = linked;
    }

    if (!lot) {
      const lotCandidate = chooseBest(
        lots
          .filter((candidate) => !claimedLotIds.has(String(candidate.id)))
          .map((candidate) => {
            const title = lotTitle(candidate, identityById);
            const hashMatch = orderHashesFromMetadata(candidate.metadata).has(line.orderHash);
            return { id: String(candidate.id), row: candidate, score: matchScoreForLot(line, candidate, title, hashMatch) };
          }),
        `Purchase Ledger match for ${line.title}`,
      );
      lot = lotCandidate?.row || null;
    }

    if (!inbox) {
      const { data: insertedInbox, error: inboxInsertError } = await supabase
        .from("tcos_mi_purchase_inbox")
        .insert({
          marketplace_id: ebayMarketplaceId,
          external_order_id: null,
          external_listing_id: null,
          direct_url: syntheticUrl(line),
          title: line.title,
          image_urls: [],
          player_name: playerFromTitle(line.title),
          sport_or_category: line.sport,
          purchased_at: new Date(`${line.date}T12:00:00Z`).toISOString(),
          quantity: line.units,
          item_subtotal: line.allIn,
          inbound_shipping: 0,
          sales_tax: 0,
          buyer_fees: 0,
          other_cost: 0,
          target_bucket: "resale",
          status: "pending",
          metadata: {
            source: "uploaded_ebay_purchase_history_pdf",
            pdf_purchase_history_verified: true,
            pdf_order_hash_sha256: line.orderHash,
            pdf_order_line_index: line.lineIndex,
            pdf_order_line_count: line.lineCount,
            source_listing_title: line.title,
            all_in_price_authoritative: line.allIn,
            expanded_collectible_quantity: line.units,
            exact_identity_status: "pending",
          },
        })
        .select("id,external_order_id,external_listing_id,direct_url,title,purchased_at,quantity,total_paid,purchase_lot_id,status,metadata")
        .single();
      if (inboxInsertError) throw new Error(`Inbox insert for ${line.title}: ${inboxInsertError.message}`);
      inbox = insertedInbox;
      inboxRows.push(inbox);
      claimedInboxIds.add(String(inbox.id));
      summary.inboxCreated += 1;
    }

    if (!lot) {
      const metadata = {
        beta_one_purchase_source: "uploaded_ebay_purchase_history_pdf",
        purchase_inbox_id: inbox.id,
        portfolio_bucket: "resale",
        provisional_identity: true,
        exact_identity_status: "pending",
        external_order_hash_sha256: line.orderHash,
        pdf_order_line_index: line.lineIndex,
        pdf_order_line_count: line.lineCount,
        source_listing_title: line.title,
        actual_item_subtotal: line.allIn,
        actual_inbound_shipping: 0,
        actual_sales_tax: 0,
        actual_buyer_fees: 0,
        actual_other_cost: 0,
        actual_out_the_door_cost: line.allIn,
        all_in_price_source: "uploaded_ebay_purchase_history_pdf",
        expanded_collectible_quantity: line.units,
        imported_at: new Date().toISOString(),
      };
      const { data: insertedLot, error: lotInsertError } = await supabase
        .from("tcos_mi_purchase_lots")
        .insert({
          collectible_identity_id: null,
          marketplace_id: ebayMarketplaceId,
          source_listing_id: null,
          purchased_at: new Date(`${line.date}T12:00:00Z`).toISOString(),
          status: "awaiting_receipt",
          quantity_purchased: line.units,
          item_subtotal: line.allIn,
          inbound_shipping: 0,
          buyer_fees: 0,
          sales_tax: 0,
          other_acquisition_cost: 0,
          received_at: null,
          source_url: syntheticUrl(line),
          deal_label: "EBAY PURCHASE",
          notes: `Uploaded eBay Purchase History: ${line.title}. ALL-IN paid $${line.allIn.toFixed(2)} for ${line.units} tracked unit${line.units === 1 ? "" : "s"}. Exact identity remains pending.`,
          metadata,
        })
        .select("id,purchase_number,purchased_at,quantity_purchased,item_subtotal,inbound_shipping,buyer_fees,sales_tax,other_acquisition_cost,total_acquisition_cost,unit_cost_basis,source_url,notes,metadata,collectible_identity_id,marketplace_id")
        .single();
      if (lotInsertError) throw new Error(`Ledger insert for ${line.title}: ${lotInsertError.message}`);
      lot = insertedLot;
      lots.push(lot);
      summary.created += 1;
    } else {
      summary.reused += 1;
    }

    claimedLotIds.add(String(lot.id));
    const currentCost = roundMoney(lot.total_acquisition_cost);
    const currentUnits = Math.round(Number(lot.quantity_purchased || 0));
    const needsCorrection = currentCost !== line.allIn || currentUnits !== line.units;
    const mergedMetadata = {
      ...record(lot.metadata),
      purchase_inbox_id: record(lot.metadata).purchase_inbox_id || inbox.id,
      external_order_hash_sha256: line.orderHash,
      pdf_order_line_index: line.lineIndex,
      pdf_order_line_count: line.lineCount,
      source_listing_title: record(lot.metadata).source_listing_title || line.title,
      actual_item_subtotal: line.allIn,
      actual_inbound_shipping: 0,
      actual_sales_tax: 0,
      actual_buyer_fees: 0,
      actual_other_cost: 0,
      actual_out_the_door_cost: line.allIn,
      all_in_price_source: "uploaded_ebay_purchase_history_pdf",
      all_in_reconciled: true,
      all_in_reconciled_at: new Date().toISOString(),
      expanded_collectible_quantity: line.units,
    };
    if (needsCorrection || record(lot.metadata).all_in_reconciled !== true) {
      const reconciliationNote = `ALL-IN eBay cost reconciled from uploaded Purchase History: $${line.allIn.toFixed(2)} for ${line.units} tracked unit${line.units === 1 ? "" : "s"}.`;
      const priorNotes = String(lot.notes || "").trim();
      const notes = priorNotes.includes(reconciliationNote) ? priorNotes : [priorNotes, reconciliationNote].filter(Boolean).join("\n");
      const { error: correctionError } = await supabase
        .from("tcos_mi_purchase_lots")
        .update({
          quantity_purchased: line.units,
          item_subtotal: line.allIn,
          inbound_shipping: 0,
          buyer_fees: 0,
          sales_tax: 0,
          other_acquisition_cost: 0,
          notes,
          metadata: mergedMetadata,
        })
        .eq("id", lot.id);
      if (correctionError) throw new Error(`Ledger correction for Purchase #${lot.purchase_number}: ${correctionError.message}`);
      summary.corrected += needsCorrection ? 1 : 0;
    }

    if (String(inbox.purchase_lot_id || "") !== String(lot.id)) {
      const { error: linkError } = await supabase
        .from("tcos_mi_purchase_inbox")
        .update({
          purchase_lot_id: lot.id,
          quantity: line.units,
          item_subtotal: line.allIn,
          inbound_shipping: 0,
          sales_tax: 0,
          buyer_fees: 0,
          other_cost: 0,
          metadata: {
            ...record(inbox.metadata),
            pdf_order_hash_sha256: line.orderHash,
            pdf_order_line_index: line.lineIndex,
            pdf_order_line_count: line.lineCount,
            all_in_price_authoritative: line.allIn,
            expanded_collectible_quantity: line.units,
            reconciliation_linked_at: new Date().toISOString(),
          },
        })
        .eq("id", inbox.id);
      if (linkError) throw new Error(`Inbox link for ${line.title}: ${linkError.message}`);
      summary.inboxLinked += 1;
    }

    represented.push({
      orderHashPrefix: line.orderHash.slice(0, 12),
      lineIndex: line.lineIndex,
      title: line.title,
      allIn: line.allIn,
      units: line.units,
      purchaseLotId: String(lot.id),
      purchaseNumber: Number(lot.purchase_number),
      action: needsCorrection ? "reused_and_corrected" : summary.created && String(lot.id) === String(lots[lots.length - 1]?.id) ? "created" : "reused",
    });
  }

  const purchaseLotIds = represented.map((item) => item.purchaseLotId);
  if (new Set(purchaseLotIds).size !== EXPECTED_LINE_COUNT) {
    throw new Error(`Final dedupe verification failed: ${new Set(purchaseLotIds).size}/${EXPECTED_LINE_COUNT} unique canonical positions.`);
  }

  const { data: finalLots, error: finalError } = await supabase
    .from("tcos_mi_purchase_lots")
    .select("id,purchase_number,quantity_purchased,total_acquisition_cost,unit_cost_basis,metadata")
    .in("id", purchaseLotIds);
  if (finalError) throw new Error(finalError.message);
  if ((finalLots || []).length !== EXPECTED_LINE_COUNT) throw new Error(`Final canonical lookup returned ${(finalLots || []).length}/${EXPECTED_LINE_COUNT} positions.`);

  const expectedByLotId = new Map(represented.map((item) => [item.purchaseLotId, item]));
  for (const lot of finalLots || []) {
    const expected = expectedByLotId.get(String(lot.id));
    if (!expected) throw new Error(`Unexpected Purchase #${lot.purchase_number} during final verification.`);
    if (roundMoney(lot.total_acquisition_cost) !== expected.allIn) throw new Error(`Purchase #${lot.purchase_number} failed ALL-IN verification.`);
    if (Math.round(Number(lot.quantity_purchased || 0)) !== expected.units) throw new Error(`Purchase #${lot.purchase_number} failed quantity verification.`);
    const expectedUnit = expected.allIn / expected.units;
    if (Math.abs(Number(lot.unit_cost_basis || 0) - expectedUnit) > 0.011) throw new Error(`Purchase #${lot.purchase_number} failed unit-cost verification.`);
  }

  const result = {
    schema: "tcos.ebay-pdf-only-production-reconciliation.v1",
    ok: true,
    generatedAt: new Date().toISOString(),
    pdfOrdersMatched: `${orderHashes.size}/${EXPECTED_ORDER_COUNT}`,
    pdfLineItemsRepresented: `${represented.length}/${EXPECTED_LINE_COUNT}`,
    pdfAllInTotalRepresented: EXPECTED_ALL_IN_TOTAL,
    created: summary.created,
    reused: summary.reused,
    corrected: summary.corrected,
    inboxCreated: summary.inboxCreated,
    inboxLinked: summary.inboxLinked,
    finalCanonicalVerification: `${(finalLots || []).length}/${EXPECTED_LINE_COUNT}`,
    positions: represented,
  };
  await writeFile(RESULT_FILE, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`PDF orders matched: ${orderHashes.size}/${EXPECTED_ORDER_COUNT}`);
  console.log(`PDF line items represented: ${represented.length}/${EXPECTED_LINE_COUNT}`);
  console.log(`PDF ALL-IN total represented: $${EXPECTED_ALL_IN_TOTAL.toFixed(2)}`);
  console.log(`Purchase Ledger positions created: ${summary.created}`);
  console.log(`Existing Purchase Ledger positions reused: ${summary.reused}`);
  console.log(`Existing positions corrected to PDF ALL-IN: ${summary.corrected}`);
  console.log(`Final canonical verification: ${(finalLots || []).length}/${EXPECTED_LINE_COUNT}`);
}

main().catch(async (error) => {
  const failure = { schema: "tcos.ebay-pdf-only-production-reconciliation.v1", ok: false, generatedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
  await writeFile(RESULT_FILE, `${JSON.stringify(failure, null, 2)}\n`, "utf8").catch(() => {});
  console.error(failure.error);
  process.exitCode = 1;
});
