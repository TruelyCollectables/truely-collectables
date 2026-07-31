import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE_NAME,
  createAdminSessionValue,
} from "../../../../lib/admin-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

async function fetchProtectedPage(origin: string, route: string, sessionValue: string) {
  const response = await fetch(
    `${origin}${route}?runtimeVerify=${Date.now()}-${Math.random().toString(36).slice(2)}`,
    {
      cache: "no-store",
      redirect: "manual",
      headers: {
        Cookie: `${ADMIN_SESSION_COOKIE_NAME}=${sessionValue}`,
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent": "TCOSInstaCompRuntimeVerifier/1.0",
      },
    },
  );

  const body = await response.text();

  return {
    status: response.status,
    location: response.headers.get("location"),
    body,
  };
}

function includesAny(value: string, candidates: string[]) {
  return candidates.some((candidate) => value.includes(candidate));
}

export async function GET(request: Request) {
  const configuredSecret = String(
    process.env.INSTACOMP_LIVE_VERIFY_SECRET || "",
  ).trim();
  const providedSecret = String(
    request.headers.get("x-instacomp-live-verify") || "",
  ).trim();

  if (
    !configuredSecret ||
    !providedSecret ||
    !safeEqual(configuredSecret, providedSecret)
  ) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized live verification request." },
      { status: 401 },
    );
  }

  try {
    const origin = new URL(request.url).origin;
    const sessionValue = await createAdminSessionValue();
    const [admin, mobile, cardStudio] = await Promise.all([
      fetchProtectedPage(origin, "/admin", sessionValue),
      fetchProtectedPage(origin, "/admin/instacomp/mobile", sessionValue),
      fetchProtectedPage(origin, "/admin/products/new", sessionValue),
    ]);

    const checks = {
      adminDashboard:
        admin.status === 200 &&
        admin.body.includes("InstaComp Mobile") &&
        admin.body.includes("Card Studio") &&
        !admin.body.includes("/admin/login"),
      instacompMobile:
        mobile.status === 200 &&
        mobile.body.includes("Built for portrait mode") &&
        mobile.body.includes("Scan one card") &&
        mobile.body.includes("Run InstaComp") &&
        !mobile.body.includes("/admin/login"),
      cardStudio:
        cardStudio.status === 200 &&
        includesAny(cardStudio.body, [
          "Card Studio",
          "Add Product",
          "New Product",
          "Create Product",
        ]) &&
        !cardStudio.body.includes("/admin/login"),
      noAutoPilot: !mobile.body.includes("Auto-Pilot"),
      noBatchControls:
        !mobile.body.includes("Batch Scan Up To 500 Cards") &&
        !mobile.body.includes("Parallel Scans"),
      portraitRevision:
        mobile.body.includes("portrait-v2") &&
        mobile.body.includes('data-live-verification="final"'),
      compSource:
        mobile.body.includes("Sold comps (") &&
        mobile.body.includes("Current listings (") &&
        mobile.body.includes("Approx total"),
    };
    const ok = Object.values(checks).every(Boolean);

    return NextResponse.json(
      {
        ok,
        checks,
        pages: {
          admin: { status: admin.status, location: admin.location },
          instacompMobile: {
            status: mobile.status,
            location: mobile.location,
          },
          cardStudio: {
            status: cardStudio.status,
            location: cardStudio.location,
          },
        },
      },
      {
        status: ok ? 200 : 500,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown verification error.",
      },
      { status: 500 },
    );
  }
}
