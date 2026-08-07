import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const INPUT_FILE = "ebay-purchase-reconcile-result.json";
const OUTPUT_FILE = "ebay-purchase-all-in-enforcement-result.json";
const EXPECTED_PDF_TOTAL = 528.52;
const EXPECTED_ORDER_COUNT = 25;

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function main() {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Production Supabase credentials are not loaded into the process environment.");
  }

  const receipt = JSON.parse(await readFile(INPUT_FILE, "utf8"));
  if (Number(receipt.expectedPdfOrders) !== EXPECTED_ORDER_COUNT) {
    throw new Error(`Expected ${EXPECTED_ORDER_COUNT} reconciled PDF orders.`);
  }
  if (roundMoney(receipt.expectedPdfAllInTotal) !== EXPECTED_PDF_TOTAL) {
    throw new Error(`Expected PDF ALL-IN total $${EXPECTED_PDF_TOTAL.toFixed(2)}.`);
  }
  if (Number(receipt.matchedEbayOrders) !== EXPECTED_ORDER_COUNT) {
    throw new Error("All PDF orders must be re-verified against the connected eBay buyer account before ledger correction.");
  }

  const items = Array.isArray(receipt.items) ? receipt.items : [];
  if (!items.length) throw new Error("Reconciliation receipt contains no purchase lines.");

  const byPurchaseNumber = new Map();
  for (const item of items) {
    const purchaseNumber = Number(item.purchaseNumber || 0);
    const allIn = roundMoney(item.allIn);
    const units = Math.max(1, Math.round(Number(item.units || 1)));
    if (!Number.isInteger(purchaseNumber) || purchaseNumber <= 0) {
      throw new Error(`Purchase line ${item.itemId || "unknown"} is missing a canonical Purchase Ledger number.`);
    }
    const existing = byPurchaseNumber.get(purchaseNumber);
    if (existing && (existing.itemId !== item.itemId || existing.allIn !== allIn || existing.units !== units)) {
      throw new Error(`Purchase #${purchaseNumber} was matched to more than one incompatible eBay line; refusing to alter money truth.`);
    }
    byPurchaseNumber.set(purchaseNumber, {
      purchaseNumber,
      itemId: String(item.itemId || ""),
      title: String(item.title || ""),
      allIn,
      units,
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const purchaseNumbers = [...byPurchaseNumber.keys()];
  const { data: lots, error: readError } = await supabase
    .from("tcos_mi_purchase_lots")
    .select("id,purchase_number,quantity_purchased,item_subtotal,inbound_shipping,buyer_fees,sales_tax,other_acquisition_cost,total_acquisition_cost,unit_cost_basis,notes,metadata")
    .in("purchase_number", purchaseNumbers);
  if (readError) throw new Error(readError.message);
  if ((lots || []).length !== purchaseNumbers.length) {
    throw new Error(`Canonical ledger lookup returned ${(lots || []).length}/${purchaseNumbers.length} reconciled positions.`);
  }

  const result = {
    schema: "tcos.ebay-pdf-all-in-ledger-enforcement.v1",
    generatedAt: new Date().toISOString(),
    expectedPdfOrders: EXPECTED_ORDER_COUNT,
    expectedPdfAllInTotal: EXPECTED_PDF_TOTAL,
    canonicalPositionsChecked: purchaseNumbers.length,
    correctedPositions: 0,
    alreadyCorrectPositions: 0,
    costDeltaApplied: 0,
    positions: [],
  };

  for (const lot of lots || []) {
    const expected = byPurchaseNumber.get(Number(lot.purchase_number));
    if (!expected) throw new Error(`Unexpected Purchase #${lot.purchase_number} returned from canonical ledger.`);

    const currentAllIn = roundMoney(lot.total_acquisition_cost);
    const currentUnits = Math.max(0, Math.round(Number(lot.quantity_purchased || 0)));
    const needsCorrection = currentAllIn !== expected.allIn || currentUnits !== expected.units;

    if (needsCorrection) {
      const metadata = {
        ...record(lot.metadata),
        actual_item_subtotal: expected.allIn,
        actual_inbound_shipping: 0,
        actual_sales_tax: 0,
        actual_buyer_fees: 0,
        actual_other_cost: 0,
        actual_out_the_door_cost: expected.allIn,
        all_in_price_source: "uploaded_ebay_purchase_history_pdf",
        all_in_reconciled: true,
        all_in_reconciled_at: new Date().toISOString(),
        ebay_item_id: expected.itemId || record(lot.metadata).ebay_item_id || null,
        expanded_collectible_quantity: expected.units,
      };
      const reconciliationNote = `ALL-IN eBay cost reconciled from uploaded Purchase History: $${expected.allIn.toFixed(2)} for ${expected.units} tracked unit${expected.units === 1 ? "" : "s"}.`;
      const priorNotes = String(lot.notes || "").trim();
      const notes = priorNotes.includes(reconciliationNote)
        ? priorNotes
        : [priorNotes, reconciliationNote].filter(Boolean).join("\n");

      const { error: updateError } = await supabase
        .from("tcos_mi_purchase_lots")
        .update({
          quantity_purchased: expected.units,
          item_subtotal: expected.allIn,
          inbound_shipping: 0,
          buyer_fees: 0,
          sales_tax: 0,
          other_acquisition_cost: 0,
          notes,
          metadata,
        })
        .eq("id", lot.id)
        .eq("purchase_number", expected.purchaseNumber);
      if (updateError) throw new Error(`Purchase #${expected.purchaseNumber}: ${updateError.message}`);

      result.correctedPositions += 1;
      result.costDeltaApplied = roundMoney(result.costDeltaApplied + expected.allIn - currentAllIn);
    } else {
      result.alreadyCorrectPositions += 1;
    }

    result.positions.push({
      purchaseNumber: expected.purchaseNumber,
      itemId: expected.itemId,
      title: expected.title,
      allIn: expected.allIn,
      units: expected.units,
      priorAllIn: currentAllIn,
      priorUnits: currentUnits,
      action: needsCorrection ? "corrected_to_pdf_all_in" : "already_correct",
    });
  }

  const { data: verifiedLots, error: verifyError } = await supabase
    .from("tcos_mi_purchase_lots")
    .select("purchase_number,quantity_purchased,total_acquisition_cost,unit_cost_basis")
    .in("purchase_number", purchaseNumbers);
  if (verifyError) throw new Error(verifyError.message);

  for (const lot of verifiedLots || []) {
    const expected = byPurchaseNumber.get(Number(lot.purchase_number));
    if (!expected) throw new Error(`Unexpected Purchase #${lot.purchase_number} during verification.`);
    if (roundMoney(lot.total_acquisition_cost) !== expected.allIn) {
      throw new Error(`Purchase #${lot.purchase_number} failed ALL-IN verification.`);
    }
    if (Math.round(Number(lot.quantity_purchased || 0)) !== expected.units) {
      throw new Error(`Purchase #${lot.purchase_number} failed quantity verification.`);
    }
    const expectedUnit = expected.units > 0 ? expected.allIn / expected.units : 0;
    if (Math.abs(Number(lot.unit_cost_basis || 0) - expectedUnit) > 0.011) {
      throw new Error(`Purchase #${lot.purchase_number} failed unit-cost verification.`);
    }
  }

  result.verifiedPositions = (verifiedLots || []).length;
  result.ok = result.verifiedPositions === purchaseNumbers.length;
  if (!result.ok) throw new Error("Not every reconciled Purchase Ledger position passed final verification.");

  await writeFile(OUTPUT_FILE, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(`ALL-IN positions checked: ${result.canonicalPositionsChecked}`);
  console.log(`Existing positions corrected: ${result.correctedPositions}`);
  console.log(`Already correct: ${result.alreadyCorrectPositions}`);
  console.log(`Net canonical cost correction: $${result.costDeltaApplied.toFixed(2)}`);
  console.log(`Final canonical verification: ${result.verifiedPositions}/${result.canonicalPositionsChecked}`);
}

main().catch(async (error) => {
  const failure = {
    schema: "tcos.ebay-pdf-all-in-ledger-enforcement.v1",
    generatedAt: new Date().toISOString(),
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  };
  await writeFile(OUTPUT_FILE, `${JSON.stringify(failure, null, 2)}\n`, "utf8").catch(() => {});
  console.error(failure.error);
  process.exitCode = 1;
});
