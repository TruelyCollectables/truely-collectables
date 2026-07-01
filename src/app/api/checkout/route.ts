import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import {
  calculateShipping,
  SHIPPING_RULES,
  type ShippingMethod,
} from "../../../lib/shipping";
import {
  InventoryEngineError,
  inventoryEngine,
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

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!stripeKey) {
      return NextResponse.json(
        { error: "Missing Stripe secret key" },
        { status: 500 }
      );
    }

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables" },
        { status: 500 }
      );
    }

    const stripe = new Stripe(stripeKey);
    const supabase = createClient(supabaseUrl, supabaseKey);
    const storeId = getActiveStoreId();

    const body = await request.json();
    const account = await getAuthenticatedAccountFromRequest(request);

    const cart = inventoryEngine.normalizeCartItems(body.cart);
    const shippingMethod = body.shippingMethod as ShippingMethod;
    const tosAccepted = hasAcceptedTerms(body.tosAccepted);
    const tosVersion = String(body.tosVersion || TERMS_OF_SERVICE_VERSION);

    if (!tosAccepted) {
      return NextResponse.json(
        { error: "Terms of Service must be accepted before checkout" },
        { status: 400 }
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

    const tosAcceptanceEventId = await recordTermsAcceptance(supabase, {
      contextType: "checkout",
      tosKind: "buyer",
      tosVersion,
      identity: clientIdentity,
      storeId,
    });

    if (
      shippingMethod !== "GROUND_ADVANTAGE" &&
      shippingMethod !== "PRIORITY_MAIL"
    ) {
      return NextResponse.json(
        { error: "Invalid shipping method" },
        { status: 400 }
      );
    }

    const inventoryItems = await inventoryEngine.requireAvailableCartItems(cart);

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

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      shipping_address_collection: {
        allowed_countries: ["US"],
      },
      metadata: {
        store_id: storeId,
        account_id: account?.id || "",
        cart: JSON.stringify(cart),
        shipping_method: shippingMethod,
        shipping_name: shippingName,
        shipping_amount: shippingAmount.toFixed(2),
        subtotal: subtotal.toFixed(2),
        item_count: String(itemCount),
        tos_accepted: "true",
        tos_version: tosVersion,
        tos_accepted_at: new Date().toISOString(),
        tos_acceptance_event_id: tosAcceptanceEventId,
        ...metadataSafeIdentity(clientIdentity),
      },
      success_url: `${origin}/success?type=cart&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cart`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    if (error instanceof InventoryEngineError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      { error: error.message || "Checkout failed" },
      { status: 500 }
    );
  }
}
