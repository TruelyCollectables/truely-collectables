import { createHash } from "node:crypto";

export function offerCheckoutAttemptId(params: {
  storeId: string;
  offerId: number;
  previousStripeSessionId?: string | null;
}) {
  const generation = String(params.previousStripeSessionId || "initial").trim();
  const digest = createHash("sha256")
    .update(
      `truely-offer-checkout\n${params.storeId}\n${params.offerId}\n${generation}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 32)
    .split("");

  digest[12] = "4";
  digest[16] = "8";

  const value = digest.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
