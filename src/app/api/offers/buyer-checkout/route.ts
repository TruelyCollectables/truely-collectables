import { NextResponse } from "next/server";
import Stripe from "stripe";
import { getAuthenticatedAccountFromRequest } from "../../../../lib/account-auth";
import {
  BUYER_PROTECTION_FEE,
  BUYER_PROTECTION_POLICY_VERSION,
  getBuyerProtectionEligibility,
} from "../../../../lib/buyer-protection";
import {
  isCurrentAlwaysOnPreference,
  getBuyerProtectionPreference,
} from "../../../../lib/buyer-protection-server";
import { parseOfferCheckoutToken } from "../../../../lib/offer-checkout-token";
import {
  calculateShipping,
  isShippingMethod,
  resolveShippingMethod,
  SHIPPING_RULES,
  type ShippingMethod,
} from "../../../../lib/shipping";
import { getStripePaymentRuntime } from "../../../../lib/live-payment-launch";
import {
  checkPublicEndpointRateLimit,
  publicEndpointRateLimitPolicies,
  publicEndpointRateLimitResponse,
} from "../../../../lib/public-endpoint-rate-limit";
import {
  ReservedOfferCheckoutError,
  startReservedOfferCheckout,
} from "../../../../lib/reserved-offer-checkout";
import { trustedRequestOrigin } from "../../../../lib/site-origin";
import { getActiveStoreId } from "../../../../lib/stores";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { createServerInventoryEngine } from "../../../../lib/server-inventory-engine";
import { InventoryEngineError } from "../../../../modules/inventory";

export const dynamic = "force-dynamic";

function money(value: unknown) {
  const amount = Number(value || 0);
  return Math.round(amount * 100) / 100;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const offerId = Number(body.offerId);
    const token = String(body.token || "");
    const requestedShippingMethod = body.shippingMethod as ShippingMethod;

    if (!Number.isInteger(offerId) || offerId <= 0 || !token) {
      return NextResponse.json(
        { error: "A valid offer checkout link is required" },
        { status: 400 },
      );
    }
    if (!isShippingMethod(requestedShippingMethod)) {
      return NextResponse.json(
        { error: "A valid shipping method is required" },
        { status: 400 },
      );
    }

    const storeId = getActiveStoreId();
    try {
      parseOfferCheckoutToken({ token, storeId, offerId });
    } catch (tokenError: any) {
      return NextResponse.json(
        { error: tokenError.message || "Offer checkout link is invalid" },
        { status: 403 },
      );
    }

    const account = await getAuthenticatedAccountFromRequest(request);
    const rateLimit = await checkPublicEndpointRateLimit({
      request,
      ...publicEndpointRateLimitPolicies.checkout,
      subjectKey: account?.id || `offer:${offerId}`,
    });
    if (!rateLimit.allowed) {
      const blocked = publicEndpointRateLimitResponse(rateLimit);
      return NextResponse.json(blocked.body, { status: blocked.status });
    }

    const identity = rateLimit.identity;
    const supabase = createSupabaseServerClient({ admin: true });
    const { data: offer, error: offerError } = await supabase
      .from("offers")
      .select(
        "*, products(id,title,image_url,price,quantity,ebay_item_id)",
      )
      .eq("id", offerId)
      .eq("store_id", storeId)
      .single();

    if (offerError || !offer?.products) {
      return NextResponse.json({ error: "Offer not found" }, { status: 404 });
    }
    if (!["accepted", "countered"].includes(offer.status)) {
      return NextResponse.json(
        {
          error:
            offer.status === "paid"
              ? "This offer has already been paid"
              : "This offer is not ready for payment",
        },
        { status: 409 },
      );
    }

    const saleSubtotal = money(
      offer.status === "countered"
        ? offer.counter_amount
        : offer.offer_amount,
    );
    if (saleSubtotal <= 0) {
      return NextResponse.json(
        { error: "Offer payment amount is invalid" },
        { status: 409 },
      );
    }

    const listingPriceBasis = money(
      offer.listing_price_at_offer ?? offer.products.price,
    );
    const resolvedShipping = resolveShippingMethod({
      requestedMethod: requestedShippingMethod,
      itemCount: 1,
      subtotal: saleSubtotal,
      listingPriceBasis,
    });
    if (resolvedShipping.method !== requestedShippingMethod) {
      return NextResponse.json(
        {
          error:
            resolvedShipping.reason ||
            "The selected shipping method is below the required minimum",
          requiredShippingMethod: resolvedShipping.method,
        },
        { status: 409 },
      );
    }

    const shippingAmount = calculateShipping({
      itemCount: 1,
      subtotal: saleSubtotal,
      listingPriceBasis,
      method: resolvedShipping.method,
    });
    const protectionRequested = body.buyerProtectionSelected === true;
    const protectionEligibility = getBuyerProtectionEligibility({
      shippingMethod: resolvedShipping.method,
      itemSubtotal: saleSubtotal,
      itemCount: 1,
    });
    const existingProtectionConsent = Boolean(
      offer.buyer_protection_selected === true &&
        offer.buyer_protection_policy_version ===
          BUYER_PROTECTION_POLICY_VERSION &&
        offer.buyer_protection_terms_accepted_at,
    );

    let buyerProtectionSelected = false;
    let protectionTermsAcceptedAt: string | null = null;
    let protectionConsentSource: string | null = null;
    let protectionPreferenceMode: "always_on" | "one_time" | null = null;

    if (protectionRequested) {
      if (!protectionEligibility.eligible) {
        return NextResponse.json(
          { error: protectionEligibility.reason },
          { status: 409 },
        );
      }

      if (existingProtectionConsent) {
        buyerProtectionSelected = true;
        protectionTermsAcceptedAt =
          offer.buyer_protection_terms_accepted_at;
        protectionConsentSource =
          offer.buyer_protection_consent_source ||
          "offer_submission_consent";
        protectionPreferenceMode =
          offer.buyer_protection_preference_mode === "always_on"
            ? "always_on"
            : "one_time";
      } else {
        const savedPreference = account?.id
          ? await getBuyerProtectionPreference({
              supabase,
              storeId,
              accountId: account.id,
            })
          : null;
        const savedAlwaysOn = isCurrentAlwaysOnPreference(savedPreference);

        if (savedAlwaysOn) {
          buyerProtectionSelected = true;
          protectionTermsAcceptedAt = savedPreference!.terms_accepted_at;
          protectionConsentSource = "account_saved_current_policy";
          protectionPreferenceMode = "always_on";
        } else {
          if (
            body.buyerProtectionPolicyVersion !==
              BUYER_PROTECTION_POLICY_VERSION ||
            body.buyerProtectionTermsAccepted !== true
          ) {
            return NextResponse.json(
              {
                error:
                  "The current Buyer Protection terms must be accepted before protection is added",
              },
              { status: 400 },
            );
          }
          buyerProtectionSelected = true;
          protectionTermsAcceptedAt = new Date().toISOString();
          protectionConsentSource = "offer_checkout_one_time_consent";
          protectionPreferenceMode = "one_time";
        }
      }
    }

    const inventoryEngine = createServerInventoryEngine();
    await inventoryEngine.requireAvailableCartItems([
      { id: Number(offer.products.id), quantity: 1 },
    ]);

    const stripeRuntime = await getStripePaymentRuntime({ storeId, supabase });
    if (!stripeRuntime.allowed || !stripeRuntime.stripeKey) {
      return NextResponse.json(
        { error: stripeRuntime.reason },
        { status: 503 },
      );
    }
    const stripe = new Stripe(stripeRuntime.stripeKey);

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: offer.products.title,
            images: offer.products.image_url
              ? [offer.products.image_url]
              : [],
          },
          unit_amount: Math.round(saleSubtotal * 100),
        },
        quantity: 1,
      },
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: SHIPPING_RULES[resolvedShipping.method].name,
            metadata: { tcos_line_type: "shipping" },
          },
          unit_amount: Math.round(shippingAmount * 100),
        },
        quantity: 1,
      },
    ];

    if (buyerProtectionSelected) {
      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: "Truely Collectables Buyer Protection",
            description:
              "Optional item-subtotal reimbursement program, up to $20; shipping and fee excluded.",
            metadata: {
              tcos_line_type: "buyer_protection",
              policy_version: BUYER_PROTECTION_POLICY_VERSION,
            },
          },
          unit_amount: Math.round(BUYER_PROTECTION_FEE * 100),
        },
        quantity: 1,
      });
    }

    const origin = trustedRequestOrigin(request);
    const sessionInput: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: offer.customer_email,
      shipping_address_collection: { allowed_countries: ["US"] },
      line_items: lineItems,
      metadata: {
        store_id: storeId,
        account_id: offer.account_id || account?.id || "",
        type: "accepted_offer",
        offer_id: String(offer.id),
        product_id: String(offer.products.id),
        ebay_item_id: offer.products.ebay_item_id || "",
        offer_amount: saleSubtotal.toFixed(2),
        cart: JSON.stringify([
          { id: Number(offer.products.id), quantity: 1 },
        ]),
        subtotal: saleSubtotal.toFixed(2),
        item_count: "1",
        shipping_selection_mode: "site_offer_choice",
        requested_shipping_method: requestedShippingMethod,
        shipping_method: resolvedShipping.method,
        shipping_name: SHIPPING_RULES[resolvedShipping.method].name,
        shipping_amount: shippingAmount.toFixed(2),
        shipping_eligibility_basis_type:
          "product_listing_price_at_offer_decision",
        shipping_eligibility_basis_price: listingPriceBasis.toFixed(2),
        listing_price_basis: listingPriceBasis.toFixed(2),
        standard_envelope_eligible:
          resolvedShipping.standardEnvelope.eligible ? "true" : "false",
        standard_envelope_estimated_oz: String(
          resolvedShipping.standardEnvelope.estimatedOunces,
        ),
        buyer_protection_selected: buyerProtectionSelected ? "true" : "false",
        buyer_protection_fee: buyerProtectionSelected
          ? BUYER_PROTECTION_FEE.toFixed(2)
          : "0.00",
        buyer_protection_covered_amount: buyerProtectionSelected
          ? protectionEligibility.coveredAmount.toFixed(2)
          : "0.00",
        buyer_protection_policy_version: buyerProtectionSelected
          ? BUYER_PROTECTION_POLICY_VERSION
          : "",
        buyer_protection_terms_accepted_at:
          protectionTermsAcceptedAt || "",
        buyer_protection_consent_source:
          protectionConsentSource || "",
        buyer_protection_preference_mode:
          protectionPreferenceMode || "one_time",
        buyer_protection_consent_ip_address:
          identity.ipAddress || offer.tos_ip_address || "",
        buyer_protection_consent_user_agent:
          identity.userAgent || offer.tos_user_agent || "",
        buyer_protection_consent_ip_risk:
          identity.risk || offer.tos_ip_risk || "",
        buyer_protection_consent_ip_block_reason:
          identity.blockReason || offer.tos_ip_block_reason || "",
        tos_accepted: offer.tos_accepted ? "true" : "false",
        tos_version: offer.tos_version || "",
        tos_accepted_at: offer.tos_accepted_at || "",
        tos_ip_address: offer.tos_ip_address || "",
        tos_user_agent: offer.tos_user_agent || "",
        tos_ip_risk: offer.tos_ip_risk || "",
        tos_ip_block_reason: offer.tos_ip_block_reason || "",
      },
      success_url: `${origin}/success?type=offer&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/offer-checkout/${offer.id}?token=${encodeURIComponent(token)}`,
    };

    const reservedCheckout = await startReservedOfferCheckout({
      supabase,
      stripe,
      storeId,
      offerId: Number(offer.id),
      accountId: offer.account_id || account?.id || null,
      productId: Number(offer.products.id),
      identity,
      tosAcceptanceEventId: offer.tos_acceptance_event_id || null,
      legacyStripeSessionId: offer.stripe_session_id || null,
      sessionInput,
    });
    const session = reservedCheckout.session;

    const { error: updateError } = await supabase
      .from("offers")
      .update({
        stripe_checkout_url: session.url,
        stripe_session_id: session.id,
        buyer_protection_selected: buyerProtectionSelected,
        buyer_protection_fee: buyerProtectionSelected
          ? BUYER_PROTECTION_FEE
          : 0,
        buyer_protection_covered_amount: buyerProtectionSelected
          ? protectionEligibility.coveredAmount
          : 0,
        buyer_protection_policy_version: buyerProtectionSelected
          ? BUYER_PROTECTION_POLICY_VERSION
          : null,
        buyer_protection_terms_accepted_at:
          protectionTermsAcceptedAt,
        buyer_protection_consent_source:
          protectionConsentSource,
        buyer_protection_preference_mode:
          protectionPreferenceMode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", offer.id)
      .eq("store_id", storeId)
      .in("status", ["accepted", "countered"]);
    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      url: session.url,
      replayed: reservedCheckout.replayed,
      checkoutAttemptId: reservedCheckout.checkoutAttemptId,
      reservationExpiresAt: reservedCheckout.reservationExpiresAt,
    });
  } catch (error: any) {
    if (error instanceof InventoryEngineError) {
      return NextResponse.json(
        { error: error.message, retryable: false },
        { status: error.statusCode },
      );
    }
    if (error instanceof ReservedOfferCheckoutError) {
      return NextResponse.json(
        { error: error.message, retryable: error.retryable },
        {
          status: error.statusCode,
          headers: error.retryable ? { "Retry-After": "2" } : undefined,
        },
      );
    }

    return NextResponse.json(
      { error: error.message || "Could not start offer checkout", retryable: true },
      { status: 500 },
    );
  }
}
