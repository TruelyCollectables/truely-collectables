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
  const checkoutAttemptId = offerCheckoutAttemptId({
    storeId: params.storeId,
    offerId: params.offerId,
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

  if (!claim.fingerprintMatches) {
    throw new ReservedOfferCheckoutError(
      "This accepted offer already has an open payment session with the original shipping and protection choice. Use that session or wait for it to expire before changing the selection.",
      409,
      false,
    );
  }

  if (claim.requestStatus === "session_created" && claim.stripeSessionId) {
    const existing = await params.stripe.checkout.sessions.retrieve(
      claim.stripeSessionId,
    );

    if (existing.url && existing.status === "open") {
      return {
        session: existing,
        checkoutAttemptId,
        reservationExpiresAt: existing.expires_at
          ? new Date(existing.expires_at * 1000).toISOString()
          : null,
        replayed: true,
      };
    }

    throw new ReservedOfferCheckoutError(
      existing.status === "complete"
        ? "This accepted offer payment has already completed and is being finalized."
        : "The previous accepted-offer payment session is no longer available.",
      409,
      false,
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

    if (params.legacyStripeSessionId) {
      try {
        const legacy = await params.stripe.checkout.sessions.retrieve(
          params.legacyStripeSessionId,
        );
        const legacyAttemptId = legacy.metadata?.checkout_attempt_id || null;

        if (legacy.status === "complete") {
          throw new ReservedOfferCheckoutError(
            "This accepted offer payment has already completed and is being finalized.",
            409,
            false,
          );
        }

        if (legacy.status === "open" && legacyAttemptId !== checkoutAttemptId) {
          await params.stripe.checkout.sessions.expire(legacy.id);
        }
      } catch (legacyError) {
        if (legacyError instanceof ReservedOfferCheckoutError) {
          throw legacyError;
        }
        // Missing or already-expired legacy sessions do not block the new
        // reservation-backed session.
      }
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

    if (!session.url) {
      throw new Error("Stripe did not return an accepted-offer Checkout URL.");
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
        console.error("Accepted-offer inventory reservation could not be released");
      }
    }

    try {
      await failCheckoutAttempt({
        supabase: params.supabase,
        rowId: claim.rowId,
        error,
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
