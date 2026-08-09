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

function replaceRegexOnce(source, regex, replacement, label) {
  const matches = source.match(new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`)) || [];
  if (matches.length !== 1) {
    throw new Error(`${label}: expected exactly one regex match, found ${matches.length}`);
  }
  return source.replace(regex, replacement);
}

// 1) Deal Hunter must not force the zero-reader local fast lane while InstaComp AI is a student.
{
  const path = "src/app/api/instacomp/deal-hunter/evaluate/core.ts";
  let source = read(path);
  source = replaceOnce(
    source,
    'internalForm.set("aiCouncilTier", "basic");',
    'internalForm.set("aiCouncilTier", "adaptive");',
    "Deal Hunter adaptive teacher identity tier",
  );
  write(path, source);
}

// 2) Perplexity Search is discovery/corroboration only until sold date + shipping are explicitly proven.
{
  const path = "src/lib/instacomp-teacher-market-provider.ts";
  let source = read(path);
  source = replaceRegexOnce(
    source,
    /async function runPerplexity\(exactTitle: string\): Promise<TeacherAttempt> \{[\s\S]*?\n\}\n\nfunction toComp/,
    `async function runPerplexity(exactTitle: string): Promise<TeacherAttempt> {
  if (!PERPLEXITY_API_KEY) {
    return { teacher: "perplexity", configured: false, ok: false, sold: [], active: [], notes: "", error: null };
  }
  try {
    const response = await fetch("https://api.perplexity.ai/search", {
      method: "POST",
      headers: {
        Authorization: \`Bearer \${PERPLEXITY_API_KEY}\`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: \`\${exactTitle} eBay sold completed\`,
        max_results: 20,
        search_context_size: "high",
        country: "US",
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(clean(payload?.error?.message) || \`Perplexity HTTP \${response.status}\`);
    }
    const resultCount = Array.isArray(payload?.results) ? payload.results.length : 0;
    return {
      teacher: "perplexity",
      configured: true,
      ok: true,
      sold: [],
      active: [],
      notes: \`Perplexity Search returned \${resultCount} discovery result\${resultCount === 1 ? "" : "s"}; it is corroboration-only until exact sold date and shipping are explicitly proven.\`,
      error: null,
    };
  } catch (error) {
    return {
      teacher: "perplexity",
      configured: true,
      ok: false,
      sold: [],
      active: [],
      notes: "",
      error: sanitizeInstaCompProviderError(error instanceof Error ? error.message : String(error)),
    };
  }
}

function toComp`,
    "Perplexity discovery-only policy",
  );
  source = replaceOnce(
    source,
    `  const configuredTeachers = attempts
    .filter((attempt) => attempt.configured)
    .map((attempt) => attempt.teacher);
  const requiredVotes = requiredTeacherVotes(configuredTeachers.length);`,
    `  const votingAttempts = attempts.filter((attempt) => attempt.teacher !== "perplexity");
  const configuredTeachers = votingAttempts
    .filter((attempt) => attempt.configured)
    .map((attempt) => attempt.teacher);
  const requiredVotes = requiredTeacherVotes(configuredTeachers.length);`,
    "Perplexity excluded from trusted vote count",
  );
  source = replaceOnce(
    source,
    "  const sold = consensusSold(attempts, params.ai, requiredVotes);",
    "  const sold = consensusSold(votingAttempts, params.ai, requiredVotes);",
    "Trusted consensus uses voting teachers only",
  );
  source = replaceOnce(
    source,
    "    .filter((row): row is InstaCompComp => Boolean(row))",
    "    .filter((row): row is NonNullable<typeof row> => Boolean(row))",
    "Teacher consensus nullable row narrowing",
  );
  write(path, source);
}

// 3) InstaComp itself uses outside teacher consensus first. OpenAI web is fallback, SerpApi is last fallback.
{
  const path = "src/app/api/instacomp/live-scan/route.ts";
  let source = read(path);
  source = replaceOnce(
    source,
    'import { getOpenAiExactEbayMarketProviders } from "../../../../lib/instacomp-openai-web-market-provider";',
    'import { getOpenAiExactEbayMarketProviders } from "../../../../lib/instacomp-openai-web-market-provider";\nimport { getTeacherExactMarketProviders } from "../../../../lib/instacomp-teacher-market-provider";',
    "Teacher provider import",
  );

  source = replaceRegexOnce(
    source,
    /  const \[serpSettled, openAiSettled\] = await Promise\.allSettled\(\[[\s\S]*?\n  const officialEbayActive =/,
    `  let teacher: Awaited<ReturnType<typeof getTeacherExactMarketProviders>> | null = null;
  let teacherFailure: string | null = null;
  try {
    teacher = await getTeacherExactMarketProviders({ exactTitle, ai });
  } catch (error) {
    teacherFailure = sanitizeInstaCompProviderError(
      error instanceof Error ? error.message : String(error),
    );
  }
  const teacherSource: InstaCompExactMarketSource = teacher
    ? { sold: teacher.sold, active: teacher.active }
    : {
        sold: providerError({
          source: "teacher_consensus_exact_sold",
          label: "Outside AI Teacher Consensus Sold",
          message: teacherFailure || "Outside teacher market search failed.",
        }),
        active: providerError({
          source: "teacher_discovery_active",
          label: "Outside AI Teacher Active Discovery",
          message: teacherFailure || "Outside teacher market search failed.",
        }),
      };

  let openAi: Awaited<ReturnType<typeof getOpenAiExactEbayMarketProviders>> | null = null;
  let openAiFailure: string | null = null;
  if (!teacherSource.sold.results.length) {
    try {
      openAi = await getOpenAiExactEbayMarketProviders({ exactTitle, ai });
    } catch (error) {
      openAiFailure = sanitizeInstaCompProviderError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const openAiSource: InstaCompExactMarketSource = openAi
    ? { sold: openAi.sold, active: openAi.active }
    : {
        sold: providerError({
          source: "openai_web_ebay_sold_exact",
          label: "eBay Sold via OpenAI Web",
          message: teacherSource.sold.results.length
            ? "Skipped because outside teacher consensus already supplied trusted exact sold evidence."
            : openAiFailure || "OpenAI exact sold provider failed or was unavailable.",
        }),
        active: providerError({
          source: "openai_web_ebay_active_exact",
          label: "eBay Active via OpenAI Web",
          message: teacherSource.sold.results.length
            ? "Skipped because outside teacher consensus already supplied trusted exact sold evidence."
            : openAiFailure || "OpenAI exact active provider failed or was unavailable.",
        }),
      };

  let serp: Awaited<ReturnType<typeof getExactEbayMarketProviders>> | null = null;
  let serpFailure: string | null = null;
  if (!teacherSource.sold.results.length && !openAiSource.sold.results.length) {
    try {
      serp = await getExactEbayMarketProviders({
        exactTitle,
        fallbackQuery: base.searchQuery || exactTitle,
        ai,
      });
    } catch (error) {
      serpFailure = sanitizeInstaCompProviderError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const serpSource: InstaCompExactMarketSource = serp
    ? { sold: serp.sold, active: serp.active }
    : {
        sold: providerError({
          source: "ebay_sold_serpapi_exact",
          label: "eBay Sold",
          message:
            teacherSource.sold.results.length || openAiSource.sold.results.length
              ? "SerpApi held as last fallback and was not called."
              : serpFailure || "SerpApi sold provider failed or was unavailable.",
        }),
        active: providerError({
          source: "ebay_active_serpapi_exact",
          label: "eBay Active",
          message:
            teacherSource.sold.results.length || openAiSource.sold.results.length
              ? "SerpApi held as last fallback and was not called."
              : serpFailure || "SerpApi active provider failed or was unavailable.",
        }),
      };

  const officialEbayActive =`,
    "Teacher-first market fallback chain",
  );

  source = replaceOnce(
    source,
    `  const summary = mergeExactMarketSources([
    verifiedSerpSource,
    verifiedOfficialActiveSource,
  ]);`,
    `  const summary = mergeExactMarketSources([
    teacherSource,
    verifiedSerpSource,
    verifiedOfficialActiveSource,
  ]);`,
    "Teacher consensus enters trusted market summary",
  );

  source = replaceOnce(
    source,
    `  const exactProviders = [
    verifiedSerpSource.sold,
    verifiedSerpSource.active,
    verifiedOfficialActiveSource.active,
    openAiSource.sold,
    openAiSource.active,
  ];`,
    `  const exactProviders = [
    teacherSource.sold,
    teacherSource.active,
    verifiedSerpSource.sold,
    verifiedSerpSource.active,
    verifiedOfficialActiveSource.active,
    openAiSource.sold,
    openAiSource.active,
  ];`,
    "Teacher provider diagnostics exposed",
  );

  source = replaceOnce(
    source,
    `    discoveryCandidates: {
      sold: openAiSource.sold.results.slice(0, 10),
      active: openAiSource.active.results.slice(0, 10),
    },`,
    `    teacherConsensus: teacher
      ? {
          configuredTeachers: teacher.configuredTeachers,
          requiredVotes: teacher.requiredVotes,
          attempts: teacher.attempts,
        }
      : null,
    discoveryCandidates: {
      sold: [
        ...(teacher?.discovery.sold || []),
        ...openAiSource.sold.results,
      ].slice(0, 20),
      active: [
        ...(teacher?.discovery.active || []),
        ...openAiSource.active.results,
      ].slice(0, 20),
    },`,
    "Teacher receipt persisted in exact market evidence",
  );

  source = replaceOnce(
    source,
    `      discoveryCandidates: {
        sold: openAiSource.sold.results,
        active: openAiSource.active.results,
        trustedForPricing: false,
      },`,
    `      teacherConsensus: teacher
        ? {
            configuredTeachers: teacher.configuredTeachers,
            requiredVotes: teacher.requiredVotes,
            attempts: teacher.attempts,
          }
        : null,
      discoveryCandidates: {
        sold: [
          ...(teacher?.discovery.sold || []),
          ...openAiSource.sold.results,
        ],
        active: [
          ...(teacher?.discovery.active || []),
          ...openAiSource.active.results,
        ],
        trustedForPricing: false,
      },`,
    "Teacher receipt returned to InstaComp caller",
  );

  source = replaceOnce(
    source,
    `        serpApi: {
          soldStatus: serpSource.sold.status,`,
    `        teachers: teacher
          ? {
              configuredTeachers: teacher.configuredTeachers,
              requiredVotes: teacher.requiredVotes,
              attempts: teacher.attempts,
              trustedSoldCount: teacher.sold.results.length,
            }
          : {
              configuredTeachers: [],
              requiredVotes: 2,
              attempts: [],
              trustedSoldCount: 0,
              error: teacherFailure,
            },
        serpApi: {
          soldStatus: serpSource.sold.status,`,
    "Teacher diagnostics returned",
  );

  write(path, source);
}

console.log("Applied InstaComp outside-teacher comp mode patch.");
