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

async function fetchPage(
  origin: string,
  route: string,
  sessionValue?: string,
) {
  const headers: Record<string, string> = {
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "User-Agent": "InstaCompRuntimeVerifier/2.0",
  };

  if (sessionValue) {
    headers.Cookie = `${ADMIN_SESSION_COOKIE_NAME}=${sessionValue}`;
  }

  const response = await fetch(
    `${origin}${route}?runtimeVerify=${Date.now()}-${Math.random().toString(36).slice(2)}`,
    {
      cache: "no-store",
      redirect: "manual",
      headers,
    },
  );
  const body = await response.text();

  return {
    status: response.status,
    location: response.headers.get("location"),
    body,
  };
}

function redirectsToList(status: number, location: string | null) {
  return (
    [302, 303, 307, 308].includes(status) &&
    Boolean(
      location &&
        new URL(location, "https://runtime.invalid").pathname === "/list",
    )
  );
}

function rendersListWorkspace(status: number, body: string) {
  return (
    status === 200 &&
    body.includes("List Cards") &&
    body.includes("Upload photos") &&
    body.includes("Select and InstaComp") &&
    body.includes("Review and list selected") &&
    !body.includes("/admin/login")
  );
}

function redirectsToListLogin(status: number, location: string | null) {
  if (![302, 303, 307, 308].includes(status) || !location) return false;

  const redirect = new URL(location, "https://runtime.invalid");
  return (
    redirect.pathname === "/admin/login" &&
    redirect.searchParams.get("next") === "/list"
  );
}

function rendersProtectedWorkspace(
  page: Awaited<ReturnType<typeof fetchPage>>,
  requiredText: string[],
) {
  return (
    page.status === 200 &&
    requiredText.every((text) => page.body.includes(text)) &&
    !page.body.includes("/admin/login")
  );
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
    const [
      admin,
      mobile,
      decisionWorkbench,
      checklistRegistry,
      legacyCardStudio,
      listWorkspace,
      listBoundary,
    ] = await Promise.all([
      fetchPage(origin, "/admin", sessionValue),
      fetchPage(origin, "/admin/instacomp/mobile", sessionValue),
      fetchPage(origin, "/admin/instacomp/v2", sessionValue),
      fetchPage(origin, "/admin/instacomp/checklists", sessionValue),
      fetchPage(origin, "/admin/products/new", sessionValue),
      fetchPage(origin, "/list", sessionValue),
      fetchPage(origin, "/list"),
    ]);

    const checks = {
      adminDashboard:
        rendersProtectedWorkspace(admin, [
          "InstaComp Mobile",
          "InstaComp 2.0",
          "Checklist Registry",
          "List Cards",
        ]),
      instacompMobile:
        rendersProtectedWorkspace(mobile, [
          "InstaComp™ 2.0",
          "Built for portrait mode",
          "Scan one card",
          "Run InstaComp 2.0",
          "Confirm &amp; Teach InstaComp",
          "List Cards",
        ]) && mobile.body.includes('href="/list"'),
      decisionWorkbench: rendersProtectedWorkspace(decisionWorkbench, [
        "InstaComp™ 2.0",
        "Checklist Registry",
        "Scan one card",
      ]),
      checklistRegistry: rendersProtectedWorkspace(checklistRegistry, [
        "Checklist Registry",
        "Validate, then import",
        "Originals stay private",
        "Exact identities",
      ]),
      learningControls:
        mobile.body.includes("Every successful scan is saved as an observation") &&
        mobile.body.includes("Needs More Info") &&
        mobile.body.includes("Mark Scan Wrong"),
      cardStudio:
        redirectsToList(legacyCardStudio.status, legacyCardStudio.location) ||
        rendersListWorkspace(legacyCardStudio.status, legacyCardStudio.body),
      listWorkspace: rendersListWorkspace(
        listWorkspace.status,
        listWorkspace.body,
      ),
      listPasswordBoundary: redirectsToListLogin(
        listBoundary.status,
        listBoundary.location,
      ),
      noAutoPilot: !mobile.body.includes("Auto-Pilot"),
      noBatchControls:
        !mobile.body.includes("Batch Scan Up To 500 Cards") &&
        !mobile.body.includes("Parallel Scans"),
      portraitRevision:
        mobile.body.includes("portrait-v2") &&
        mobile.body.includes('data-live-verification="final-pass"') &&
        mobile.body.includes('data-instacomp-version="2.0"'),
      compSource:
        mobile.body.includes("sold comps") &&
        mobile.body.includes("current listings") &&
        mobile.body.includes("estimated shipping") &&
        mobile.body.includes("approximate totals"),
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
          decisionWorkbench: {
            status: decisionWorkbench.status,
            location: decisionWorkbench.location,
          },
          checklistRegistry: {
            status: checklistRegistry.status,
            location: checklistRegistry.location,
          },
          cardStudio: {
            status: legacyCardStudio.status,
            location: legacyCardStudio.location,
          },
          listWorkspace: {
            status: listWorkspace.status,
            location: listWorkspace.location,
          },
          listBoundary: {
            status: listBoundary.status,
            location: listBoundary.location,
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
        error:
          error instanceof Error ? error.message : "Unknown verification error.",
      },
      { status: 500 },
    );
  }
}
