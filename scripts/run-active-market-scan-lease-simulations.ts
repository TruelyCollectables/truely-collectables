import {
  appendActiveMarketScanHistory,
  buildRunningActiveMarketScanLease,
  finishActiveMarketScanLease,
  inspectActiveMarketScanLease,
  isActiveMarketScanLeaseOwner,
  readActiveMarketScanLease,
  toActiveMarketScanHistoryEntry,
  type ActiveMarketScanLease,
} from "../src/lib/active-market-scan-lease";

type Scenario = {
  name: string;
  run: () => void;
};

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const now = new Date("2026-07-24T22:30:00.000Z");
const running = buildRunningActiveMarketScanLease({
  runId: "run-current",
  ownerAccountId: "seller-1",
  now,
  ttlMs: 5 * 60_000,
});

const scenarios: Scenario[] = [
  {
    name: "no lease allows acquisition",
    run() {
      const result = inspectActiveMarketScanLease({ metadata: {}, now });
      assert(result.canAcquire, "Expected acquisition without a lease");
      assert(result.reason === "no_valid_lease", "Expected no-valid-lease reason");
    },
  },
  {
    name: "active unexpired lease blocks duplicate scan",
    run() {
      const result = inspectActiveMarketScanLease({
        metadata: { active_market_scan_lease: running },
        now: new Date("2026-07-24T22:31:00.000Z"),
      });
      assert(!result.canAcquire, "Expected active lease to block");
      assert(result.reason === "scan_already_running", "Expected already-running reason");
      assert(result.remainingMs === 4 * 60_000, "Expected four minutes remaining");
    },
  },
  {
    name: "expired running lease recovers automatically",
    run() {
      const result = inspectActiveMarketScanLease({
        metadata: { active_market_scan_lease: running },
        now: new Date("2026-07-24T22:36:00.000Z"),
      });
      assert(result.canAcquire, "Expired lease should not block");
      assert(result.reason === "running_lease_expired", "Expected expired reason");
    },
  },
  {
    name: "completed lease never blocks a new scan",
    run() {
      const completed = finishActiveMarketScanLease({
        lease: running,
        status: "completed",
        now: new Date("2026-07-24T22:31:30.000Z"),
        responseStatus: 200,
        resultMode: "active_market_attack",
        evidenceReceipt: "receipt-1",
      });
      const result = inspectActiveMarketScanLease({
        metadata: { active_market_scan_lease: completed },
        now: new Date("2026-07-24T22:31:31.000Z"),
      });
      assert(result.canAcquire, "Completed lease should not block");
      assert(result.reason === "previous_scan_finished", "Expected finished reason");
    },
  },
  {
    name: "failed and superseded leases do not block",
    run() {
      for (const status of ["failed", "superseded"] as const) {
        const lease = finishActiveMarketScanLease({
          lease: running,
          status,
          now: new Date("2026-07-24T22:31:00.000Z"),
          responseStatus: status === "failed" ? 500 : 409,
        });
        assert(
          inspectActiveMarketScanLease({
            metadata: { active_market_scan_lease: lease },
            now: new Date("2026-07-24T22:31:01.000Z"),
          }).canAcquire,
          `${status} lease should not block`,
        );
      }
    },
  },
  {
    name: "lease ownership requires matching running run ID",
    run() {
      const metadata = { active_market_scan_lease: running };
      assert(
        isActiveMarketScanLeaseOwner(metadata, "run-current"),
        "Expected matching run to own lease",
      );
      assert(
        !isActiveMarketScanLeaseOwner(metadata, "run-other"),
        "Different run must not own lease",
      );
      const completed = finishActiveMarketScanLease({
        lease: running,
        status: "completed",
        now: new Date("2026-07-24T22:31:00.000Z"),
      });
      assert(
        !isActiveMarketScanLeaseOwner(
          { active_market_scan_lease: completed },
          "run-current",
        ),
        "Finished lease must not be treated as owned running work",
      );
    },
  },
  {
    name: "lease duration is recorded in audit history",
    run() {
      const completed = finishActiveMarketScanLease({
        lease: running,
        status: "completed",
        now: new Date("2026-07-24T22:31:45.000Z"),
        responseStatus: 200,
        resultMode: "active_market_scouting",
        evidenceReceipt: "receipt-2",
      });
      const history = toActiveMarketScanHistoryEntry(completed);
      assert(history.durationMs === 105_000, "Expected 105-second duration");
      assert(history.responseStatus === 200, "Expected response status");
      assert(history.evidenceReceipt === "receipt-2", "Expected receipt in history");
    },
  },
  {
    name: "history deduplicates run IDs and caps length",
    run() {
      const existing = Array.from({ length: 25 }, (_, index) => ({
        runId: `old-${index}`,
        status: "completed",
        ownerAccountId: "seller-1",
        startedAt: `2026-07-24T20:${String(index).padStart(2, "0")}:00.000Z`,
        completedAt: `2026-07-24T20:${String(index).padStart(2, "0")}:30.000Z`,
        durationMs: 30_000,
        responseStatus: 200,
        resultMode: "active_market_attack",
        evidenceReceipt: null,
        error: null,
      }));
      const completed = finishActiveMarketScanLease({
        lease: running,
        status: "completed",
        now: new Date("2026-07-24T22:31:00.000Z"),
      });
      const history = appendActiveMarketScanHistory({
        metadata: {
          active_market_scan_history: [
            ...existing,
            { ...toActiveMarketScanHistoryEntry(completed), responseStatus: 201 },
          ],
        },
        lease: completed,
        limit: 20,
      });
      assert(history.length === 20, "Expected capped history length");
      assert(history[0]?.runId === "run-current", "Newest run should be first");
      assert(
        history.filter((entry) => entry.runId === "run-current").length === 1,
        "Run ID must be deduplicated",
      );
    },
  },
  {
    name: "lease TTL is clamped to safe bounds",
    run() {
      const shortLease = buildRunningActiveMarketScanLease({
        runId: "short",
        ownerAccountId: "seller-1",
        now,
        ttlMs: 1,
      });
      const longLease = buildRunningActiveMarketScanLease({
        runId: "long",
        ownerAccountId: "seller-1",
        now,
        ttlMs: 60 * 60_000,
      });
      assert(
        new Date(shortLease.expiresAt).getTime() - now.getTime() === 60_000,
        "Minimum TTL should be one minute",
      );
      assert(
        new Date(longLease.expiresAt).getTime() - now.getTime() === 10 * 60_000,
        "Maximum TTL should be ten minutes",
      );
    },
  },
  {
    name: "malformed lease is ignored instead of permanently blocking",
    run() {
      const metadata = {
        active_market_scan_lease: {
          runId: "broken",
          status: "running",
          expiresAt: "not-a-date",
        },
      };
      assert(readActiveMarketScanLease(metadata) === null, "Malformed lease should be rejected");
      assert(
        inspectActiveMarketScanLease({ metadata, now }).canAcquire,
        "Malformed lease must not deadlock the card",
      );
    },
  },
];

const results: Array<{ name: string; status: "passed" | "failed"; error?: string }> = [];
for (const scenario of scenarios) {
  try {
    scenario.run();
    results.push({ name: scenario.name, status: "passed" });
  } catch (error) {
    results.push({
      name: scenario.name,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

for (const result of results) {
  console.log(
    `${result.status === "passed" ? "PASS" : "FAIL"} ${result.name}${
      result.error ? ` - ${result.error}` : ""
    }`,
  );
}

const failed = results.filter((result) => result.status === "failed");
console.log(
  `Active Market scan lease simulations: ${results.length - failed.length}/${results.length} passed.`,
);
if (failed.length) process.exitCode = 1;
