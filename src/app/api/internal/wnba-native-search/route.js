import { timingSafeEqual } from "node:crypto";
import { EbayBrowseAdapter } from "../../../../../connectors/tcos-market-intel-mcp/src/public-search.mjs";
import {
  ADMIN_SESSION_COOKIE_NAMES,
  isValidAdminSessionValue,
} from "../../../../lib/admin-session";
import { TCOS_WNBA_ROOKIE_PLAYERS } from "../../../../lib/tcos-profit-hunter-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const QUERY_FAMILIES = [
  {
    id: "broad_rookie",
    label: "Broad professional rookie",
    build: (player) => `${player} WNBA rookie card`,
  },
  {
    id: "parallel_numbered",
    label: "Silver, color, numbered, SSP",
    build: (player) => `${player} silver prizm numbered color SSP`,
  },
  {
    id: "auto_memorabilia",
    label: "Autograph and memorabilia",
    build: (player) => `${player} WNBA autograph patch memorabilia`,
  },
];

const normalize = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function safeEqual(left, right) {
  const leftBytes = Buffer.from(String(left || ""), "utf8");
  const rightBytes = Buffer.from(String(right || ""), "utf8");
  return (
    leftBytes.length > 0 &&
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

async function hasValidAdminSession(request) {
  for (const cookieName of ADMIN_SESSION_COOKIE_NAMES) {
    const value = request.cookies.get(cookieName)?.value;
    if (await isValidAdminSessionValue(value)) return true;
  }
  return false;
}

function deploymentInfo() {
  return {
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || null,
    commitSha:
      String(process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 12) || null,
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    region: process.env.VERCEL_REGION || null,
  };
}

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function canonicalEbayItemId(url) {
  return String(url || "").match(/\/itm\/(\d+)/i)?.[1] || null;
}

function titleAssessment(title, player) {
  const text = normalize(title);
  const normalizedPlayer = normalize(player);
  const playerParts = normalizedPlayer.split(" ").filter(Boolean);
  const playerMatch = playerParts.every((part) => text.includes(part));
  const proWnbaSignal = /\bwnba\b/.test(text);
  const rookieSignal = /\b(rookie|rc|debut)\b/.test(text);
  const collegeSignal = /\b(college|collegiate|ncaa|bowman university|draft picks?|iowa|hawkeyes|uconn|connecticut huskies|usc|trojans|notre dame|fighting irish|maryland|terrapins|stanford|cardinal)\b/.test(
    text,
  );
  const autographOrRelic = /\b(auto|autograph|signed|signature|patch|relic|memorabilia|jersey|swatch)\b/.test(
    text,
  );
  const premiumParallel = /\b(silver|holo|refractor|chrome|mojo|shimmer|pulsar|wave|cracked ice|ice|scope|disco|velocity|cosmic|genesis|elephant|tiger|zebra|gold vinyl|black finite|downtown|kaboom|color blast|colour blast|ssp|super short print|case hit)\b/.test(
    text,
  );
  const colorParallel = /\b(red|blue|green|gold|orange|purple|pink|teal|aqua|black|white|bronze|copper)\b/.test(
    text,
  );
  const numberedSignal =
    /\b(numbered|serial numbered|short print)\b/.test(text) ||
    /\b\d{1,3}\s*\/\s*\d{1,3}\b/.test(String(title || ""));
  const caseHitSignal = /\b(ssp|super short print|case hit|downtown|kaboom|color blast|colour blast|gold vinyl|black finite)\b/.test(
    text,
  );
  const eligibleSignal =
    autographOrRelic ||
    premiumParallel ||
    colorParallel ||
    numberedSignal ||
    caseHitSignal;
  const explicitBase = /\b(base|base card)\b/.test(text);

  const reasons = [];
  if (!playerMatch) reasons.push("Player name is not an exact title match.");
  if (!rookieSignal) reasons.push("Rookie status is not explicit in the title.");
  if (!proWnbaSignal) reasons.push("Professional WNBA issue is not explicit in the title.");

  if (collegeSignal && !proWnbaSignal) {
    return {
      status: "REJECTED_COLLEGE_TITLE",
      reasons: ["Title appears to describe a college/NCAA product."],
    };
  }
  if (explicitBase && !eligibleSignal) {
    return {
      status: "REJECTED_ORDINARY_BASE_TITLE",
      reasons: ["Title explicitly appears to be ordinary base with no eligible premium signal."],
    };
  }
  if (collegeSignal && proWnbaSignal) {
    reasons.push("Title mixes WNBA and college signals; exact product must be verified.");
  }
  if (eligibleSignal && rookieSignal && proWnbaSignal && playerMatch) {
    return {
      status: "LIKELY_SCOPE_MATCH",
      reasons: [
        "Title contains player, WNBA rookie, and Silver-or-better/auto/relic/SSP evidence.",
      ],
    };
  }
  if (eligibleSignal && playerMatch) {
    return {
      status: "POTENTIAL_SCOPE_MATCH",
      reasons: reasons.length
        ? reasons
        : ["Premium signal found, but exact rookie/product identity still needs verification."],
    };
  }
  return {
    status: "MANUAL_IDENTITY_REVIEW",
    reasons: reasons.length
      ? reasons
      : ["No reliable Silver-or-better, auto, relic, numbered, or case-hit signal appears in the title."],
  };
}

function compactCandidate(result, player, family) {
  const assessment = titleAssessment(result.title, player);
  const askingPrice = Number.isFinite(Number(result.askingPrice))
    ? Number(result.askingPrice)
    : null;
  const shipping = Number.isFinite(Number(result.shipping))
    ? Number(result.shipping)
    : null;
  return {
    player,
    itemId: canonicalEbayItemId(result.url),
    source: result.source,
    url: result.url,
    title: result.title,
    askingPrice,
    shipping,
    knownDeliveredPrice:
      askingPrice == null ? null : askingPrice + (shipping == null ? 0 : shipping),
    deliveredPriceComplete: askingPrice != null && shipping != null,
    sellerName: result.sellerName,
    imageUrls: (result.imageUrls || []).slice(0, 4),
    marketplaceManualReview: Boolean(result.manualReviewRequired),
    preliminaryStatus: assessment.status,
    preliminaryReasons: assessment.reasons,
    matchedQueryFamilies: [family],
    requiresHardenedVerification: true,
    purchaseReady: false,
  };
}

function statusRank(status) {
  return {
    LIKELY_SCOPE_MATCH: 0,
    POTENTIAL_SCOPE_MATCH: 1,
    MANUAL_IDENTITY_REVIEW: 2,
    REJECTED_ORDINARY_BASE_TITLE: 3,
    REJECTED_COLLEGE_TITLE: 4,
  }[status] ?? 5;
}

function candidateSort(left, right) {
  const statusDifference =
    statusRank(left.preliminaryStatus) - statusRank(right.preliminaryStatus);
  if (statusDifference) return statusDifference;
  const leftPrice = left.knownDeliveredPrice ?? Number.POSITIVE_INFINITY;
  const rightPrice = right.knownDeliveredPrice ?? Number.POSITIVE_INFINITY;
  return leftPrice - rightPrice;
}

async function searchPlayer(adapter, player, perQuery, maxPerPlayer) {
  const byItem = new Map();
  const queryReports = [];

  for (const family of QUERY_FAMILIES) {
    const query = family.build(player);
    try {
      const result = await adapter.search({
        query,
        sources: ["eBay"],
        filters: {},
        maxResults: perQuery,
      });
      queryReports.push({
        id: family.id,
        label: family.label,
        query,
        count: result.results.length,
        warnings: result.warnings || [],
      });
      for (const entry of result.results) {
        const candidate = compactCandidate(entry, player, family.id);
        const key = candidate.itemId || candidate.url;
        if (!key) continue;
        const existing = byItem.get(key);
        if (!existing) {
          byItem.set(key, candidate);
          continue;
        }
        existing.matchedQueryFamilies = [
          ...new Set([...existing.matchedQueryFamilies, family.id]),
        ];
        if (candidate.imageUrls.length > existing.imageUrls.length) {
          existing.imageUrls = candidate.imageUrls;
        }
      }
    } catch (error) {
      queryReports.push({
        id: family.id,
        label: family.label,
        query,
        count: 0,
        warnings: [error instanceof Error ? error.message : String(error)],
      });
    }
  }

  const allCandidates = [...byItem.values()].sort(candidateSort);
  const counts = allCandidates.reduce(
    (summary, candidate) => {
      summary[candidate.preliminaryStatus] =
        (summary[candidate.preliminaryStatus] || 0) + 1;
      return summary;
    },
    {},
  );

  return {
    player,
    queryReports,
    uniqueCandidateCount: allCandidates.length,
    counts,
    candidates: allCandidates.slice(0, maxPerPlayer),
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  return Number.isFinite(Number(value)) ? `$${Number(value).toFixed(2)}` : "Unknown";
}

function htmlResponse(payload) {
  const playerSections = payload.players
    .map((playerResult) => {
      const cards = playerResult.candidates
        .filter(
          (candidate) =>
            !candidate.preliminaryStatus.startsWith("REJECTED_"),
        )
        .map((candidate) => {
          const image = candidate.imageUrls[0]
            ? `<img src="${escapeHtml(candidate.imageUrls[0])}" alt="" loading="lazy">`
            : '<div class="no-image">No image</div>';
          return `<article class="candidate">
            ${image}
            <div>
              <div class="status ${escapeHtml(candidate.preliminaryStatus.toLowerCase())}">${escapeHtml(candidate.preliminaryStatus)}</div>
              <a href="${escapeHtml(candidate.url)}" target="_blank" rel="noreferrer">${escapeHtml(candidate.title)}</a>
              <p><strong>Known cost:</strong> ${escapeHtml(money(candidate.knownDeliveredPrice))}${candidate.deliveredPriceComplete ? " delivered" : " + unknown shipping"}</p>
              <p><strong>Seller:</strong> ${escapeHtml(candidate.sellerName || "Unknown")}</p>
              <p>${escapeHtml(candidate.preliminaryReasons.join(" "))}</p>
            </div>
          </article>`;
        })
        .join("");
      return `<section>
        <h2>${escapeHtml(playerResult.player)}</h2>
        <p>${playerResult.uniqueCandidateCount} unique native eBay candidates. Likely: ${playerResult.counts.LIKELY_SCOPE_MATCH || 0}; potential: ${playerResult.counts.POTENTIAL_SCOPE_MATCH || 0}; manual: ${playerResult.counts.MANUAL_IDENTITY_REVIEW || 0}; rejected title-only: ${(playerResult.counts.REJECTED_COLLEGE_TITLE || 0) + (playerResult.counts.REJECTED_ORDINARY_BASE_TITLE || 0)}.</p>
        <div class="grid">${cards || "<p>No non-rejected candidates returned.</p>"}</div>
      </section>`;
    })
    .join("");

  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TCOS WNBA Native Search</title><style>
    body{font-family:Arial,sans-serif;margin:0;background:#0b1020;color:#f8fafc;padding:20px}main{max-width:1180px;margin:auto}h1{margin-bottom:6px}h2{margin-top:34px}.note{background:#18213b;border:1px solid #334155;padding:14px;border-radius:12px}.grid{display:grid;gap:12px}.candidate{display:grid;grid-template-columns:110px 1fr;gap:14px;background:#111827;border:1px solid #334155;padding:12px;border-radius:14px}.candidate img,.no-image{width:110px;height:145px;object-fit:contain;background:#fff;border-radius:8px}.no-image{display:grid;place-items:center;color:#475569}.candidate a{color:#93c5fd;font-weight:700}.candidate p{margin:7px 0;color:#cbd5e1}.status{display:inline-block;font-size:11px;font-weight:800;padding:5px 8px;border-radius:999px;background:#334155;margin-bottom:8px}.likely_scope_match{background:#166534}.potential_scope_match{background:#854d0e}.manual_identity_review{background:#334155}@media(max-width:640px){body{padding:10px}.candidate{grid-template-columns:86px 1fr}.candidate img,.no-image{width:86px;height:116px}}
  </style></head><body><main><h1>TCOS Profit Hunter™ — WNBA Native eBay Discovery</h1><p>Run ${escapeHtml(payload.runAt)} · ${payload.summary.uniqueCandidates} unique candidates · ${payload.summary.queriesRun} native Browse searches</p><div class="note"><strong>Discovery only:</strong> title-based screening is not a buy recommendation. Every candidate still requires exact front/back identity, sold comps, delivered-cost math, fees, and a minimum 20% net ROI.</div>${playerSections}</main></body></html>`, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request) {
  const deployment = deploymentInfo();
  const adminAuthorized = await hasValidAdminSession(request);
  const expected = String(process.env.TCOS_EBAY_PROBE_TOKEN || "").trim();
  const provided = String(
    request.headers.get("x-tcos-ebay-probe-token") || "",
  ).trim();
  const probeTokenAuthorized = Boolean(
    expected && provided && safeEqual(provided, expected),
  );

  if (!adminAuthorized && !probeTokenAuthorized) {
    return json(
      {
        ok: false,
        code: "WNBA_NATIVE_SEARCH_UNAUTHORIZED",
        error: "A valid TCOS admin session or probe token is required.",
        deployment,
      },
      401,
    );
  }

  const adapter = new EbayBrowseAdapter();
  if (!adapter.configured) {
    return json(
      {
        ok: false,
        code: "EBAY_BROWSE_NOT_CONFIGURED",
        deployment,
      },
      503,
    );
  }

  const perQuery = clampInteger(
    request.nextUrl?.searchParams?.get("perQuery"),
    5,
    20,
    15,
  );
  const maxPerPlayer = clampInteger(
    request.nextUrl?.searchParams?.get("maxPerPlayer"),
    5,
    30,
    20,
  );
  const startedAt = Date.now();
  const players = await Promise.all(
    TCOS_WNBA_ROOKIE_PLAYERS.map((player) =>
      searchPlayer(adapter, player, perQuery, maxPerPlayer),
    ),
  );
  const summary = {
    players: players.length,
    queriesRun: players.reduce(
      (total, playerResult) => total + playerResult.queryReports.length,
      0,
    ),
    uniqueCandidates: players.reduce(
      (total, playerResult) => total + playerResult.uniqueCandidateCount,
      0,
    ),
    returnedCandidates: players.reduce(
      (total, playerResult) => total + playerResult.candidates.length,
      0,
    ),
    totalMs: Date.now() - startedAt,
  };
  const payload = {
    ok: true,
    mode: "wnba_full_native_discovery",
    authorization: adminAuthorized ? "admin_session" : "probe_token",
    deployment,
    runAt: new Date().toISOString(),
    rules: {
      players: [...TCOS_WNBA_ROOKIE_PLAYERS],
      professionalWnbaRookieOnly: true,
      ordinaryBaseExcluded: true,
      minimumTier: "Silver Prizm or equivalent",
      collegeNcaaBowmanUniversityDraftPicksExcluded: true,
      minimumNetRoiPercent: 20,
      discoveryIsNotPurchaseApproval: true,
    },
    summary,
    players,
  };

  const format = String(
    request.nextUrl?.searchParams?.get("format") || "json",
  ).toLowerCase();
  return format === "html" ? htmlResponse(payload) : json(payload);
}
