import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  parseDotEnv,
  prepareWorkerEnv,
  readDotEnvFile,
} from "./prepare-market-intel-worker-env.mjs";

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "tcos-worker-env-"));
const sourcePath = path.join(tempDirectory, ".env.local");
const targetPath = path.join(tempDirectory, ".env.market-intel-worker.local");

try {
  const fixture = [
    "\uFEFF# fixture with BOM and CRLF",
    'NEXT_PUBLIC_SUPABASE_URL="https://fixture.supabase.co"',
    "SUPABASE_SERVICE_ROLE_KEY='service role # kept'",
    "EBAY_CLIENT_ID=fixture-client # trailing comment",
    'EBAY_CLIENT_SECRET="secret with spaces and # hash"',
    "MARKET_INTEL_WORKER_MAX_IDENTITIES=2",
    "",
  ].join("\r\n");
  fs.writeFileSync(sourcePath, fixture);

  const parsed = parseDotEnv(fixture);
  assert.equal(parsed.get("NEXT_PUBLIC_SUPABASE_URL"), "https://fixture.supabase.co");
  assert.equal(parsed.get("SUPABASE_SERVICE_ROLE_KEY"), "service role # kept");
  assert.equal(parsed.get("EBAY_CLIENT_ID"), "fixture-client");
  assert.equal(parsed.get("EBAY_CLIENT_SECRET"), "secret with spaces and # hash");

  prepareWorkerEnv({
    targetPath,
    sourcePaths: [sourcePath],
    intervalMinutes: 15,
  });

  const normalized = readDotEnvFile(targetPath);
  assert.equal(normalized.get("SUPABASE_SERVICE_ROLE_KEY"), "service role # kept");
  assert.equal(normalized.get("EBAY_CLIENT_SECRET"), "secret with spaces and # hash");
  assert.equal(normalized.get("MARKET_INTEL_WORKER_MAX_IDENTITIES"), "2");
  assert.equal(normalized.get("MARKET_INTEL_WORKER_INTERVAL_MINUTES"), "15");

  const nativeLoad = spawnSync(
    process.execPath,
    [
      `--env-file=${targetPath}`,
      "-e",
      "process.stdout.write(JSON.stringify({url:process.env.NEXT_PUBLIC_SUPABASE_URL,key:process.env.SUPABASE_SERVICE_ROLE_KEY,secret:process.env.EBAY_CLIENT_SECRET}))",
    ],
    { encoding: "utf8" },
  );
  assert.equal(nativeLoad.status, 0, nativeLoad.stderr);
  assert.deepEqual(JSON.parse(nativeLoad.stdout), {
    url: "https://fixture.supabase.co",
    key: "service role # kept",
    secret: "secret with spaces and # hash",
  });

  console.log(
    JSON.stringify(
      {
        passed: true,
        parser: "tcos.marketIntel.workerEnv.v1",
        bom: true,
        crlf: true,
        quotedValues: true,
        spacesAndComments: true,
        shellSourcingUsed: false,
      },
      null,
      2,
    ),
  );
} finally {
  fs.rmSync(tempDirectory, { recursive: true, force: true });
}
