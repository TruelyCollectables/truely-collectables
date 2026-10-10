import { fetchEbayBuyerOrdersSince } from "../../../src/lib/ebay-buyer-orders";
import { fetchEbayPurchaseListingSnapshot } from "../../../src/lib/market-intel-ebay-purchase-inbox";

const cutoff = process.argv[2] || "2026-09-16T00:00:00-06:00";

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function explicitBase(title: string) {
  return /\b(?:base|base card|base rookie)\b/i.test(title);
}

function sourceIdentityStatus(fields: Record<string, any>, title: string) {
  const parallel = text(fields.parallel) || (explicitBase(title) ? "Base" : "");
  const complete = Boolean(
    text(fields.player) &&
      text(fields.year) &&
      text(fields.brand || fields.manufacturer) &&
      text(fields.setName || fields.productLine) &&
      text(fields.cardNumber) &&
      parallel,
  );
  const multiCard = /\b(?:lot|bundle|set of|pair|2x|3x|4x|\d+\s*(?:card|cards|rcs|rookies))\b/i.test(
    title,
  );
  return complete && !multiCard ? "source_exact" : "needs_scan_verification";
}

async function main() {
  const orders = await fetchEbayBuyerOrdersSince(cutoff);
  const records: Record<string, unknown>[] = [];
  const errors: Array<{ orderId: string; itemId: string; error: string }> = [];

  for (const order of orders) {
    for (const line of order.lines) {
      let snapshot: Awaited<ReturnType<typeof fetchEbayPurchaseListingSnapshot>> | null = null;
      try {
        snapshot = await fetchEbayPurchaseListingSnapshot(line.itemId);
      } catch (error) {
        errors.push({
          orderId: order.orderId,
          itemId: line.itemId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      const title = snapshot?.title || line.title;
      const fields = (snapshot?.fields || {}) as Record<string, any>;
      const parallel = text(fields.parallel) || (explicitBase(title) ? "Base" : null);
      const quantity = Math.max(1, Math.round(Number(line.quantity || 1)));
      const perCopyCost = roundMoney(Number(line.totalPaid || 0) / quantity);
      if (perCopyCost <= 0) continue;

      for (let unitIndex = 1; unitIndex <= quantity; unitIndex += 1) {
        const lineKey = text(line.orderLineItemId) || text(line.transactionId) || line.itemId;
        records.push({
          purchase_id: order.orderId,
          source_key: `ebay:${order.orderId}:${lineKey}:unit:${unitIndex}`,
          source: "eBay",
          purchased_at: order.purchaseDate,
          title,
          seller: null,
          order_number: order.orderId,
          source_item_id: line.itemId,
          listing_url: snapshot?.directUrl || `https://www.ebay.com/itm/${line.itemId}`,
          image_urls: snapshot?.imageUrls || [],
          allocated_cost: perCopyCost,
          status: "awaiting_scan",
          identity_status: sourceIdentityStatus(fields, title),
          identity: {
            player: fields.player || null,
            year: fields.year || null,
            manufacturer: fields.manufacturer || null,
            brand: fields.brand || fields.manufacturer || null,
            setName: fields.setName || fields.productLine || null,
            cardNumber: fields.cardNumber || null,
            parallel,
            variation: fields.variation || null,
            serialRun: fields.serialTo || null,
            isAuto: fields.autographed === true,
            isRelic: fields.memorabilia === true,
            conditionType: fields.conditionType || "raw",
            gradingCompany: fields.grader || null,
            grade: fields.grade || null,
          },
          evidence: {
            source: "connected_ebay_buyer_order",
            currency: order.currency,
            order_status: order.orderStatus,
            payment_status: order.paymentStatus,
            order_line_item_id: line.orderLineItemId,
            transaction_id: line.transactionId,
            item_subtotal: roundMoney(Number(line.itemSubtotal || 0) / quantity),
            inbound_shipping: roundMoney(Number(line.inboundShipping || 0) / quantity),
            sales_tax: roundMoney(Number(line.salesTax || 0) / quantity),
            buyer_fees: roundMoney(Number(line.buyerFees || 0) / quantity),
            other_cost: roundMoney(Number(line.otherCost || 0) / quantity),
            unit_index: unitIndex,
            quantity,
          },
        });
      }
    }
  }

  process.stdout.write(
    JSON.stringify({
      ok: true,
      source: "eBay",
      cutoff,
      orderCount: orders.length,
      recordCount: records.length,
      records,
      errors,
    }),
  );
}

main().catch((error) => {
  process.stdout.write(
    JSON.stringify({ ok: false, source: "eBay", error: error instanceof Error ? error.message : String(error) }),
  );
  process.exitCode = 1;
});
