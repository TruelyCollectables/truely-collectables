export type AdminOfferDecisionAction = "accepted" | "declined" | "countered";

export type AdminOfferDecisionInput = {
  action: AdminOfferDecisionAction;
  offerStatus?: string | null;
  offerAmount?: number | string | null;
  counterAmount?: number | string | null;
  productPrice?: number | string | null;
  productQuantity?: number | string | null;
};

function normalizedStatus(value: unknown) {
  return String(value || "pending").trim().toLowerCase();
}

export function normalizedOfferMoney(value: unknown) {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return null;

  return Math.round(parsed * 100) / 100;
}

function wholeQuantity(value: unknown) {
  const parsed = Math.floor(Number(value || 0));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function adminOfferDecisionRequirements({
  action,
  offerStatus,
  offerAmount,
  counterAmount,
  productPrice,
  productQuantity,
}: AdminOfferDecisionInput) {
  const missing: string[] = [];
  const status = normalizedStatus(offerStatus);
  const offer = normalizedOfferMoney(offerAmount);
  const counter = normalizedOfferMoney(counterAmount);
  const asking = normalizedOfferMoney(productPrice);
  const quantity = wholeQuantity(productQuantity);

  if (status !== "pending") {
    missing.push("pending offer status");
  }

  if (action === "accepted" || action === "countered") {
    if (quantity < 1) {
      missing.push("available product quantity");
    }

    if (!asking || asking <= 0) {
      missing.push("valid product asking price");
    }
  }

  if (action === "accepted") {
    if (!offer || offer <= 0) {
      missing.push("positive offer amount");
    }
  }

  if (action === "countered") {
    if (!offer || offer <= 0) {
      missing.push("positive original offer amount");
    }

    if (!counter || counter <= 0) {
      missing.push("positive counter amount");
    }

    if (offer && counter && counter <= offer) {
      missing.push("counter above buyer offer");
    }

    if (asking && counter && counter > asking) {
      missing.push("counter at or below asking price");
    }
  }

  return Array.from(new Set(missing));
}

export function canApplyAdminOfferDecision(input: AdminOfferDecisionInput) {
  return adminOfferDecisionRequirements(input).length === 0;
}

export function adminOfferDecisionError(input: AdminOfferDecisionInput) {
  const missing = adminOfferDecisionRequirements(input);

  return missing.length ? `Offer action needs: ${missing.join(", ")}.` : null;
}
