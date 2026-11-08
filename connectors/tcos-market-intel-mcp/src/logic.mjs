import { createHash } from "node:crypto";

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const roundPercent = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const safeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizeUrl = (input) => {
  if (!input) return "";
  try {
    const url = new URL(input);
    const removable = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "mkevt",
      "mkcid",
      "mkrid",
      "campid",
      "customid",
      "toolid",
      "ref",
      "referrer",
      "fbclid",
      "gclid",
    ];
    removable.forEach((key) => url.searchParams.delete(key));
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return String(input).trim();
  }
};

export const normalizeText = (input) =>
  String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const identityKey = (identity = {}) => {
  const fields = [
    identity.year,
    identity.manufacturer,
    identity.product,
    identity.set,
    identity.subset,
    identity.player,
    identity.cardNumber,
    identity.parallel,
    identity.variation,
    identity.serialTier,
    identity.serialNumber,
    identity.autograph ? "auto" : "no-auto",
    identity.memorabilia ? "mem" : "no-mem",
    identity.rawOrGraded,
    identity.gradingCompany,
    identity.grade,
  ];
  return normalizeText(fields.filter((value) => value != null && value !== "").join(" | "));
};

export const fingerprintListing = (listing = {}) => {
  const photoHashes = Array.isArray(listing.photoHashes) ? [...listing.photoHashes].sort() : [];
  const parts = [
    normalizeUrl(listing.url),
    normalizeText(listing.source),
    normalizeText(listing.sellerName),
    normalizeText(listing.title),
    normalizeText(listing.location),
    normalizeText(listing.certificationNumber),
    identityKey(listing.identity || {}),
    safeNumber(listing.askingPrice).toFixed(2),
    photoHashes.join(","),
  ];
  return createHash("sha256").update(parts.join("||")).digest("hex");
};

const intersectCount = (a = [], b = []) => {
  const right = new Set(b.filter(Boolean));
  return [...new Set(a.filter(Boolean))].filter((value) => right.has(value)).length;
};

export const compareListingsForDuplicate = (candidate, existing) => {
  const reasons = [];
  let score = 0;
  const candidateUrl = normalizeUrl(candidate.url);
  const existingUrl = normalizeUrl(existing.url);

  if (candidateUrl && existingUrl && candidateUrl === existingUrl) {
    score += 100;
    reasons.push("exact normalized URL match");
  }

  const candidateCert = normalizeText(candidate.certificationNumber);
  const existingCert = normalizeText(existing.certificationNumber);
  if (candidateCert && existingCert && candidateCert === existingCert) {
    score += 80;
    reasons.push("matching certification number");
  }

  const sharedPhotos = intersectCount(candidate.photoHashes, existing.photoHashes);
  if (sharedPhotos > 0) {
    score += Math.min(70, 35 + sharedPhotos * 10);
    reasons.push(`${sharedPhotos} matching photo hash${sharedPhotos === 1 ? "" : "es"}`);
  }

  const candidateIdentity = identityKey(candidate.identity || {});
  const existingIdentity = identityKey(existing.identity || {});
  if (candidateIdentity && existingIdentity && candidateIdentity === existingIdentity) {
    score += 25;
    reasons.push("matching exact-card identity");
  }

  if (
    normalizeText(candidate.sellerName) &&
    normalizeText(candidate.sellerName) === normalizeText(existing.sellerName)
  ) {
    score += 15;
    reasons.push("matching seller");
  }

  if (
    normalizeText(candidate.location) &&
    normalizeText(candidate.location) === normalizeText(existing.location)
  ) {
    score += 5;
    reasons.push("matching public location");
  }

  if (Math.abs(safeNumber(candidate.askingPrice) - safeNumber(existing.askingPrice)) < 0.01) {
    score += 5;
    reasons.push("matching asking price");
  }

  const duplicate = score >= 80 || (score >= 60 && sharedPhotos > 0);
  return { duplicate, score: Math.min(100, score), reasons };
};

export const calculateDeliveredCost = (input = {}) => {
  const askingPrice = safeNumber(input.askingPrice);
  const shipping = safeNumber(input.shipping);
  const tax = safeNumber(input.tax);
  const paymentFees = safeNumber(input.paymentFees);
  const travelCost = safeNumber(input.travelCost);
  const otherAcquisitionCosts = safeNumber(input.otherAcquisitionCosts);
  const total = askingPrice + shipping + tax + paymentFees + travelCost + otherAcquisitionCosts;
  return {
    askingPrice: roundMoney(askingPrice),
    shipping: roundMoney(shipping),
    tax: roundMoney(tax),
    paymentFees: roundMoney(paymentFees),
    travelCost: roundMoney(travelCost),
    otherAcquisitionCosts: roundMoney(otherAcquisitionCosts),
    deliveredCost: roundMoney(total),
  };
};

export const calculateResaleOutcome = (input = {}) => {
  const deliveredCost = safeNumber(input.deliveredCost);
  const resalePrice = safeNumber(input.resalePrice);
  const buyerShipping = safeNumber(input.buyerShipping);
  const buyerSalesTax = safeNumber(input.buyerSalesTax);
  const sellingFeeRate = safeNumber(input.sellingFeeRate, 0.1325);
  const orderFee = safeNumber(input.orderFee, resalePrice + buyerShipping > 10 ? 0.4 : 0.3);
  const paymentProcessingFees = safeNumber(input.paymentProcessingFees);
  const outboundShipping = safeNumber(input.outboundShipping);
  const supplies = safeNumber(input.supplies);
  const gradingAuthentication = safeNumber(input.gradingAuthentication);
  const cleaningPreparation = safeNumber(input.cleaningPreparation);
  const labor = safeNumber(input.labor);
  const returnReserveRate = safeNumber(input.returnReserveRate, 0.02);
  const grossBuyerPayment = resalePrice + buyerShipping;
  const feeBase = grossBuyerPayment + buyerSalesTax;
  const marketplaceFees = feeBase * sellingFeeRate + orderFee;
  const returnReserve = grossBuyerPayment * returnReserveRate;
  const netProceeds =
    grossBuyerPayment -
    marketplaceFees -
    paymentProcessingFees -
    outboundShipping -
    supplies -
    gradingAuthentication -
    cleaningPreparation -
    labor -
    returnReserve;
  const netProfit = netProceeds - deliveredCost;
  const roi = deliveredCost > 0 ? (netProfit / deliveredCost) * 100 : 0;
  const margin = grossBuyerPayment > 0 ? (netProfit / grossBuyerPayment) * 100 : 0;

  return {
    grossBuyerPayment: roundMoney(grossBuyerPayment),
    marketplaceFees: roundMoney(marketplaceFees),
    paymentProcessingFees: roundMoney(paymentProcessingFees),
    outboundShipping: roundMoney(outboundShipping),
    supplies: roundMoney(supplies),
    gradingAuthentication: roundMoney(gradingAuthentication),
    cleaningPreparation: roundMoney(cleaningPreparation),
    labor: roundMoney(labor),
    returnReserve: roundMoney(returnReserve),
    netProceeds: roundMoney(netProceeds),
    deliveredCost: roundMoney(deliveredCost),
    netProfit: roundMoney(netProfit),
    roiPercent: roundPercent(roi),
    marginPercent: roundPercent(margin),
  };
};

export const calculateMaximumOffer = (input = {}) => {
  const targetRoi = safeNumber(input.targetRoi, 0.1);
  const taxRate = safeNumber(input.acquisitionTaxRate);
  const fixedAcquisitionCosts =
    safeNumber(input.shipping) +
    safeNumber(input.paymentFees) +
    safeNumber(input.travelCost) +
    safeNumber(input.otherAcquisitionCosts);

  const resale = calculateResaleOutcome({ ...input, deliveredCost: 0 });
  const maximumDeliveredCost = resale.netProceeds / (1 + targetRoi);
  const maximumOffer = Math.max(0, (maximumDeliveredCost - fixedAcquisitionCosts) / (1 + taxRate));
  const openingOffer = maximumOffer * 0.8;
  const targetOffer = maximumOffer * 0.92;

  return {
    targetRoiPercent: roundPercent(targetRoi * 100),
    netProceedsBeforeAcquisition: roundMoney(resale.netProceeds),
    maximumDeliveredCost: roundMoney(maximumDeliveredCost),
    openingOffer: roundMoney(openingOffer),
    targetOffer: roundMoney(targetOffer),
    maximumOffer: roundMoney(maximumOffer),
  };
};

const average = (numbers) =>
  numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null;

const median = (numbers) => {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const windowAverage = (sales, now, daysBackStart, daysBackEnd) => {
  const start = new Date(now.getTime() - daysBackEnd * 86_400_000);
  const end = new Date(now.getTime() - daysBackStart * 86_400_000);
  const prices = sales
    .filter((sale) => {
      const date = new Date(sale.soldAt);
      return Number.isFinite(date.getTime()) && date > start && date <= end;
    })
    .map((sale) => safeNumber(sale.totalPrice ?? sale.soldPrice));
  return average(prices);
};

const trendForWindow = (sales, days, now) => {
  const current = windowAverage(sales, now, 0, days);
  const previous = windowAverage(sales, now, days, days * 2);
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
};

export const computeCompStats = (rawSales = [], options = {}) => {
  const sales = rawSales
    .map((sale) => ({
      ...sale,
      soldPrice: safeNumber(sale.soldPrice),
      shipping: safeNumber(sale.shipping),
      totalPrice: safeNumber(sale.totalPrice, safeNumber(sale.soldPrice) + safeNumber(sale.shipping)),
      soldAt: sale.soldAt,
    }))
    .filter((sale) => sale.totalPrice > 0 && Number.isFinite(new Date(sale.soldAt).getTime()))
    .sort((a, b) => new Date(b.soldAt).getTime() - new Date(a.soldAt).getTime());

  const prices = sales.map((sale) => sale.totalPrice);
  const now = options.now ? new Date(options.now) : new Date();
  const oldest = sales.at(-1)?.soldAt ? new Date(sales.at(-1).soldAt) : now;
  const spanDays = Math.max(1, (now.getTime() - oldest.getTime()) / 86_400_000);
  const salesPer30Days = (sales.length / spanDays) * 30;
  const confidence = sales.length >= 8 ? "high" : sales.length >= 3 ? "medium" : sales.length >= 1 ? "low" : "insufficient";

  return {
    exactSoldCount: sales.length,
    average: average(prices) == null ? null : roundMoney(average(prices)),
    median: median(prices) == null ? null : roundMoney(median(prices)),
    low: prices.length ? roundMoney(Math.min(...prices)) : null,
    high: prices.length ? roundMoney(Math.max(...prices)) : null,
    latest: sales[0]
      ? {
          soldAt: sales[0].soldAt,
          totalPrice: roundMoney(sales[0].totalPrice),
          source: sales[0].source || null,
          url: sales[0].url || null,
        }
      : null,
    trend7DayPercent: trendForWindow(sales, 7, now) == null ? null : roundPercent(trendForWindow(sales, 7, now)),
    trend30DayPercent: trendForWindow(sales, 30, now) == null ? null : roundPercent(trendForWindow(sales, 30, now)),
    trend90DayPercent: trendForWindow(sales, 90, now) == null ? null : roundPercent(trendForWindow(sales, 90, now)),
    salesPer30Days: roundPercent(salesPer30Days),
    confidence,
    sales,
  };
};

export const evaluateSellerRisk = (input = {}) => {
  const signals = [];
  let score = 0;
  const add = (weight, code, detail) => {
    score += weight;
    signals.push({ code, weight, detail });
  };

  if (input.accountAgeDays != null && safeNumber(input.accountAgeDays) < 30) {
    add(18, "new_account", "Seller account appears less than 30 days old");
  }
  if (input.hobbyHistory === false) add(8, "no_hobby_history", "No visible hobby history");
  if (input.referencesAvailable === false) add(8, "no_references", "No seller references available");
  if (input.timestampedPhotoRefused) add(22, "timestamp_refused", "Seller refused timestamped front/back photos");
  if (input.copiedPhotosSuspected) add(30, "copied_photos", "Photos may be copied from another listing");
  if (input.certificationMismatch) add(40, "cert_mismatch", "Certification number does not match the card");
  if (input.inconsistentPhotos) add(15, "inconsistent_photos", "Photo backgrounds or quality are inconsistent");
  if (input.paymentNameMismatch) add(20, "payment_name_mismatch", "Seller name differs from payment recipient");
  if (input.pressureToPay) add(12, "payment_pressure", "Seller is applying unusual payment pressure");
  if (input.locationChanged) add(15, "location_change", "Seller location changed during communication");
  if (input.trackingRefused) add(18, "tracking_refused", "Seller refused tracked shipping");
  if (input.priceDiscountPercent != null && safeNumber(input.priceDiscountPercent) >= 60) {
    add(12, "extreme_discount", "Price is dramatically below verified market without explanation");
  }

  const method = normalizeText(input.paymentMethod);
  if (/(gift card|crypto|cryptocurrency|wire|western union)/.test(method)) {
    add(45, "unsafe_payment", "Seller requested a high-risk payment method");
  }
  if (/(friends family|friends and family|zelle|cash app|venmo friends)/.test(method)) {
    add(28, "unprotected_payment", "Payment method may provide little or no buyer protection");
  }

  score = Math.min(100, score);
  const sellerRisk = score >= 65 ? "high" : score >= 30 ? "medium" : "low";
  const status = score >= 65 ? "HIGH-RISK / POSSIBLE SCAM" : score >= 30 ? "MANUAL REVIEW REQUIRED" : "eligible for normal deal review";
  return { score, sellerRisk, status, signals };
};

export const classifyDeal = (input = {}) => {
  const identityConfirmed = input.identityConfirmed !== false;
  const manualReviewRequired = Boolean(input.manualReviewRequired);
  const sellerRisk = input.sellerRisk || "low";
  const netProfit = safeNumber(input.netProfit);
  const roiPercent = safeNumber(input.roiPercent);
  const minimumNetProfit = safeNumber(input.minimumNetProfit, input.isLot ? 25 : 15);
  const minimumRoiPercent = safeNumber(input.minimumRoiPercent, 10);

  if (sellerRisk === "high") return "HIGH-RISK / POSSIBLE SCAM";
  if (!identityConfirmed || manualReviewRequired) return "MANUAL REVIEW REQUIRED";
  if (netProfit >= minimumNetProfit && roiPercent >= minimumRoiPercent) return "STRONG BUY";
  if (safeNumber(input.profitAtMaximumOffer) >= minimumNetProfit && safeNumber(input.roiAtMaximumOffer) >= minimumRoiPercent) {
    return "BUY IF NEGOTIATED";
  }
  if (input.futurePerformanceDependent || input.gradingUpsideDependent) return "SPECULATIVE";
  return "PASS";
};

export const compactListing = (listing) => ({
  id: listing.id,
  source: listing.source,
  url: listing.url,
  discoveredAt: listing.discoveredAt,
  sellerName: listing.sellerName,
  location: listing.location,
  title: listing.title,
  askingPrice: listing.askingPrice,
  shipping: listing.shipping,
  buyerFees: listing.buyerFees,
  identity: listing.identity,
  status: listing.status,
  manualReviewRequired: listing.manualReviewRequired,
  sellerRisk: listing.sellerRisk,
});

export { roundMoney, roundPercent };
