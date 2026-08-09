import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, value) {
  fs.writeFileSync(path, value);
}

function replaceOnce(source, search, replacement, label) {
  const count = source.split(search).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${count}`);
  }
  return source.replace(search, replacement);
}

// Keep the raw Perplexity Search API request on its documented contract.
{
  const path = "src/lib/instacomp-teacher-market-provider.ts";
  let source = read(path);
  source = replaceOnce(
    source,
    '        search_context_size: "high",\n',
    "",
    "Perplexity raw Search API contract",
  );
  write(path, source);
}

// Send the complete outside-teacher receipt to the authenticated physical Mac
// after the website has durably retained the exact-market evidence. The bridge
// never controls the current InstaComp price and never mutates identity truth.
{
  const path = "src/app/api/instacomp/live-scan/route.ts";
  let source = read(path);
  source = replaceOnce(
    source,
    'import { getTeacherExactMarketProviders } from "../../../../lib/instacomp-teacher-market-provider";',
    'import { getTeacherExactMarketProviders } from "../../../../lib/instacomp-teacher-market-provider";\nimport { pushInstaCompTeacherReceipt } from "../../../../lib/instacomp-teacher-learning-bridge";',
    "Teacher learning bridge import",
  );

  const persistenceBlock = `  const persistence = await persistExactMarketSummary({
    scanId: base.scanId ? String(base.scanId) : null,
    query: exactTitle,
    suggestedPrice: summary.trustedSuggestedPrice,
    soldSearchUrl,
    exactMarketEvidence,
  });`;

  source = replaceOnce(
    source,
    persistenceBlock,
    `${persistenceBlock}

  const registryReceipt = ((base as any).checklistRegistry || {}) as Record<string, any>;
  const registryIdentityId = String(registryReceipt.identityId || "").trim() || null;
  const registryFingerprintSha256 =
    String(registryReceipt.fingerprintSha256 || "").trim() || null;
  const teacherTrusted = Boolean(
    teacher &&
      teacherSource.sold.results.length > 0 &&
      registryReceipt.matched === true &&
      registryIdentityId &&
      registryFingerprintSha256,
  );
  const teacherLearning = teacher
    ? await pushInstaCompTeacherReceipt({
        schemaVersion: "tcos.instacomp.teacher-comp-receipt.v1",
        source: "instacomp",
        scanId: base.scanId ? String(base.scanId) : null,
        registryIdentityId,
        registryFingerprintSha256,
        canonicalIdentity: ai as unknown as Record<string, unknown>,
        teacherConsensus: {
          configuredTeachers: teacher.configuredTeachers,
          requiredVotes: teacher.requiredVotes,
          trusted: teacherTrusted,
          attempts: teacher.attempts,
        },
        acceptedSoldComps: teacherSource.sold.results,
        discoverySoldComps: teacher.discovery.sold,
        discoveryActiveComps: teacher.discovery.active,
        trustedSuggestedPrice: teacherTrusted ? summary.trustedSuggestedPrice : null,
        pricingEligibleSoldCount: teacherTrusted
          ? teacherSource.sold.results.length
          : 0,
        studentMode: true,
        pricingAuthority: false,
        identityTrainingMutationAllowed: false,
        createdAt: new Date().toISOString(),
      })
    : {
        status: "skipped" as const,
        receiptId: null,
        trustedMarketTruth: false,
        studentTrainingEligible: false,
        pricingAuthority: false as const,
        identityTrainingMutated: false as const,
        reason: "No outside teacher run was available to teach InstaComp AI.",
      };`,
    "Persist teacher receipt to InstaComp AI",
  );

  source = replaceOnce(
    source,
    `      providerMessages,
      teacherConsensus: teacher`,
    `      providerMessages,
      teacherLearning,
      teacherConsensus: teacher`,
    "Expose teacher learning receipt with exact market",
  );

  source = replaceOnce(
    source,
    `      persistence,
      legacyProviderSummary:`,
    `      persistence,
      teacherLearning,
      legacyProviderSummary:`,
    "Expose teacher learning diagnostics",
  );

  write(path, source);
}

console.log("Applied InstaComp teacher learning bridge and provider contract fixes.");
