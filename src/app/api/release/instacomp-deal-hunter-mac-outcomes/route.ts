import { releaseRuntimeTeamIsAllowed } from "../../../../lib/vercel-release-runtime-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function bearerToken(request: Request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function authorized(request: Request) {
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

function compactProviderMessages(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((row: any) => ({
    label: s(row?.label, 160),
    status: s(row?.status, 100),
    results: Number(row?.results || 0),
    message: s(row?.message, 350),
  }));
}

function compactAttempts(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((attempt: any) => ({
    teacher: s(attempt?.teacher, 100),
    configured: attempt?.configured === true,
    ok: attempt?.ok === true,
    soldCount: Array.isArray(attempt?.sold) ? attempt.sold.length : 0,
    activeCount: Array.isArray(attempt?.active) ? attempt.active.length : 0,
    error: s(attempt?.error, 300),
  }));
}

function compactCandidate(row: any) {
  const identity = row?.identity && typeof row.identity === "object" ? row.identity : {};
  const market = row?.exact_market && typeof row.exact_market === "object" ? row.exact_market : {};
  const consensus = market?.teacherConsensus && typeof market.teacherConsensus === "object"
    ? market.teacherConsensus
    : {};
  const currentMemory = market?.historicalSoldMemory && typeof market.historicalSoldMemory === "object"
    ? market.historicalSoldMemory
    : null;
  const fallbackMemory = market?.historicalSoldFallback && typeof market.historicalSoldFallback === "object"
    ? market.historicalSoldFallback
    : null;
  return {
    runId: s(row?.run_id || row?.runId, 100),
    createdAt: s(row?.created_at || row?.createdAt, 100),
    candidateKey: s(row?.candidate_key || row?.candidateKey, 260),
    lane: s(row?.lane, 100),
    watchedPerson: s(row?.watched_person || row?.watchedPerson, 200),
    listingItemId: s(row?.listing_item_id || row?.listingItemId, 200),
    listingUrl: s(row?.listing_url || row?.listingUrl, 2000),
    title: s(row?.title, 1000),
    status: s(row?.status, 100),
    itemPrice: n(row?.item_price ?? row?.itemPrice),
    inboundShipping: n(row?.inbound_shipping ?? row?.inboundShipping),
    deliveredCost: n(row?.delivered_cost ?? row?.deliveredCost),
    conservativeResale: n(row?.conservative_resale ?? row?.conservativeResale),
    expectedNetProfit: n(row?.expected_net_profit ?? row?.expectedNetProfit),
    roiPercent: n(row?.roi_percent ?? row?.roiPercent),
    dealLabel: s(row?.deal_label || row?.dealLabel, 200),
    actionable: row?.actionable === true,
    alertworthy: row?.alertworthy === true,
    errorCode: s(row?.error_code || row?.errorCode, 200),
    errorMessage: s(row?.error_message || row?.errorMessage, 600),
    identity: {
      player: s(identity?.player || identity?.playerName, 200),
      year: s(identity?.year || identity?.season, 100),
      brand: s(identity?.brand || identity?.manufacturer, 200),
      setName: s(identity?.setName || identity?.set_name || identity?.set, 300),
      cardNumber: s(identity?.cardNumber || identity?.card_number, 100),
      parallel: s(identity?.parallel || identity?.parallelName, 300),
      serialNumber: s(identity?.serialNumber || identity?.serial_number, 100),
      gradingCompany: s(identity?.gradingCompany || identity?.grading_company, 100),
      gradeValue: identity?.gradeValue ?? identity?.grade_value ?? null,
      confidence: n(identity?.confidence),
    },
    exactMarket: {
      status: s(market?.status, 100),
      missingIdentityFields: Array.isArray(market?.missingIdentityFields)
        ? market.missingIdentityFields.map((value: unknown) => s(value, 100)).filter(Boolean)
        : [],
      soldCount: Number(market?.soldCount || 0),
      pricingEligibleSoldCount: Number(market?.pricingEligibleSoldCount || 0),
      activeCount: Number(market?.activeCount || 0),
      trustedSuggestedPrice: n(market?.trustedSuggestedPrice),
      registryIdentityId: s(
        market?.dealHunterMacFailover?.registryIdentityId || market?.registryTruth?.identityId,
        100,
      ),
      registryFingerprintSha256: s(
        market?.dealHunterMacFailover?.registryFingerprintSha256 || market?.registryTruth?.fingerprintSha256,
        100,
      ),
      historicalSoldMemory: currentMemory
        ? {
            used: currentMemory.used === true,
            soldCount: Number(currentMemory.soldCount || 0),
            medianDeliveredPrice: n(currentMemory.medianDeliveredPrice),
            newestSoldAt: s(currentMemory.newestSoldAt, 100),
          }
        : null,
      historicalSoldFallback: fallbackMemory
        ? {
            used: fallbackMemory.used === true,
            soldCount: Number(fallbackMemory.soldCount || 0),
            medianDeliveredPrice: n(fallbackMemory.medianDeliveredPrice),
            newestSoldAt: s(fallbackMemory.newestSoldAt, 100),
            error: s(fallbackMemory.error, 300),
          }
        : null,
      configuredTeachers: Array.isArray(consensus?.configuredTeachers)
        ? consensus.configuredTeachers.map(String)
        : [],
      requiredVotes: Number(consensus?.requiredVotes || 0),
      teacherAttempts: compactAttempts(consensus?.attempts),
      providerMessages: compactProviderMessages(market?.providerMessages),
    },
  };
}

export async function POST(request: Request) {
  if (!(await authorized(request))) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const response = await fetch(`${macBaseUrl()}/v1/deal-hunter/candidates?limit=500`, {
      headers: macHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Mac Deal Hunter candidates returned HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 1000)}`);
    }
    const source = Array.isArray(payload?.candidates) ? payload.candidates : [];
    const byRun = new Map<string, { newest: number; rows: any[] }>();
    for (const row of source) {
      const runId = String(row?.run_id || row?.runId || "").trim();
      if (!runId) continue;
      const created = new Date(String(row?.created_at || row?.createdAt || 0)).getTime();
      const entry = byRun.get(runId) || { newest: 0, rows: [] };
      entry.newest = Math.max(entry.newest, Number.isFinite(created) ? created : 0);
      entry.rows.push(row);
      byRun.set(runId, entry);
    }
    const latest = [...byRun.entries()].sort((a, b) => b[1].newest - a[1].newest)[0] || null;
    const latestRunId = latest?.[0] || null;
    const rows = latest ? latest[1].rows.map(compactCandidate) : [];
    rows.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    const summary = {
      sourceCandidateCount: source.length,
      runCount: byRun.size,
      latestRunId,
      latestRunCandidateCount: rows.length,
      failed: rows.filter((row) => row.status === "failed").length,
      actionable: rows.filter((row) => row.actionable).length,
      trustedPrice: rows.filter((row) => Number(row.exactMarket.trustedSuggestedPrice || 0) > 0).length,
      memoryPriced: rows.filter(
        (row) => row.exactMarket.historicalSoldMemory?.used || row.exactMarket.historicalSoldFallback?.used,
      ).length,
      teacherRan: rows.filter((row) => row.exactMarket.configuredTeachers.length > 0).length,
      teacherTrustedSold: rows.filter(
        (row) => row.exactMarket.configuredTeachers.length > 0 && row.exactMarket.pricingEligibleSoldCount > 0,
      ).length,
    };
    return Response.json(
      {
        success: true,
        schema: "truelycollectables.instacompDealHunterMacOutcomes.v1",
        summary,
        candidates: rows,
        checkedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
