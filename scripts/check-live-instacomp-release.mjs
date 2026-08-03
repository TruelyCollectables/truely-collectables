import { pathToFileURL } from "node:url";

const RELEASE_CONTRACT = {
  schema: "tcos.instacomp.release.v1",
  backendRelease: "evidence-first-95-ai-council-30",
  identityThreshold: 0.95,
  requiresBackImage: true,
  compSearchRequiresConfirmedIdentity: true,
  learningRequiresConfirmedIdentity: true,
  aiCouncilDefaultReaders: 8,
  aiCouncilMaxReaders: 30,
  aiCouncilFamilyVoteCap: true,
  aiCouncilReserveReaders: true,
  aiCouncilCustomProviderSlots: 14,
};

export function normalizeExpectedCommit(value) {
  const commit = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(
      "INSTACOMP_EXPECTED_COMMIT must be the exact 40-character Git SHA that was deployed.",
    );
  }
  return commit;
}

export function verifyInstaCompReleasePayload(payload, expectedCommit) {
  const expected = {
    ...RELEASE_CONTRACT,
    sourceCommit: normalizeExpectedCommit(expectedCommit),
  };
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => payload?.[key] !== value)
    .map(
      ([key, value]) =>
        `${key}: expected ${JSON.stringify(value)}, received ${JSON.stringify(
          payload?.[key],
        )}`,
    );

  if (mismatches.length) {
    throw new Error(mismatches.join("; "));
  }

  return expected;
}

function releaseOrigins() {
  const configured = String(process.env.INSTACOMP_RELEASE_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return configured.length
    ? configured
    : [
        "https://truely-collectables.vercel.app",
        "https://truelycollectables.com",
      ];
}

async function fetchRelease(origin, expectedCommit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(`${origin}/instacomp-release.json`, {
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    verifyInstaCompReleasePayload(payload, expectedCommit);

    console.log(
      `PASS ${origin} serves ${payload.backendRelease} from ${payload.sourceCommit.slice(0, 8)} with ${payload.aiCouncilDefaultReaders}-${payload.aiCouncilMaxReaders} AI readers`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyLiveInstaCompRelease({
  expectedCommit = process.env.INSTACOMP_EXPECTED_COMMIT,
  origins = releaseOrigins(),
} = {}) {
  const exactCommit = normalizeExpectedCommit(expectedCommit);
  const results = await Promise.allSettled(
    origins.map((origin) => fetchRelease(origin, exactCommit)),
  );
  const failures = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [`${origins[index]}: ${result.reason?.message || String(result.reason)}`]
      : [],
  );

  if (failures.length) {
    throw new Error(
      `InstaComp production release verification failed:\n${failures
        .map((failure) => `- ${failure}`)
        .join("\n")}`,
    );
  }

  console.log("InstaComp production release verification passed for all aliases.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await verifyLiveInstaCompRelease();
}
