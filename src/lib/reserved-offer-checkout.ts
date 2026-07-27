import type { SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { InventoryEngineError } from "../modules/inventory";
import {
  attachCheckoutTosEvidence,
  checkoutRequestFingerprint,
  claimCheckoutAttempt,
  completeCheckoutAttempt,
  failCheckoutAttempt,
} from "./checkout-attempts";
import {
  attachStripeSessionToCheckoutReservation,
  CHECKOUT_RESERVATION_MINUTES,
  releaseCheckoutReservation,
  releaseCheckoutReservationForExpiredSession,
  reserveCheckoutInventory,
} from "./checkout-inventory-reservations";
import { metadataSafeIdentity, type ClientIdentity } from "./client-identity";
import { offerCheckoutAttemptId } from "./offer-checkout-attempt";

export class ReservedOfferCheckoutError extends Error {
  statusCode: number;
  retryable: boolean;

  constructor(message: string, statusCode = 500, retryable = false) {
    super(message);
    this.name = "ReservedOfferCheckoutError";
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

type OfferCheckoutSessionInput = Omit<
  Stripe.Checkout.SessionCreateParams,
  "client_reference_id" | "expires_at"
>;

function replayResult(
  session: Stripe.Checkout.Session,
  checkoutAttemptId: string,
) {
  if (!session.url || session.status !== "open") {
    throw new ReservedOfferCheckoutError(
      "The accepted-offer payment session is not available.",
      409,
      false,
    );
  }

  return {
    session,
    checkoutAttemptId,
    reservationExpiresAt: session.expires_at
      ? new Date(session.expires_at * 1000).toISOString()
      : null,
    replayed: true,
  };
}

async function retrieveVerifiedOfferSession(params: {
  stripe: Stripe;
  stripeSessionId: string;
  storeId: string;
  offerId: number;
}) {
  let session: Stripe.Checkout.Session;
  try {
    session = await params.stripe.checkout.sessions.retrieve(
      params.stripeSessionId,
    );
  } catch {
    throw new ReservedOfferCheckoutError(
      "The existing accepted-offer payment session could not be verified. Try again shortly.",
      503,
      true,
    );
  }

  const metadata = session.metadata || {};
  if (
    metadata.store_id !== params.storeId ||
    metadata.offer_id !== String(params.offerId) ||
    session.mode !== "payment"
  ) {
    throw new ReservedOfferCheckoutError(
      "The existing accepted-offer payment session does not match this offer.",
      409,
      false,
    );
  }

  return session;
}

async function releaseExpiredSessionReservation(params: {
  supabase: SupabaseClient;
  storeId: string;
  session: Stripe.Checkout.Session;
}) {
  if (params.session.status !== "expired") return;
  await releaseCheckoutReservationForExpiredSession({
    supabase: params.supabase,
    storeId: params.storeId,
    stripeSessionId: params.session.id,
  });
}

export async function startReservedOfferCheckout(params: {
  supabase: SupabaseClient;
  stripe: Stripe;
  storeId: string;
  offerId: number;
  accountId: string | null;
  productId: number;
  identity: ClientIdentity;
  tosAcceptanceEventId: string | null;
  legacyStripeSessionId: string | null;
  sessionInput: OfferCheckoutSessionInput;
}) {
  let previousStripeSessionId: string | null = null;

  if (params.legacyStripeSessionId) {
    const legacy = await retrieveVerifiedOfferSession({
      stripe: params.stripe,
      stripeSessionId: params.legacyStripeSessionId,
      storeId: params.storeId,
      offerId: params.offerId,
    });
    const legacyAttemptId = legacy.metadata?.checkout_attempt_id || null;

    if (legacy.status === "complete") {
      throw new ReservedOfferCheckoutError(
        "This accepted offer payment has already completed and is being finalized.",
        409,
        false,
      );
    }

    if (legacy.status === "open" && legacyAttemptId) {
      return replayResult(legacy, legacyAttemptId);
    }

    if (legacy.status === "open" && !legacyAttemptId) {
      // One-time migration from the old unreserved accepted-offer flow. An
      // unreserved open session must not compete with a new reserved session.
      await params.stripe.checkout.sessions.expire(legacy.id);
    }

    await releaseExpiredSessionReservation({
      supabase: params.supabase,
      storeId: params.storeId,
      session: legacy,
    });
    previousStripeSessionId = legacy.id;
  }

  for (let generation = 0; generation < 5; generation += 1) {
    const checkoutAttemptId = offerCheckoutAttemptId({
      storeId: params.storeId,
      offerId: params.offerId,
      previousStripeSessionId,
    });
    const stripeIdempotencyKey = `truely_offer_checkout_${params.storeId}_${checkoutAttemptId}`;
    const fingerprint = checkoutRequestFingerprint({
      ...params.sessionInput,
      checkout_attempt_id: checkoutAttemptId,
      product_id: params.productId,
    });
    const claim = await claimCheckoutAttempt({
      supabase: params.supabase,
      storeId: params.storeId,
      checkoutAttemptId,
      accountId: params.accountId,
      requestFingerprint: fingerprint,
      stripeIdempotencyKey,
      identityMetadata: metadataSafeIdentity(params.identity),
    });

    if (claim.stripeSessionId) {
      const existing = await retrieveVerifiedOfferSession({
        stripe: params.stripe,
        stripeSessionId: claim.stripeSessionId,
        storeId: params.storeId,
        offerId: params.offerId,
      });

      if (existing.status === "open") {
        return replayResult(existing, checkoutAttemptId);
      }
      if (existing.status === "complete") {
        throw new ReservedOfferCheckoutError(
          "This accepted offer payment has already completed and is being finalized.",
          409,
          false,
        );
      }

      await releaseExpiredSessionReservation({
        supabase: params.supabase,
        storeId: params.storeId,
        session: existing,
      });
      previousStripeSessionId = existing.id;
      continue;
    }

    if (!claim.fingerprintMatches) {
      throw new ReservedOfferCheckoutError(
        "This accepted offer already has a payment attempt with the original shipping and protection choice. Try again shortly.",
        409,
        true,
      );
    }

    if (!claim.claimed) {
      throw new ReservedOfferCheckoutError(
        "This accepted-offer payment session is already being created. Try again in a moment.",
        409,
        true,
      );
    }

    let reservationCreated = false;
    let stripeSessionId: string | null = null;

    try {
      if (!claim.tosAcceptanceEventId && params.tosAcceptanceEventId) {
        await attachCheckoutTosEvidence({
          supabase: params.supabase,
          rowId: claim.rowId,
          tosAcceptanceEventId: params.tosAcceptanceEventId,
        });
      }

      const reservation = await reserveCheckoutInventory({
        supabase: params.supabase,
        storeId: params.storeId,
        checkoutAttemptId,
        cart: [{ id: params.productId, quantity: 1 }],
        ttlMinutes: CHECKOUT_RESERVATION_MINUTES,
      });
      reservationCreated = true;
      const stripeExpiresAt = Math.floor(Date.now() / 1000) + 31 * 60;

      if (stripeExpiresAt >= reservation.expiresAtUnix) {
        throw new Error(
          "The accepted-offer inventory reservation does not safely cover the Stripe payment window.",
        );
      }

      const session = await params.stripe.checkout.sessions.create(
        {
          ...params.sessionInput,
          client_reference_id: checkoutAttemptId,
          expires_at: stripeExpiresAt,
          metadata: {
            ...(params.sessionInput.metadata || {}),
            checkout_attempt_id: checkoutAttemptId,
            inventory_reservation_expires_at: reservation.expiresAt,
            tos_acceptance_event_id:
              params.tosAcceptanceEventId || claim.tosAcceptanceEventId || "",
            ...claim.identityMetadata,
          },
        },
        { idempotencyKey: stripeIdempotencyKey },
      );
      stripeSessionId = session.id;

      if (!session.url || session.status !== "open") {
        throw new Error("Stripe did not return an open accepted-offer Checkout URL.");
      }

      await attachStripeSessionToCheckoutReservation({
        supabase: params.supabase,
        storeId: params.storeId,
        checkoutAttemptId,
        stripeSessionId: session.id,
        expectedCount: reservation.rows.length,
      });
      await completeCheckoutAttempt({
        supabase: params.supabase,
        rowId: claim.rowId,
        stripeSessionId: session.id,
      });

      return {
        session,
        checkoutAttemptId,
        reservationExpiresAt: reservation.expiresAt,
        replayed: false,
      };
    } catch (error) {
      let reservationMayBeReleased = stripeSessionId === null;

      if (stripeSessionId) {
        try {
          const session = await params.stripe.checkout.sessions.retrieve(
            stripeSessionId,
          );
          if (session.status === "open") {
            await params.stripe.checkout.sessions.expire(session.id);
            reservationMayBeReleased = true;
          } else if (session.status === "complete") {
            reservationMayBeReleased = false;
          } else {
            reservationMayBeReleased = true;
          }
        } catch {
          reservationMayBeReleased = false;
        }
      }

      if (reservationCreated && reservationMayBeReleased) {
        try {
          await releaseCheckoutReservation({
            supabase: params.supabase,
            storeId: params.storeId,
            checkoutAttemptId,
          });
        } catch {
          console.error(
            "Accepted-offer inventory reservation could not be released",
          );
        }
      }

      try {
        await failCheckoutAttempt({
          supabase: params.supabase,
          rowId: claim.rowId,
          error,
          stripeSessionId,
        });
      } catch {
        console.error("Accepted-offer checkout failure could not be journaled");
      }

      if (error instanceof InventoryEngineError) throw error;
      if (error instanceof ReservedOfferCheckoutError) throw error;
      throw new ReservedOfferCheckoutError(
        error instanceof Error
          ? error.message
          : "Could not create the accepted-offer payment session.",
        500,
        true,
      );
    }
  }

  throw new ReservedOfferCheckoutError(
    "Too many expired accepted-offer payment generations were encountered. Try again shortly.",
    503,
    true,
  );
}
