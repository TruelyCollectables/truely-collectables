import assert from "node:assert/strict";
import {
  applyBenchmarkCertification,
  classifyBenchmarkCertification,
  renderCertificationMarkdown,
} from "./instacomp-benchmark-certification.mjs";

function report({ completed = 0, attempted = 4, target = 25, results = [] } = {}) {
  return {
    requestedTarget: target,
    summary: {
      attemptedCases: attempted,
      completedCards: completed,
      passRate: completed ? 96 : 0,
    },
    incomplete: results,
    allResults: results,
  };
}

const quotaResults = Array.from({ length: 4 }, (_, index) => ({
  caseId: `quota-${index + 1}`,
  ok: false,
  status: "scan_error",
  error: {
    provider: "openai",
    code: "insufficient_quota",
    message: "You exceeded your current quota. Please add credits.",
  },
}));
const quota = applyBenchmarkCertification(
  report({ attempted: 4, results: quotaResults }),
);
assert.equal(quota.certification.status, "blocked");
assert.equal(quota.certification.resultAvailable, false);
assert.equal(quota.certification.code, "OPENAI_CREDITS_EXHAUSTED");
assert.equal(quota.summary.accuracyResultAvailable, false);
assert.equal(quota.summary.certificationStatus, "blocked");
assert.match(
  renderCertificationMarkdown(quota.certification),
  /not a scanner-accuracy score/i,
);

const isolatedRateLimit = classifyBenchmarkCertification(
  report({
    completed: 2,
    attempted: 4,
    results: [
      {
        caseId: "rate-limit-one",
        error: "Rate limit reached. Too many requests.",
      },
      { caseId: "other", error: "No defensible two-image listing." },
    ],
  }),
);
assert.equal(isolatedRateLimit.status, "incomplete");
assert.equal(isolatedRateLimit.resultAvailable, true);
assert.equal(isolatedRateLimit.code, "INSUFFICIENT_COMPLETED_SAMPLE");

const genuineLowAccuracy = applyBenchmarkCertification({
  requestedTarget: 25,
  summary: {
    attemptedCases: 25,
    completedCards: 25,
    passedCards: 5,
    passRate: 20,
  },
  completed: Array.from({ length: 25 }, (_, index) => ({
    caseId: `measured-${index + 1}`,
    grade: { score: 70, pass: index < 5 },
  })),
  incomplete: [],
  allResults: [],
});
assert.equal(genuineLowAccuracy.certification.status, "measured");
assert.equal(genuineLowAccuracy.certification.resultAvailable, true);
assert.equal(genuineLowAccuracy.summary.passRate, 20);
assert.equal(genuineLowAccuracy.summary.certificationBlockCode, null);

const authResults = Array.from({ length: 3 }, (_, index) => ({
  caseId: `auth-${index + 1}`,
  error: "Authentication failed: invalid API key.",
}));
const auth = classifyBenchmarkCertification(
  report({ attempted: 3, results: authResults }),
);
assert.equal(auth.status, "blocked");
assert.equal(auth.code, "PROVIDER_AUTHENTICATION_FAILED");
assert.equal(auth.resultAvailable, false);

console.log(
  JSON.stringify(
    {
      ok: true,
      quota: quota.certification,
      isolatedRateLimit,
      measured: genuineLowAccuracy.certification,
      auth,
    },
    null,
    2,
  ),
);
