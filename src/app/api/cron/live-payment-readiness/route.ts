import { timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import {
  evaluateLivePaymentLaunch,
  LIVE_PAYMENT_APPROVAL_VERSION,
  REQUIRED_LIVE_WEBHOOK_EVENTS,
} from "../../../../lib/live-payment-launch";
import { getStripeLiveSecretKey } from "../../../../lib/stripe-credentials";
import { createSupabaseServerClient } from "../../../../lib/supabase-server";
import { getActiveStoreId } from "../../../../lib/stores";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function validCronAuthorization(request: Request, secret: string) {
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function authorize(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret || secret.length < 16) {
    return Response.json(
      { error: "Protected live-payment readiness is not configured." },
      { status: 503 },
    );
  }

  if (!validCronAuthorization(request, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

function clean(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

function expectedWebhookUrl() {
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

function endpointFingerprint(endpointId: string) {
  return endpointId.length > 10
    ? `${endpointId.slice(0, 6)}...${endpointId.slice(-4)}`
    : "present";
}

export async function GET(request: Request) {
  const authorizationError = authorize(request);
  if (authorizationError) return authorizationError;

  const originalSwitch = process.env.TCOS_LIVE_PAYMENTS_ENABLED;
  process.env.TCOS_LIVE_PAYMENTS_ENABLED = "true";

  try {
    const report = await evaluateLivePaymentLaunch({
      supabase: createSupabaseServerClient({ admin: true }),
      storeId: getActiveStoreId(),
    });

    return Response.json(
      {
        success: true,
        evaluatedAt: new Date().toISOString(),
        simulatedFinalRuntimeSwitch: true,
        actualRuntimeSwitchEnabled: originalSwitch === "true",
        paymentMode: report.paymentMode,
        livePaymentsEnabled: report.livePaymentsEnabled,
        approvalDatabaseReady: report.approvalDatabaseReady,
        approvalReady: report.approvalReady,
        summary: report.summary,
        checks: report.checks.map((check) => ({
          key: check.key,
          label: check.label,
          status: check.status,
          detail: check.detail,
        })),
        readOnlyGuarantee:
          "This protected endpoint performs read-only launch evaluation only. It does not create Checkout Sessions, payments, refunds, disputes, payouts, postage, approvals, revocations, deployments, or environment changes.",
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Protected live-payment readiness failed.",
      },
      { status: 500 },
    );
  } finally {
    if (originalSwitch === undefined) {
      delete process.env.TCOS_LIVE_PAYMENTS_ENABLED;
    } else {
      process.env.TCOS_LIVE_PAYMENTS_ENABLED = originalSwitch;
    }
  }
}

export async function POST(request: Request) {
  const authorizationError = authorize(request);
  if (authorizationError) return authorizationError;

  const liveStripeKey = getStripeLiveSecretKey();
  const webhookUrl = expectedWebhookUrl();

  if (!liveStripeKey || !webhookUrl) {
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
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const matches = endpoints.data.filter(
      (endpoint) => endpoint.url === webhookUrl,
    );

    if (matches.length !== 1) {
      return Response.json(
        {
          success: false,
          error:
            matches.length === 0
              ? "No existing live webhook endpoint matches the Production URL; no endpoint was created because that would rotate the signing secret."
              : "Multiple live webhook endpoints match the Production URL; no endpoint was changed to avoid duplicate delivery.",
          matchingEndpointCount: matches.length,
          totalLiveEndpointCount: endpoints.data.length,
          mutationPerformed: false,
        },
        { status: 409 },
      );
    }

    const endpoint = matches[0];
    const requiredEvents = [...REQUIRED_LIVE_WEBHOOK_EVENTS];
    const beforeEvents = new Set(endpoint.enabled_events);
    const alreadyComplete =
      endpoint.status === "enabled" &&
      (beforeEvents.has("*") ||
        requiredEvents.every((event) => beforeEvents.has(event)));

    const updated = alreadyComplete
      ? endpoint
      : await stripe.webhookEndpoints.update(endpoint.id, {
          disabled: false,
          enabled_events: requiredEvents,
          url: webhookUrl,
          description:
            endpoint.description ||
            "Truely Collectables live payment webhook",
        });

    const afterEvents = new Set(updated.enabled_events);
    const complete =
      updated.status === "enabled" &&
      (afterEvents.has("*") ||
        requiredEvents.every((event) => afterEvents.has(event)));

    return Response.json(
      {
        success: complete,
        repairedAt: new Date().toISOString(),
        endpointId: endpointFingerprint(updated.id),
        urlMatchesProduction: updated.url === webhookUrl,
        status: updated.status,
        requiredEventCount: requiredEvents.length,
        enabledRequiredEventCount: requiredEvents.filter((event) =>
          afterEvents.has(event),
        ).length,
        wildcardEnabled: afterEvents.has("*"),
        mutationPerformed: !alreadyComplete,
        signingSecretRotated: false,
        readOnlyBoundary:
          "This action only updates the existing matching Stripe webhook endpoint. It does not create an endpoint, rotate the signing secret, create payments, alter database approval, or change the live-payment runtime switch.",
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
            : "Live Stripe webhook repair failed.",
        mutationPerformed: false,
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const authorizationError = authorize(request);
  if (authorizationError) return authorizationError;

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const confirmation = clean(body.confirmation, 80);
  const operator = clean(body.operator, 120);
  const note = clean(body.note, 1000) || null;

  if (confirmation !== "APPROVE LIVE PAYMENTS") {
    return Response.json(
      { success: false, error: "Type APPROVE LIVE PAYMENTS exactly." },
      { status: 400 },
    );
  }

  if (!operator) {
    return Response.json(
      { success: false, error: "Operator name is required." },
      { status: 400 },
    );
  }

  if (process.env.TCOS_LIVE_PAYMENTS_ENABLED !== "true") {
    return Response.json(
      {
        success: false,
        error:
          "The real Production runtime switch is not enabled; database approval was not recorded.",
      },
      { status: 409 },
    );
  }

  try {
    const supabase = createSupabaseServerClient({ admin: true });
    const storeId = getActiveStoreId();
    const report = await evaluateLivePaymentLaunch({ supabase, storeId });

    if (!report.approvalDatabaseReady || !report.approvalReady) {
      return Response.json(
        {
          success: false,
          error:
            "Live payment approval remains blocked until every required Production check passes.",
          approvalDatabaseReady: report.approvalDatabaseReady,
          approvalReady: report.approvalReady,
          approvalBlockers: report.summary.approvalBlockers,
          mutationPerformed: false,
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const gatePayload = {
      store_id: storeId,
      gate_status: "approved",
      approval_version: LIVE_PAYMENT_APPROVAL_VERSION,
      approved_at: now,
      approved_by: operator,
      approval_note: note,
      revoked_at: null,
      revoked_by: null,
      last_report: report,
      updated_at: now,
    };

    const { error: gateError } = await supabase
      .from("live_payment_launch_gates")
      .upsert(gatePayload, { onConflict: "store_id" });
    if (gateError) throw gateError;

    const { error: eventError } = await supabase
      .from("live_payment_launch_events")
      .insert({
        store_id: storeId,
        event_type: "approved",
        approval_version: LIVE_PAYMENT_APPROVAL_VERSION,
        actor: operator,
        note,
        report,
      });
    if (eventError) throw eventError;

    return Response.json({
      success: true,
      approvedAt: now,
      approvalVersion: LIVE_PAYMENT_APPROVAL_VERSION,
      runtimeSwitchEnabled: true,
      liveCheckoutShouldOpen: true,
      mutationPerformed: true,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Protected live-payment approval failed.",
        mutationPerformed: false,
      },
      { status: 500 },
    );
  }
}
