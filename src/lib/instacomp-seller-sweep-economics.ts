export type SellerSweepVerifiedSale = {
  saleId: string;
  price: number;
  shipping: number;
  soldAt: string;
  currency: "USD";
  sourceUrl: string;
  independentlyVerified: true;
  exactIdentityMatch: true;
  finalPriceConfirmed: true;
};

export type SellerSweepValuedCard = {
  candidateId?: string | null;
  player: string | null;
  year: string | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallel: string | null;
  serialNumber?: string | null;
  quantity?: number | null;
  confidence: number;
  reviewRequired?: boolean;
  identityProof?: {
    status?: string | null;
    exactIdentityConfirmed?: boolean | null;
    checklistConfirmed?: boolean | null;
    noConflictingEvidence?: boolean | null;
    source?: string | null;
    checklistIdentityId?: string | null;
    marketIdentityId?: string | null;
    matchedEvidence?: string[] | null;
    pricingEvidenceStatus?: string | null;
  } | null;
  verifiedCompletedSales?: SellerSweepVerifiedSale[] | null;
};

export type SellerSweepEconomicsAssumptions = {
  sellingFeeRate: number;
  paymentFeeFixed: number;
  outboundShipping: number;
  supplies: number;
  quickSaleMultiplier: number;
  targetRoiRate: number;
  minimumTargetProfit: number;
  minimumHardMaxProfit: number;
};

export const DEFAULT_SELLER_SWEEP_ASSUMPTIONS: SellerSweepEconomicsAssumptions = {
  sellingFeeRate: 0.1325,
  paymentFeeFixed: 0.3,
  outboundShipping: 5.25,
  supplies: 0.5,
  quickSaleMultiplier: 0.85,
  targetRoiRate: 0.3,
  minimumTargetProfit: 10,
  minimumHardMaxProfit: 3,
};

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function verifiedSales(card: SellerSweepValuedCard) {
  const seen = new Set<string>();
  return (Array.isArray(card.verifiedCompletedSales) ? card.verifiedCompletedSales : [])
    .filter((sale) => {
      const delivered = money(sale.price);
      const shipping = money(sale.shipping);
      const soldAt = new Date(String(sale.soldAt || ""));
      const valid =
        Boolean(sale.saleId) &&
        !seen.has(sale.saleId) &&
        delivered !== null &&
        shipping !== null &&
        sale.currency === "USD" &&
        sale.independentlyVerified === true &&
        sale.exactIdentityMatch === true &&
        sale.finalPriceConfirmed === true &&
        Boolean(sale.sourceUrl) &&
        !Number.isNaN(soldAt.getTime()) &&
        soldAt.getTime() <= Date.now();
      if (valid) seen.add(sale.saleId);
      return valid;
    })
    .map((sale) => round(Number(sale.price) + Number(sale.shipping)));
}

function identityReady(card: SellerSweepValuedCard) {
  const proof = card.identityProof;
  return (
    card.reviewRequired !== true &&
    card.confidence >= 0.9 &&
    Boolean(card.player) &&
    Boolean(card.year) &&
    Boolean(card.brand || card.setName) &&
    Boolean(card.cardNumber) &&
    Boolean(card.parallel) &&
    proof?.status === "verified_exact" &&
    proof.exactIdentityConfirmed === true &&
    proof.checklistConfirmed === true &&
    proof.noConflictingEvidence === true
  );
}

export function valueSellerSweepCard(card: SellerSweepValuedCard) {
  const sales = verifiedSales(card);
  const reasons = [
    !identityReady(card) ? "exact_identity_not_verified" : null,
    sales.length < 2 ? "fewer_than_two_verified_completed_sales" : null,
  ].filter((reason): reason is string => Boolean(reason));

  if (reasons.length) {
    return {
      status: "review" as const,
      reasons,
      verifiedSaleCount: sales.length,
      retailValue: 0,
      quickSaleValue: 0,
      quantity: Math.max(1, Math.floor(Number(card.quantity) || 1)),
    };
  }

  const quantity = Math.max(1, Math.floor(Number(card.quantity) || 1));
  const retailEach = median(sales);
  return {
    status: "valued" as const,
    reasons: [] as string[],
    verifiedSaleCount: sales.length,
    retailValue: round(retailEach * quantity),
    quickSaleValue: round(
      retailEach * DEFAULT_SELLER_SWEEP_ASSUMPTIONS.quickSaleMultiplier * quantity,
    ),
    quantity,
  };
}

export function calculateSellerSweepLotEconomics(input: {
  cards: SellerSweepValuedCard[];
  itemPrice: number | null;
  inboundShipping: number | null;
  assumptions?: Partial<SellerSweepEconomicsAssumptions>;
}) {
  const assumptions = {
    ...DEFAULT_SELLER_SWEEP_ASSUMPTIONS,
    ...(input.assumptions || {}),
  };
  const cardValues = input.cards.map((card) => ({
    card,
    valuation: valueSellerSweepCard(card),
  }));
  const reviewCards = cardValues.filter((row) => row.valuation.status !== "valued");
  const itemPrice = money(input.itemPrice);
  const inboundShipping = money(input.inboundShipping) ?? 0;
  const retailValue = round(
    cardValues.reduce((sum, row) => sum + row.valuation.retailValue, 0),
  );
  const quickSaleValue = round(
    cardValues.reduce((sum, row) => sum + row.valuation.quickSaleValue, 0),
  );

  if (!input.cards.length || reviewCards.length || itemPrice === null) {
    return {
      status: "review" as const,
      reasons: [
        !input.cards.length ? "no_cards" : null,
        reviewCards.length ? "one_or_more_cards_unverified" : null,
        itemPrice === null ? "listing_price_missing" : null,
      ].filter((reason): reason is string => Boolean(reason)),
      cardValues,
      retailValue: 0,
      quickSaleValue: 0,
      deliveredCost: itemPrice === null ? null : round(itemPrice + inboundShipping),
      sellingCosts: null,
      expectedProfit: null,
      roiPercent: null,
      targetBid: null,
      hardMaxBid: null,
      assumptions,
    };
  }

  const deliveredCost = round(itemPrice + inboundShipping);
  const sellingCosts = round(
    quickSaleValue * assumptions.sellingFeeRate +
      assumptions.paymentFeeFixed +
      assumptions.outboundShipping +
      assumptions.supplies,
  );
  const netResaleProceeds = round(quickSaleValue - sellingCosts);
  const expectedProfit = round(netResaleProceeds - deliveredCost);
  const roiPercent = deliveredCost > 0 ? round((expectedProfit / deliveredCost) * 100) : null;

  const targetDeliveredByRoi =
    (netResaleProceeds - assumptions.minimumTargetProfit) /
    (1 + assumptions.targetRoiRate);
  const targetDelivered = Math.max(
    0,
    Math.min(
      netResaleProceeds - assumptions.minimumTargetProfit,
      targetDeliveredByRoi,
    ),
  );
  const hardMaxDelivered = Math.max(
    0,
    netResaleProceeds - assumptions.minimumHardMaxProfit,
  );

  return {
    status: "ranked" as const,
    reasons: [] as string[],
    cardValues,
    retailValue,
    quickSaleValue,
    deliveredCost,
    sellingCosts,
    netResaleProceeds,
    expectedProfit,
    roiPercent,
    targetBid: round(Math.max(0, targetDelivered - inboundShipping)),
    hardMaxBid: round(Math.max(0, hardMaxDelivered - inboundShipping)),
    assumptions,
  };
}
