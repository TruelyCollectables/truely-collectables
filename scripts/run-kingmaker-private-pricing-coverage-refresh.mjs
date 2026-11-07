import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const RECEIPT_SCHEMA =
  "tcos.kingmaker.privatePricingCoverageRefreshReceipt.v2";

function parseEnv(contents) {
  const parsed = {};
  for (const raw of String(contents || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim().replace(/^export\s+/, "");
    let value = line.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.slice(1, -1);
      }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    parsed[key] = value;
  }
  return parsed;
}

function projectRef(url) {
  const match = String(url || "").match(
    /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i,
  );
  if (!match) throw new Error("Production database URL was not resolved.");
  return match[1];
}

async function queryManagement({ project, token, query, readOnly, stage }) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${project}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
      signal: AbortSignal.timeout(119_000),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Coverage ${stage} failed with HTTP ${response.status}: ${text.slice(0, 600)}`,
    );
  }
  return text ? JSON.parse(text) : [];
}

function firstRow(result) {
  return Array.isArray(result) ? result[0] || {} : result || {};
}

function firstValue(result) {
  const row = firstRow(result);
  return Object.values(row)[0];
}

function jsonObject(value, label) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  }
  throw new Error(`${label} did not return an object.`);
}

function baseRefreshSql(force) {
  return `
    set statement_timeout = '110s';
    set role service_role;
    select public.tcos_refresh_kingmaker_private_pricing_coverage_snapshot(
      ${force ? "true" : "false"}
    ) as result;
  `;
}

function attackRefreshSql(force) {
  return `
    set statement_timeout = '30s';
    set role service_role;
    select public.tcos_refresh_kingmaker_private_pricing_attack_queue(
      ${force ? "true" : "false"}
    ) as result;
  `;
}

function reportSql() {
  return `
    set statement_timeout = '15s';
    set role service_role;
    select public.tcos_kingmaker_private_pricing_coverage_report(
      10,
      0,
      null,
      null,
      null
    ) as result;
  `;
}

async function main() {
  const envFile = process.env.PRODUCTION_ENV_FILE;
  const token =
    process.env.GH_SUPABASE_ACCESS_TOKEN || process.env.SUPABASE_ACCESS_TOKEN;
  const receiptPath = resolve(
    process.env.RECEIPT_PATH ||
      "evidence/kingmaker-private-pricing-coverage-refresh/receipt.json",
  );
  const force = process.env.KINGMAKER_COVERAGE_FORCE_REFRESH === "true";

  if (!envFile || !token) {
    throw new Error("Protected Production credentials are required.");
  }
  console.log(`::add-mask::${token}`);

  const productionEnv = parseEnv(readFileSync(envFile, "utf8"));
  const productionUrl =
    productionEnv.NEXT_PUBLIC_SUPABASE_URL || productionEnv.SUPABASE_URL;
  const project = projectRef(productionUrl);

  const baseRefresh = jsonObject(
    firstValue(
      await queryManagement({
        project,
        token,
        query: baseRefreshSql(force),
        readOnly: false,
        stage: "base snapshot refresh",
      }),
    ),
    "Base coverage refresh",
  );

  if (!["succeeded", "idle", "busy"].includes(baseRefresh.status)) {
    throw new Error(
      `Base coverage refresh returned ${String(baseRefresh.status || "unknown")}.`,
    );
  }

  const attackRefresh = jsonObject(
    firstValue(
      await queryManagement({
        project,
        token,
        query: attackRefreshSql(
          force || baseRefresh.status === "succeeded",
        ),
        readOnly: false,
        stage: "quality firewall refresh",
      }),
    ),
    "Quality firewall refresh",
  );

  if (!["succeeded", "idle", "busy"].includes(attackRefresh.status)) {
    throw new Error(
      `Quality firewall refresh returned ${String(attackRefresh.status || "unknown")}.`,
    );
  }

  const report = jsonObject(
    firstValue(
      await queryManagement({
        project,
        token,
        query: reportSql(),
        readOnly: false,
        stage: "quality-ranked snapshot verification",
      }),
    ),
    "Coverage report",
  );
  if (report.boundary !== "aggregate_private_reference_only") {
    throw new Error("Coverage report boundary verification failed.");
  }

  const receipt = {
    schema: RECEIPT_SCHEMA,
    status: "passed",
    generatedAt: new Date().toISOString(),
    baseRefresh,
    attackRefresh,
    snapshot: report.snapshot,
    summary: report.summary,
    topRows: report.rows,
    pricesPromotedByThisOperation: 0,
    recordsMutatedOutsideSnapshots: 0,
    secretsPersisted: false,
  };

  const serialized = JSON.stringify(receipt).toLowerCase();
  for (const forbidden of [
    "raw_text",
    "original_filename",
    "source_sha256",
    "value_low",
    "value_high",
    "storage_object_path",
  ]) {
    if (serialized.includes(forbidden)) {
      throw new Error(`Coverage receipt contains prohibited field ${forbidden}.`);
    }
  }

  mkdirSync(dirname(receiptPath), { recursive: true });
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(
    `Private pricing coverage ${attackRefresh.status}: ${Number(report.summary?.actionableRows || 0)} actionable rows, ${Number(report.summary?.parserReviewRows || 0)} parser-review rows.`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
