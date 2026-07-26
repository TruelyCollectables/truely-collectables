import { timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { REQUIRED_LIVE_WEBHOOK_EVENTS } from "../../../../lib/live-payment-launch";
import { getStripeLiveSecretKey } from "../../../../lib/stripe-credentials";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request, secret: string) {
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function productionWebhookUrl() {
  const rawOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!rawOrigin) return null;

  try {
    const origin = new URL(rawOrigin);
    if (origin.protocol !== "https:") return null;
    return new URL("/api/webhook", `${origin.origin}/`).toString();
  } catch {
    return null;
  }
}

function fingerprint(value: string) {
  return value.length > 10
    ? `${value.slice(0, 6)}...${value.slice(-4)}`
    : "present";
}

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || cronSecret.length < 16) {
    return Response.json(
      { success: false, error: "Protected webhook retargeting is not configured." },
      { status: 503 },
    );
  }

  if (!authorized(request, cronSecret)) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const liveStripeKey = getStripeLiveSecretKey();
  const expectedUrl = productionWebhookUrl();

  if (!liveStripeKey || !expectedUrl) {
    return Response.json(
      {
        success: false,
        error: "Live Stripe credentials or the HTTPS Production origin are unavailable.",
      },
      { status: 503 },
    );
  }

  try {
    const stripe = new Stripe(liveStripeKey);
    const listed = await stripe.webhookEndpoints.list({ limit: 100 });
    const exactMatches = listed.data.filter(
      (endpoint) => endpoint.url === expectedUrl,
    );

    const endpoint =
      exactMatches.length === 1
        ? exactMatches[0]
        : exactMatches.length === 0 && listed.data.length === 1
          ? listed.data[0]
          : null;

    if (!endpoint) {
      return Response.json(
        {
          success: false,
          error:
            exactMatches.length > 1
              ? "Multiple live webhook endpoints already match the Production URL; no mutation was performed to avoid duplicate delivery."
              : "The live Stripe account does not have exactly one safe endpoint candidate; no mutation was performed.",
          exactMatchCount: exactMatches.length,
          totalLiveEndpointCount: listed.data.length,
          mutationPerformed: false,
        },
        { status: 409 },
      );
    }

    const requiredEvents = [...REQUIRED_LIVE_WEBHOOK_EVENTS];
    const beforeEvents = new Set(endpoint.enabled_events);
    const alreadyReady =
      endpoint.url === expectedUrl &&
      endpoint.status === "enabled" &&
      (beforeEvents.has("*") ||
        requiredEvents.every((event) => beforeEvents.has(event)));

    const updated = alreadyReady
      ? endpoint
      : await stripe.webhookEndpoints.update(endpoint.id, {
          disabled: false,
          enabled_events: requiredEvents,
          url: expectedUrl,
          description:
            endpoint.description ||
            "Truely Collectables live payment webhook",
        });

    const afterEvents = new Set(updated.enabled_events);
    const complete =
      updated.url === expectedUrl &&
      updated.status === "enabled" &&
      (afterEvents.has("*") ||
        requiredEvents.every((event) => afterEvents.has(event)));

    return Response.json(
      {
        success: complete,
        repairedAt: new Date().toISOString(),
        endpointId: fingerprint(updated.id),
        exactMatchBeforeRepair: endpoint.url === expectedUrl,
        urlMatchesProduction: updated.url === expectedUrl,
        status: updated.status,
        requiredEventCount: requiredEvents.length,
        enabledRequiredEventCount: requiredEvents.filter((event) =>
          afterEvents.has(event),
        ).length,
        wildcardEnabled: afterEvents.has("*"),
        mutationPerformed: !alreadyReady,
        existingEndpointRetargeted: endpoint.url !== expectedUrl,
        signingSecretRotated: false,
        safety:
          "Only the sole existing live Stripe webhook endpoint was eligible. No endpoint was created, no signing secret was rotated, and no database approval, payment, payout, or runtime switch was changed.",
      },
      { status: complete ? 200 : 500 },
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Live Stripe webhook retargeting failed.",
        mutationPerformed: false,
      },
      { status: 500 },
    );
  }
}
