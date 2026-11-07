const PROVIDER_BLOCK_PATTERNS = [
  {
    code: "OPENAI_CREDITS_EXHAUSTED",
    provider: "openai",
    pattern:
      /(?:insufficient_quota|billing_hard_limit_reached|exceeded your current quota|credit balance|credits? (?:are )?exhausted|add (?:more )?credits)/i,
  },
  {
    code: "PROVIDER_AUTHENTICATION_FAILED",
    provider: "unknown",
    pattern: /(?:invalid[_ -]?api[_ -]?key|incorrect api key|authentication failed)/i,
  },
  {
    code: "PROVIDER_RATE_LIMIT_BLOCKED",
    provider: "unknown",
    pattern: /(?:rate limit reached|too many requests)/i,
  },
];

function collectStrings(value, output = [], seen = new Set()) {
  if (value === null || value === undefined) return output;
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (typeof value !== "object" || seen.has(value)) return output;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, output, seen);
    return output;
  }
  for (const entry of Object.values(value)) collectStrings(entry, output, seen);
  return output;
}

function providerBlockEvidence(report) {
  const incomplete = Array.isArray(report?.incomplete) ? report.incomplete : [];
  const allResults = Array.isArray(report?.allResults) ? report.allResults : [];
  const source = incomplete.length ? incomplete : allResults;
  const evidence = [];

  source.forEach((result) => {
    const text = collectStrings(result).join(" | ");
    const match = PROVIDER_BLOCK_PATTERNS.find((candidate) => candidate.pattern.test(text));
    if (match) {
      evidence.push({
        caseId: String(result?.caseId || result?.requestedCase?.id || "unknown"),
        code: match.code,
        provider: match.provider,
      });
    }
  });

  return evidence;
}

export function classifyBenchmarkCertification(report) {
  const completed = Number(report?.summary?.completedCards || 0);
  const attempted = Number(report?.summary?.attemptedCases || 0);
  const requestedTarget = Number(report?.requestedTarget || 25);
  const evidence = providerBlockEvidence(report);
  const grouped = new Map();

  for (const item of evidence) {
    const key = `${item.code}:${item.provider}`;
    const current = grouped.get(key) || {
      code: item.code,
      provider: item.provider,
      cases: [],
    };
    current.cases.push(item.caseId);
    grouped.set(key, current);
  }

  const dominant = [...grouped.values()].sort(
    (left, right) => right.cases.length - left.cases.length,
  )[0];
  const systemicProviderBlock =
    completed === 0 &&
    attempted > 0 &&
    dominant &&
    dominant.cases.length >= Math.max(2, Math.ceil(attempted * 0.8));

  if (systemicProviderBlock) {
    return {
      status: "blocked",
      resultAvailable: false,
      code: dominant.code,
      provider: dominant.provider,
      blockedCases: dominant.cases.length,
      attemptedCases: attempted,
      completedCards: completed,
      requestedTarget,
      message:
        dominant.code === "OPENAI_CREDITS_EXHAUSTED"
          ? "Live accuracy certification was blocked because the OpenAI API account had no usable credits. No accuracy score was produced."
          : "Live accuracy certification was blocked by a systemic provider failure. No accuracy score was produced.",
    };
  }

  if (completed < requestedTarget) {
    return {
      status: "incomplete",
      resultAvailable: completed > 0,
      code: "INSUFFICIENT_COMPLETED_SAMPLE",
      provider: null,
      blockedCases: 0,
      attemptedCases: attempted,
      completedCards: completed,
      requestedTarget,
      message: `Benchmark completed ${completed}/${requestedTarget} required cards.`,
    };
  }

  return {
    status: "measured",
    resultAvailable: true,
    code: "ACCURACY_RESULT_AVAILABLE",
    provider: null,
    blockedCases: 0,
    attemptedCases: attempted,
    completedCards: completed,
    requestedTarget,
    message: `Benchmark produced a complete ${completed}-card accuracy result.`,
  };
}

export function applyBenchmarkCertification(report) {
  const certification = classifyBenchmarkCertification(report);
  report.certification = certification;
  report.summary = {
    ...(report.summary || {}),
    certificationStatus: certification.status,
    accuracyResultAvailable: certification.resultAvailable,
    certificationBlockCode:
      certification.status === "blocked" ? certification.code : null,
  };
  return report;
}

export function renderCertificationMarkdown(certification) {
  if (certification.status === "blocked") {
    return [
      "## Certification status",
      "",
      `**BLOCKED — ${certification.code}**`,
      "",
      certification.message,
      "",
      `Attempted cases: ${certification.attemptedCases}; completed cards: ${certification.completedCards}.`,
      "",
      "This is an infrastructure/provider result, not a scanner-accuracy score.",
      "",
    ].join("\n");
  }

  if (certification.status === "incomplete") {
    return [
      "## Certification status",
      "",
      "**INCOMPLETE SAMPLE**",
      "",
      certification.message,
      "",
    ].join("\n");
  }

  return [
    "## Certification status",
    "",
    "**ACCURACY RESULT AVAILABLE**",
    "",
    certification.message,
    "",
  ].join("\n");
}
