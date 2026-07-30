import { NextResponse } from "next/server";
import { createAdminSessionValue } from "../../../../lib/admin-session";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TEAM_SLUG = "truelycollectables-projects";
const PRODUCTION_ORIGIN = "https://truelycollectables.com";
const RELEASE_MARKER = "admin-session-refund-fee-fix-2026-07-29-2115-mt";

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() || "";
}

async function hasAuthorizedVercelTeamToken(token: string) {
  if (!token || token.length < 20) return false;

  const response = await fetch("https://api.vercel.com/v2/teams?limit=100", {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "TCOS-Admin-Release-Self-Test/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) return false;

  const payload = await response.json().catch(() => null);
  const teams = Array.isArray(payload?.teams) ? payload.teams : [];
  return teams.some(
    (team: any) =>
      String(team?.slug || "") === TEAM_SLUG &&
      team?.membership?.confirmed !== false,
  );
}

function adminCookie(sessionValue: string) {
  return `tcos_admin_auth_v3=${encodeURIComponent(sessionValue)}`;
}

async function adminRequest(
  path: string,
  cookie: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", cookie);
  headers.set("User-Agent", "TCOS-Admin-Release-Self-Test/1.0");

  return fetch(`${PRODUCTION_ORIGIN}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    redirect: "manual",
  });
}

async function requireAdminPage(
  path: string,
  expectedText: string,
  cookie: string,
) {
  const response = await adminRequest(path, cookie);
  const body = await response.text();
  const location = response.headers.get("location") || "";

  if (
    response.status !== 200 ||
    location.includes("/admin/login") ||
    body.includes("Admin login") ||
    !body.includes(expectedText)
  ) {
    throw new Error(
      `Admin navigation failed for ${path}: status=${response.status}, location=${location || "none"}.`,
    );
  }

  return body;
}

function orderIdFromOrdersHtml(html: string) {
  const match = /href="\/admin\/orders\/(\d+)"/.exec(html);
  const orderId = Number(match?.[1] || 0);

  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw new Error("The live fulfillment page did not expose a usable order link.");
  }

  return orderId;
}

async function requireSessionRefresh(cookie: string) {
  const response = await adminRequest("/api/admin/session/refresh", cookie, {
    method: "POST",
  });
  const body = await response.json().catch(() => ({}));
  const setCookie = response.headers.get("set-cookie") || "";

  if (
    response.status !== 200 ||
    body?.success !== true ||
    !setCookie.includes("tcos_admin_auth_v3=")
  ) {
    throw new Error(
      `Admin session refresh failed: status=${response.status}, cookie=${Boolean(setCookie)}.`,
    );
  }
}

async function requireDirectStoreFeeCleanup(cookie: string) {
  const first = await adminRequest(
    "/api/admin/reconcile-platform-fees",
    cookie,
    { method: "POST" },
  );
  const firstBody = await first.json().catch(() => ({}));

  if (first.status !== 200 || firstBody?.success !== true) {
    throw new Error(`Direct-store fee cleanup failed with status ${first.status}.`);
  }

  const second = await adminRequest(
    "/api/admin/reconcile-platform-fees",
    cookie,
    { method: "POST" },
  );
  const secondBody = await second.json().catch(() => ({}));

  if (
    second.status !== 200 ||
    secondBody?.success !== true ||
    Number(secondBody?.removedDirectStoreFeeRows || 0) !== 0
  ) {
    throw new Error(
      "Direct-store TCOS fee rows were still present after reconciliation.",
    );
  }

  return Number(firstBody?.removedDirectStoreFeeRows || 0);
}

async function requireRefundConfirmationGuard(orderId: number, cookie: string) {
  const response = await adminRequest("/api/orders/refund", cookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderId,
      reason:
        "Production verification only; confirmation intentionally withheld so no refund can occur.",
      confirmed: false,
    }),
  });
  const body = await response.json().catch(() => ({}));

  if (
    response.status !== 400 ||
    !String(body?.error || "").toLowerCase().includes("confirm")
  ) {
    throw new Error(
      `Refund confirmation guard failed: expected 400, received ${response.status}.`,
    );
  }
}

export async function POST(request: Request) {
  const token = bearerToken(request);

  if (!(await hasAuthorizedVercelTeamToken(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (process.env.VERCEL_ENV !== "production") {
    return NextResponse.json(
      { error: "This self-test only runs in Vercel Production." },
      { status: 409 },
    );
  }

  try {
    const sessionValue = await createAdminSessionValue();
    const cookie = adminCookie(sessionValue);

    await requireAdminPage("/admin", "Command Center", cookie);
    const ordersHtml = await requireAdminPage(
      "/admin/orders?tab=all",
      "Fulfillment center",
      cookie,
    );
    const orderId = orderIdFromOrdersHtml(ordersHtml);

    await requireAdminPage(`/admin/orders/${orderId}`, `Order #${orderId}`, cookie);
    await requireAdminPage(
      `/admin/orders/${orderId}/packing-slip`,
      "Packing Slip",
      cookie,
    );
    await requireAdminPage("/admin/products", "Products", cookie);
    await requireSessionRefresh(cookie);
    const removedDirectStoreFeeRows = await requireDirectStoreFeeCleanup(cookie);
    await requireRefundConfirmationGuard(orderId, cookie);

    return NextResponse.json(
      {
        success: true,
        release: RELEASE_MARKER,
        orderId,
        adminNavigation: "passed",
        sessionRefresh: "passed",
        refundConfirmationGuard: "passed",
        refundIssued: false,
        directStoreTcosFeesRemaining: 0,
        removedDirectStoreFeeRows,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        release: RELEASE_MARKER,
        error: error?.message || "Runtime admin orders self-test failed.",
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}