const EXPECTED = {
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
  sourceCommit: "468d2de8018b3bd353875f767d63e86e6bcc1762",
};

const origins = [
  "https://truely-collectables.vercel.app",
  "https://truelycollectables.com",
];

async function fetchRelease(origin) {
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
    const mismatches = Object.entries(EXPECTED)
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

    console.log(
      `PASS ${origin} serves ${payload.backendRelease} from ${payload.sourceCommit.slice(0, 8)} with ${payload.aiCouncilDefaultReaders}-${payload.aiCouncilMaxReaders} AI readers`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

const results = await Promise.allSettled(origins.map(fetchRelease));
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
