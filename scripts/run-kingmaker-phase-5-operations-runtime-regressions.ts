import assert from "node:assert/strict";
import {
  classifyKingmakerOpportunityAge,
  explainKingmakerDecision,
  runKingmakerAdapterFleet,
  type KingmakerAdapter,
} from "../src/lib/kingmaker-phase-5-operations-runtime";

assert.deepEqual(classifyKingmakerOpportunityAge("2026-08-03T04:30:00Z", "2026-08-03T05:00:00Z"), { age: "hot", ageHours: 0.5 });
assert.equal(classifyKingmakerOpportunityAge("2026-07-20T00:00:00Z", "2026-08-03T05:00:00Z").age, "dead");
assert.equal(classifyKingmakerOpportunityAge("bad", "2026-08-03T05:00:00Z").age, "dead");

const observation = {
  source: "ebay" as const,
  sourceRecordId: "listing-1",
  entityKey: "hockey:2025:upper-deck:ivan-demidov:young-guns:201:base:raw",
  observedAt: "2026-08-03T04:45:00Z",
  askingPrice: 20,
  shipping: 4,
  fees: 1,
  marketValue: 50,
  confidence: 0.92,
  sellerReliability: 94,
  riskScore: 10,
  momentumScore: 25,
  sourceUrl: "https://www.ebay.com/itm/1",
};

const explained = explainKingmakerDecision(observation, "2026-08-03T05:00:00Z");
assert.equal(explained.action, "buy_now");
assert.equal(explained.age, "hot");
assert.ok(explained.executionPriority > 100);
assert.match(explained.explanation.nextAction, /owner authorization/i);

const healthyAdapter: KingmakerAdapter = {
  source: "ebay",
  async run() {
    return {
      source: "ebay",
      startedAt: "2026-08-03T04:59:00Z",
      completedAt: "2026-08-03T05:00:00Z",
      scanned: 3,
      observations: [observation],
      rejected: 1,
      retries: 0,
      rateLimited: false,
    };
  },
};

const degradedAdapter: KingmakerAdapter = {
  source: "mercari",
  async run() {
    return {
      source: "mercari",
      startedAt: "2026-08-03T04:59:00Z",
      completedAt: "2026-08-03T05:00:00Z",
      scanned: 4,
      observations: [],
      rejected: 4,
      retries: 2,
      rateLimited: true,
    };
  },
};

const failedAdapter: KingmakerAdapter = {
  source: "poshmark",
  async run() {
    throw new Error("credentials_expired");
  },
};

const fleet = await runKingmakerAdapterFleet({
  adapters: [healthyAdapter, degradedAdapter, failedAdapter],
  now: "2026-08-03T05:00:00Z",
  timeoutMs: 100,
});

assert.equal(fleet.results.length, 3);
assert.equal(fleet.decisions.length, 1);
assert.equal(fleet.decisions[0].action, "buy_now");
assert.ok(fleet.events.some((event) => event.type === "source_degraded" && event.source === "mercari"));
assert.ok(fleet.events.some((event) => event.type === "source_offline" && event.source === "poshmark"));
assert.equal(fleet.results.find((result) => result.source === "poshmark")?.error, "credentials_expired");
assert.equal(fleet.fingerprint.length, 64);
assert.equal(new Set(fleet.events.map((event) => event.fingerprint)).size, fleet.events.length);

const timeoutFleet = await runKingmakerAdapterFleet({
  adapters: [{
    source: "comc",
    async run() {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        source: "comc",
        startedAt: "2026-08-03T05:00:00Z",
        completedAt: "2026-08-03T05:00:01Z",
        scanned: 0,
        observations: [],
        rejected: 0,
        retries: 0,
        rateLimited: false,
      };
    },
  }],
  now: "2026-08-03T05:00:00Z",
  timeoutMs: 1,
});

assert.equal(timeoutFleet.results[0].error, "adapter_timeout");
assert.ok(timeoutFleet.events.some((event) => event.type === "source_offline"));

console.log("KINGMAKER Phase 5 operations runtime regressions passed.");
