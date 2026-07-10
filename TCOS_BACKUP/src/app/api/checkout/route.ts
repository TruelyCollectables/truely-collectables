import { NextResponse } from "next/server";
import Stripe from "stripe";
import {
  calculateShipping,
  SHIPPING_RULES,
  type ShippingMethod,
} from "../../../lib/shipping";
import {
  InventoryEngine,
  InventoryEngineError,
  InventoryRepository,
} from "../../../modules/inventory";
import {
  TERMS_OF_SERVICE_VERSION,
  hasAcceptedTerms,
} from "../../../lib/legal";
import {
  metadataSafeIdentity,
} from "../../../lib/client-identity";
import { recordTermsAcceptance } from "../../../lib/tos-acceptance";
import { getActiveStoreId } from "../../../lib/stores";
import { getAuthenticatedAccountFromRequest } from "../../../lib/account-auth";
import { trustedRequestOrigin } from "../../../lib/site-origin";
import {
  checkPublicEndpointRateLimit,
  publicEndpointRateLimitPolicies,
  publicEndpointRateLimitResponse,
} from "../../../lib/public-endpoint-rate-limit";
import {
  encodeCartMetadata,
  STRIPE_CART_METADATA_MAX_LENGTH,
} from "../../../lib/checkout-cart-metadata";
import { createSupabaseServerClient } from "../../../lib/supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  attachCheckoutTosEvidence,
  checkoutRequestFingerprint,
  claimCheckoutAttempt,
  completeCheckoutAttempt,
  failCheckoutAttempt,
  isCheckoutAttemptId,
} from "../../../lib/checkout-attempts";
import { getStripePaymentRuntime } from "../../../lib/live-payment-launch";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let checkoutJournal:
    | { supabase: SupabaseClient; rowId: string }
    | null = null;

  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const stripeRuntime = await getStripePaymentRuntime({
      storeId,
      supabase,
    });
    if (!stripeRuntime.allowed || !stripeRuntime.stripeKey) {
      return NextResponse.json(
        { error: stripeRuntime.reason },
        { status: 503 },
      );
    }
    const stripe = new Stripe(stripeRuntime.stripeKey);
    const checkoutInventoryEngine = new InventoryEngine(
      storeId,
      new InventoryRepository(storeId, supabase),
      supabase,
    );

    const body = await request.json();
    const account = await getAuthenticatedAccountFromRequest(request);

    const cart = checkoutInventoryEngine.normalizeCartItems(body.cart);
    const cartMetadata = encodeCartMetadata(cart);
    const shippingMethod = body.shippingMethod as ShippingMethod;
    const tosAccepted = hasAcceptedTerms(body.tosAccepted);
    const tosVersion = String(body.tosVersion || TERMS_OF_SERVICE_VERSION);
    const checkoutAttemptId = String(body.checkoutAttemptId || "");

    if (!isCheckoutAttemptId(checkoutAttemptId)) {
      return NextResponse.json(
        { error: "A valid checkout attempt ID is required", retryable: false },
        { status: 400 },
      );
    }

    if (!tosAccepted) {
      return NextResponse.json(
        { error: "Terms of Service must be accepted before checkout" },
        { status: 400 }
      );
    }

    if (cartMetadata.length > STRIPE_CART_METADATA_MAX_LENGTH) {
      return NextResponse.json(
        {
          error:
            "Cart has too many unique items for checkout. Please split this into smaller orders.",
        },
        { status: 400 },
      );
    }

    const rateLimit = await checkPublicEndpointRateLimit({
      request,
      ...publicEndpointRateLimitPolicies.checkout,
      subjectKey: account?.id || null,
    });

    if (!rateLimit.allowed) {
      const blocked = publicEndpointRateLimitResponse(rateLimit);
      return NextResponse.json(
        blocked.body,
        { status: blocked.status }
      );
    }

    const clientIdentity = rateLimit.identity;

    if (
      shippingMethod !== "GROUND_ADVANTAGE" &&
      shippingMethod !== "PRIORITY_MAIL"
    ) {
      return NextResponse.json(
        { error: "Invalid shipping method" },
        { status: 400 }
      );
    }

    const inventoryItems = await checkoutInventoryEngine.requireAvailableCartItems(cart);

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    let subtotal = 0;
    let itemCount = 0;

    for (const cartItem of cart) {
      const product = inventoryItems.find(
        (item) => item.legacyProductId === cartItem.id
      );

      if (!product) {
        return NextResponse.json(
          { error: `Product ${cartItem.id} not found` },
          { status: 404 }
        );
      }

      const price = Number(product.price);

      subtotal += price * cartItem.quantity;
      itemCount += cartItem.quantity;

      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: product.title,
            images: product.imageUrl ? [product.imageUrl] : [],
          },
          unit_amount: Math.round(price * 100),
        },
        quantity: cartItem.quantity,
      });
    }

    const shippingAmount = calculateShipping({
      itemCount,
      subtotal,
      method: shippingMethod,
    });

    const shippingRule = SHIPPING_RULES[shippingMethod];
    const shippingName = shippingRule.name;

    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: {
          name:
            shippingAmount === 0
              ? `${shippingName} - FREE`
              : shippingName,
        },
        unit_amount: Math.round(shippingAmount * 100),
      },
      quantity: 1,
    });

    const origin = trustedRequestOrigin(request);
    const stripeIdempotencyKey = `tcos_checkout_${storeId}_${checkoutAttemptId}`;
    const baseMetadata = {
      store_id: storeId,
      account_id: account?.id || "",
      checkout_attempt_id: checkoutAttemptId,
      cart: cartMetadata,
      shipping_method: shippingMethod,
      shipping_name: shippingName,
      shipping_amount: shippingAmount.toFixed(2),
      subtotal: subtotal.toFixed(2),
      item_count: String(itemCount),
      tos_accepted: "true",
      tos_version: tosVersion,
    };
    const successUrl = `${origin}/success?type=cart&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/cart`;
    const requestFingerprint = checkoutRequestFingerprint({
      mode: "payment",
      line_items: lineItems,
      shipping_address_collection: { allowed_countries: ["US"] },
      metadata: baseMetadata,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
    const claim = await claimCheckoutAttempt({
      supabase,
      storeId,
      checkoutAttemptId,
      accountId: account?.id || null,
      requestFingerprint,
      stripeIdempotencyKey,
      identityMetadata: metadataSafeIdentity(clientIdentity),
    });

    if (!claim.fingerprintMatches) {
      return NextResponse.json(
        {
          error:
            "This checkout attempt no longer matches the current cart. Start checkout again.",
          retryable: false,
        },
        { status: 409 },
      );
    }

    if (claim.requestStatus === "session_created" && claim.stripeSessionId) {
      const existingSession = await stripe.checkout.sessions.retrieve(
        claim.stripeSessionId,
      );

      if (existingSession.url) {
        return NextResponse.json({
          url: existingSession.url,
          replayed: true,
          checkoutAttemptId,
        });
      }

      return NextResponse.json(
        {
          error: "The previous Checkout Session is no longer available.",
          retryable: false,
        },
        { status: 409 },
      );
    }

    if (!claim.claimed) {
      return NextResponse.json(
        {
          error:
            "This checkout attempt is already being created. Try again in a moment.",
          retryable: true,
          retryAfterSeconds: 2,
        },
        { status: 409, headers: { "Retry-After": "2" } },
      );
    }

    checkoutJournal = { supabase, rowId: claim.rowId };
    let tosAcceptanceEventId = claim.tosAcceptanceEventId;

    if (!tosAcceptanceEventId) {
      const { data: existingAcceptance, error: existingAcceptanceError } =
        await supabase
          .from("tos_acceptance_events")
          .select("id")
          .eq("store_id", storeId)
          .eq("context_type", "checkout")
          .eq("context_id", checkoutAttemptId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();

      if (existingAcceptanceError) throw existingAcceptanceError;

      tosAcceptanceEventId = existingAcceptance?.id
        ? String(existingAcceptance.id)
        : await recordTermsAcceptance(supabase, {
            contextType: "checkout",
            contextId: checkoutAttemptId,
            tosKind: "buyer",
            tosVersion,
            identity: clientIdentity,
            storeId,
          });

      await attachCheckoutTosEvidence({
        supabase,
        rowId: claim.rowId,
        tosAcceptanceEventId,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: checkoutAttemptId,
      line_items: lineItems,
      shipping_address_collection: {
        allowed_countries: ["US"],
      },
      metadata: {
        ...baseMetadata,
        tos_accepted_at: claim.tosAcceptedAt,
        tos_acceptance_event_id: tosAcceptanceEventId,
        ...claim.identityMetadata,
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    }, {
      idempotencyKey: stripeIdempotencyKey,
    });

    if (!session.url) {
      throw new Error("Stripe did not return a hosted Checkout URL");
    }

    await completeCheckoutAttempt({
      supabase,
      rowId: claim.rowId,
      stripeSessionId: session.id,
    });

    return NextResponse.json({
      url: session.url,
      replayed: false,
      checkoutAttemptId,
    });
  } catch (error: any) {
    if (checkoutJournal) {
      try {
        await failCheckoutAttempt({
          ...checkoutJournal,
          error,
        });
      } catch {
        console.error("Checkout attempt failure could not be journaled");
      }
    }

    if (error instanceof InventoryEngineError) {
      return NextResponse.json(
        { error: error.message, retryable: false },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      {
        error: error.message || "Checkout failed",
        retryable: Boolean(checkoutJournal),
      },
      { status: 500 }
    );
  }
}
