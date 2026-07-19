import { createClient } from "@supabase/supabase-js";

type JsonRecord = Record<string, unknown>;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required worker environment variable: ${name}`);
  return value;
}

function envInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(process.env[name] || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

async function verifySupabase() {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  new URL(url);

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [candidateResult, watchResult, identityResult] = await Promise.all([
    supabase
      .from("tcos_mi_search_candidates")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("tcos_mi_watchlist")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
    supabase
      .from("tcos_mi_collectible_identities")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
  ]);

  if (candidateResult.error) {
    const missingTable = candidateResult.error.code === "42P01";
    throw new Error(
      missingTable
        ? "Identity Proof candidate queue is not installed. Apply migration 20260719153000_market_intel_identity_proof_gate.sql."
        : `Supabase candidate queue check failed: ${candidateResult.error.message}`,
    );
  }
  if (watchResult.error) {
    throw new Error(`Supabase watchlist check failed: ${watchResult.error.message}`);
  }
  if (identityResult.error) {
    throw new Error(`Supabase identity check failed: ${identityResult.error.message}`);
  }

  return {
    projectHost: new URL(url).host,
    candidateQueueInstalled: true,
    currentCandidateCount: candidateResult.count || 0,
    activeWatchTargets: watchResult.count || 0,
    activeExactIdentities: identityResult.count || 0,
  };
}

async function verifyEbayOAuth() {
  const clientId = requiredEnv("EBAY_CLIENT_ID");
  const clientSecret = requiredEnv("EBAY_CLIENT_SECRET");
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
  });
  const payload = (await response.json()) as JsonRecord;
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new Error(
      String(
        payload.error_description ||
          payload.error ||
          `eBay OAuth validation failed (${response.status}).`,
      ),
    );
  }

  return {
    oauthValidated: true,
    tokenExpiresInSeconds: Number(payload.expires_in || 0),
    marketplaceSearchCallsMade: 0,
  };
}

async function main() {
  const maxIdentities = envInteger("MARKET_INTEL_WORKER_MAX_IDENTITIES", 4, 1, 20);
  const maxQueries = envInteger("MARKET_INTEL_WORKER_MAX_QUERIES", 8, 2, 10);
  const intervalMinutes = envInteger("MARKET_INTEL_WORKER_INTERVAL_MINUTES", 15, 5, 1440);
  const maximumCallsPerCycle = maxIdentities * maxQueries;
  const estimatedMaximumCallsPerDay =
    Math.ceil(1440 / intervalMinutes) * maximumCallsPerCycle;

  if (estimatedMaximumCallsPerDay > 4500) {
    throw new Error(
      `Worker configuration could use about ${estimatedMaximumCallsPerDay} eBay Browse calls/day. Reduce frequency, identities, or queries before activation.`,
    );
  }

  const [supabase, ebay] = await Promise.all([verifySupabase(), verifyEbayOAuth()]);

  console.log(
    JSON.stringify(
      {
        preflight: "tcos.marketIntel.workerPreflight.v1",
        passed: true,
        completedAt: new Date().toISOString(),
        workerName: process.env.MARKET_INTEL_WORKER_NAME || "tcos-market-intel-worker",
        intervalMinutes,
        maximumCallsPerCycle,
        estimatedMaximumCallsPerDay,
        vercelSearchInvocations: 0,
        supabase,
        ebay,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
