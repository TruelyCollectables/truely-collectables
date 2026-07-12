import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getStripeLiveSecretKey } from "../../../../../lib/stripe-credentials";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MARKER_KEY = "tcos_webhook_smoke";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stripeRequest(
  stripeKey: string,
  path: string,
  options: { method?: string; body?: URLSearchParams } = {},
) {
  const response = await fetch(`https://api.stripe.com${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      ...(options.body
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    body: options.body,
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `Stripe API ${response.status}: ${payload?.error?.message || "unknown error"}`,
    );
  }
  return payload;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (body.confirmation !== "RUN LIVE WEBHOOK SMOKE") {
    return NextResponse.json(
      { error: "Type RUN LIVE WEBHOOK SMOKE exactly." },
      { status: 400 },
    );
  }

  const stripeKey = getStripeLiveSecretKey();
  if (!stripeKey) {
    return NextResponse.json(
      { error: "A valid live Stripe secret key is not configured." },
      { status: 409 },
    );
  }

  const markerValue = randomUUID();
  const startedAt = Math.floor(Date.now() / 1000) - 2;
  const origin = (
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://truely-collectables.vercel.app"
  ).replace(/\/$/, "");
  const endpointUrl = `${origin}/api/webhook`;
  let endpoint: any = null;
  let originalEvents: string[] = [];
  let endpointExpanded = false;
  let customer: any = null;

  try {
    const endpoints = await stripeRequest(
      stripeKey,
      "/v1/webhook_endpoints?limit=100",
    );
    endpoint = endpoints.data.find(
      (candidate: any) =>
        candidate.status === "enabled" && candidate.url === endpointUrl,
    );
    if (!endpoint) {
      throw new Error(`No enabled live webhook endpoint exists at ${endpointUrl}.`);
    }

    originalEvents = [...endpoint.enabled_events];
    if (
      !originalEvents.includes("*") &&
      !originalEvents.includes("customer.created")
    ) {
      const expandedEvents = new URLSearchParams();
      for (const eventType of [...originalEvents, "customer.created"]) {
        expandedEvents.append("enabled_events[]", eventType);
      }
      await stripeRequest(
        stripeKey,
        `/v1/webhook_endpoints/${encodeURIComponent(endpoint.id)}`,
        { method: "POST", body: expandedEvents },
      );
      endpointExpanded = true;
    }

    const customerBody = new URLSearchParams();
    customerBody.set("description", "TCOS live webhook smoke (temporary)");
    customerBody.set(`metadata[${MARKER_KEY}]`, markerValue);
    customer = await stripeRequest(stripeKey, "/v1/customers", {
      method: "POST",
      body: customerBody,
    });

    let matchingEvent: any = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const params = new URLSearchParams({
        type: "customer.created",
        limit: "10",
      });
      params.set("created[gte]", String(startedAt));
      const events = await stripeRequest(
        stripeKey,
        `/v1/events?${params.toString()}`,
      );
      matchingEvent = events.data.find(
        (event: any) =>
          event.data?.object?.id === customer.id &&
          event.data?.object?.metadata?.[MARKER_KEY] === markerValue,
      );
      if (matchingEvent?.pending_webhooks === 0) break;
      await sleep(1000);
    }

    if (!matchingEvent) {
      throw new Error("Stripe did not create the customer.created smoke event.");
    }
    if (matchingEvent.pending_webhooks !== 0) {
      throw new Error(
        `The live event still has ${matchingEvent.pending_webhooks} pending webhook delivery attempt(s).`,
      );
    }

    return NextResponse.json({
      success: true,
      eventId: matchingEvent.id,
      eventType: matchingEvent.type,
      pendingWebhooks: matchingEvent.pending_webhooks,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Live webhook smoke failed." },
      { status: 502 },
    );
  } finally {
    if (endpointExpanded && endpoint?.id) {
      const restoreEvents = new URLSearchParams();
      for (const eventType of originalEvents) {
        restoreEvents.append("enabled_events[]", eventType);
      }
      try {
        await stripeRequest(
          stripeKey,
          `/v1/webhook_endpoints/${encodeURIComponent(endpoint.id)}`,
          { method: "POST", body: restoreEvents },
        );
      } catch {
        // The extra customer.created subscription is harmless and remains
        // visible in Stripe if restoring the exact event set fails.
      }
    }
    if (customer?.id) {
      try {
        await stripeRequest(
          stripeKey,
          `/v1/customers/${encodeURIComponent(customer.id)}`,
          { method: "DELETE" },
        );
      } catch {
        // The temporary customer contains no payment method or personal data and
        // remains easy to identify by its description if deletion fails.
      }
    }
  }
}
