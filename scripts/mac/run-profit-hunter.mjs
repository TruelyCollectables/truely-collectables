#!/usr/bin/env node

/**
 * TCOS Profit Hunter Mac runner.
 *
 * Run with Node's react-server condition because the shared server modules use
 * Next's `server-only` marker. Example:
 *
 *   node --conditions=react-server --env-file=.env.local scripts/mac/run-profit-hunter.mjs
 */

const args = new Set(process.argv.slice(2));
const force = args.has("--force");
const perQueryArg = process.argv.find((value) => value.startsWith("--per-query="));
const perQuery = Math.max(
  5,
  Math.min(20, Number(perQueryArg?.split("=")[1] || 20) || 20),
);

// Allow the Mac worker to use a future isolated intelligence database without
// changing storefront environment variables. If the dedicated values are not
// configured yet, it uses the current server database settings.
if (process.env.TCOS_INTELLIGENCE_SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.TCOS_INTELLIGENCE_SUPABASE_URL;
  process.env.SUPABASE_URL = process.env.TCOS_INTELLIGENCE_SUPABASE_URL;
}
if (process.env.TCOS_INTELLIGENCE_SUPABASE_ANON_KEY) {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
    process.env.TCOS_INTELLIGENCE_SUPABASE_ANON_KEY;
}
if (process.env.TCOS_INTELLIGENCE_SUPABASE_SERVICE_ROLE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.TCOS_INTELLIGENCE_SUPABASE_SERVICE_ROLE_KEY;
}

const {
  getProfitHunterScheduleState,
  runProfitHunterServerCycle,
} = await import("../../src/lib/profit-hunter-server-run.js");

const schedule = getProfitHunterScheduleState();
if (!force && !schedule.allowed) {
  console.log(
    JSON.stringify({
      ok: true,
      skipped: true,
      code: "OUTSIDE_PROFIT_HUNTER_MOUNTAIN_SCHEDULE",
      schedule,
      executionPath: "mac_launchd",
    }),
  );
  process.exit(0);
}

const startedAt = Date.now();
try {
  const result = await runProfitHunterServerCycle({ perQuery });
  console.log(
    JSON.stringify(
      {
        ...result,
        executionPath: "mac_launchd",
        macPid: process.pid,
        wrapperDurationMs: Date.now() - startedAt,
      },
      null,
      2,
    ),
  );
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        code: "PROFIT_HUNTER_MAC_RUN_FAILED",
        executionPath: "mac_launchd",
        error: error instanceof Error ? error.stack || error.message : String(error),
        durationMs: Date.now() - startedAt,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
