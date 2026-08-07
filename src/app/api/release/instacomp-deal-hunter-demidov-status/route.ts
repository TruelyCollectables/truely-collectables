import { createClient } from "@supabase/supabase-js";
import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}

async function verifyVercelToken(request: Request) {
  const token = bearerToken(request);
  if (!token) return false;
  try {
    const response = await fetch("https://api.vercel.com/v2/teams?limit=100", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { teams?: unknown };
    return releaseRuntimeTeamIsAllowed(payload.teams);
  } catch {
    return false;
  }
}

function macBaseUrl() {
  const configured = String(process.env.INSTACOMP_AI_LOCAL_URL || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+\.truelycollectables\.com$/i.test(configured)) {
    throw new Error("Production InstaComp Mac tunnel URL is missing or invalid.");
  }
  return configured;
}

function macHeaders() {
  const key = String(process.env.INSTACOMP_AI_LOCAL_KEY || "").trim();
  if (!key) throw new Error("Production InstaComp Mac shared key is missing.");
  return { "X-InstaComp-AI-Key": key, Accept: "application/json" };
}

function n(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function s(value: unknown, max = 1000) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

async function getJson(url: string, headers: Record<string, string>) {
  const response = await fetch(url, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Mac request returned HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 1000)}`);
  }
  return payload as any;
}

export async function POST(request: Request) {
  if (!(await verifyVercelToken(request))) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const baseUrl = macBaseUrl();
    const headers = macHeaders();
    const macPayload = await getJson(`${baseUrl}/v1/deal-hunter/candidates?limit=500`, headers);
    const candidates = Array.isArray(macPayload?.candidates) ? macPayload.candidates : [];
    const ivan = candidates.filter((row: any) => {
      const lane = String(row?.lane || "").toLowerCase();
      const watched = String(row?.watched_person || row?.watchedPerson || "").toLowerCase();
      const title = String(row?.title || "").toLowerCase();
      return lane === "ivan_demidov" || watched.includes("ivan demidov") || title.includes("ivan demidov");
    });

    const listingIds = Array.from(new Set(ivan.map((row: any) => s(row?.listing_item_id || row?.listingItemId, 200)).filter(Boolean))) as string[];
    const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
    const serviceRole = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!supabaseUrl || !serviceRole) throw new Error("Production Supabase service role is not configured.");
    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let history: any[] = [];
    if (listingIds.length) {
      const { data, error } = await supabase
        .from("tcos_card_market_observations")
        .select("registry_identity_id,observation_kind,listing_item_id,delivered_price,created_at,scan_id")
        .in("listing_item_id", listingIds)
        .order("created_at", { ascending: false });
      if (error) throw new Error(`Production history lookup failed: ${error.message}`);
      history = data || [];
    }
    const byListing = new Map<string, any>();
    for (const row of history) {
      const key = String(row.listing_item_id || "");
      if (key && !byListing.has(key)) byListing.set(key, row);
    }

    const sanitized = ivan.map((row: any) => {
      const listingItemId = s(row?.listing_item_id || row?.listingItemId, 200);
      const h = listingItemId ? byListing.get(listingItemId) : null;
      const identity = row?.identity || {};
      return {
        runId: s(row?.run_id || row?.runId, 100),
        lane: s(row?.lane, 100),
        watchedPerson: s(row?.watched_person || row?.watchedPerson, 200),
        listingItemId,
        listingUrl: s(row?.listing_url || row?.listingUrl, 2000),
        title: s(row?.title, 1000),
        itemPrice: n(row?.item_price ?? row?.itemPrice),
        deliveredCost: n(row?.delivered_cost ?? row?.deliveredCost),
        conservativeResale: n(row?.conservative_resale ?? row?.conservativeResale),
        expectedNetProfit: n(row?.expected_net_profit ?? row?.expectedNetProfit),
        roiPercent: n(row?.roi_percent ?? row?.roiPercent),
        dealLabel: s(row?.deal_label || row?.dealLabel, 200),
        status: s(row?.status, 100),
        errorCode: s(row?.error_code || row?.errorCode, 200),
        identity: {
          player: s(identity?.player || identity?.playerName, 200),
          year: s(identity?.year || identity?.season, 100),
          set: s(identity?.set || identity?.setName, 300),
          cardNumber: s(identity?.cardNumber || identity?.card_number, 100),
          parallel: s(identity?.parallel || identity?.parallelName, 300),
          confidence: n(identity?.confidence),
        },
        trustedHistory: h ? {
          registryIdentityId: s(h.registry_identity_id, 100),
          kind: s(h.observation_kind, 50),
          deliveredPrice: n(h.delivered_price),
          createdAt: s(h.created_at, 100),
          scanId: s(h.scan_id, 100),
        } : null,
      };
    });

    return Response.json({
      success: true,
      schema: "truelycollectables.instacompDealHunterDemidovDiagnostics.v1",
      ivanCandidateCount: sanitized.length,
      trustedIvanHistoryCount: sanitized.filter((row: any) => Boolean(row.trustedHistory)).length,
      candidates: sanitized,
      checkedAt: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ success: false, error: error instanceof Error ? error.message : String(error) }, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
