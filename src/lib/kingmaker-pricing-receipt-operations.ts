export type PricingReceiptSummaryInput = {
  id: string;
  identityId: string;
  status: "ready" | "review_required" | "insufficient_evidence";
  suggestedListPrice: number | null;
  buyCeiling: number | null;
  estimatedNetProceeds: number | null;
  estimatedProfitAtCeiling: number | null;
  confidence: number;
  soldCompCount: number;
  createdAt: string;
};

function money(value: number) {
  return Math.round(value * 100) / 100;
}

export function summarizePricingReceipts(receipts: PricingReceiptSummaryInput[]) {
  const ready = receipts.filter((row) => row.status === "ready");
  const reviewRequired = receipts.filter((row) => row.status === "review_required");
  const insufficientEvidence = receipts.filter((row) => row.status === "insufficient_evidence");
  const profits = ready.map((row) => row.estimatedProfitAtCeiling).filter((value): value is number => value != null);
  const listPrices = ready.map((row) => row.suggestedListPrice).filter((value): value is number => value != null);
  const buyCeilings = ready.map((row) => row.buyCeiling).filter((value): value is number => value != null);
  const confidence = receipts.map((row) => row.confidence).filter(Number.isFinite);
  const soldComps = receipts.map((row) => row.soldCompCount).filter(Number.isFinite);
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

  return {
    totalDecisions: receipts.length,
    ready: ready.length,
    reviewRequired: reviewRequired.length,
    insufficientEvidence: insufficientEvidence.length,
    readyRate: receipts.length ? Math.round((ready.length / receipts.length) * 1000) / 1000 : 0,
    averageSuggestedListPrice: average(listPrices) == null ? null : money(average(listPrices) as number),
    averageBuyCeiling: average(buyCeilings) == null ? null : money(average(buyCeilings) as number),
    totalEstimatedProfitAtCeiling: money(profits.reduce((sum, value) => sum + value, 0)),
    averageEstimatedProfitAtCeiling: average(profits) == null ? null : money(average(profits) as number),
    averageConfidence: average(confidence) == null ? null : Math.round((average(confidence) as number) * 1000) / 1000,
    averageSoldCompCount: average(soldComps) == null ? null : Math.round((average(soldComps) as number) * 100) / 100,
    boundary: "advisory_only" as const,
  };
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function pricingReceiptsToCsv(receipts: PricingReceiptSummaryInput[]) {
  const header = ["receipt_id","identity_id","status","suggested_list_price","buy_ceiling","estimated_net_proceeds","estimated_profit_at_ceiling","confidence","sold_comp_count","created_at"];
  const rows = receipts.map((row) => [row.id,row.identityId,row.status,row.suggestedListPrice,row.buyCeiling,row.estimatedNetProceeds,row.estimatedProfitAtCeiling,row.confidence,row.soldCompCount,row.createdAt].map(csvCell).join(","));
  return [header.join(","), ...rows].join("\n");
}
