import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ALLOWED_ADVISORY = "https://github.com/advisories/GHSA-rgw5-rvv9-x895";
const SHIM_PATH = "vendor/brace-expansion-compat/index.cjs";
const SHIM_PACKAGE_PATH = "vendor/brace-expansion-compat/package.json";
const EXPECTED_SHIM_SHA256 = "c10e95c758408ccf4924698708c1087e6aaddb6324403e49ea2b1c7bef27507b";
const EXPECTED_PACKAGE_SHA256 = "785b02c3b2a08d2136ff3ea420218c4aaf6dc291b11d4e144efb0e329a3d91b9";

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function auditJson(args) {
  try {
    return JSON.parse(execFileSync("npm", ["audit", "--json", ...args], { encoding: "utf8" }));
  } catch (error) {
    const stdout = error?.stdout?.toString?.() ?? "";
    if (!stdout) throw error;
    return JSON.parse(stdout);
  }
}

function advisoryUrls(vulnerability) {
  const via = Array.isArray(vulnerability?.via) ? vulnerability.via : [];
  return via
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => entry.url)
    .filter(Boolean);
}

const production = auditJson(["--omit=dev", "--audit-level=moderate"]);
assert.equal(production.metadata?.vulnerabilities?.moderate ?? 0, 0, "Production dependency audit found moderate vulnerabilities");
assert.equal(production.metadata?.vulnerabilities?.high ?? 0, 0, "Production dependency audit found high vulnerabilities");
assert.equal(production.metadata?.vulnerabilities?.critical ?? 0, 0, "Production dependency audit found critical vulnerabilities");

const full = auditJson(["--audit-level=high"]);
const vulnerabilities = Object.entries(full.vulnerabilities ?? {});
const blocking = vulnerabilities.filter(([, vulnerability]) => {
  const severity = vulnerability?.severity;
  if (severity !== "high" && severity !== "critical") return false;
  return !advisoryUrls(vulnerability).includes(ALLOWED_ADVISORY);
});

assert.deepEqual(
  blocking.map(([name]) => name),
  [],
  `Unexpected high/critical dependency advisories: ${blocking.map(([name]) => name).join(", ")}`,
);

const allowedHigh = vulnerabilities.filter(([, vulnerability]) => {
  const severity = vulnerability?.severity;
  return (severity === "high" || severity === "critical") && advisoryUrls(vulnerability).includes(ALLOWED_ADVISORY);
});

if (allowedHigh.length > 0) {
  assert.equal(sha256(SHIM_PATH), EXPECTED_SHIM_SHA256, "Patched brace-expansion compatibility shim changed");
  assert.equal(sha256(SHIM_PACKAGE_PATH), EXPECTED_PACKAGE_SHA256, "Patched brace-expansion package metadata changed");

  const shimModule = await import(pathToFileURL(`${process.cwd()}/${SHIM_PATH}`).href);
  const expand = shimModule.default ?? shimModule;
  assert.equal(typeof expand, "function", "Patched brace-expansion shim does not export a function");
  assert.deepEqual(expand("a{b,c}d"), ["abd", "acd"]);

  const started = Date.now();
  const bounded = expand("{1..100}{1..100}");
  const elapsedMs = Date.now() - started;
  assert.ok(Array.isArray(bounded), "Patched brace expansion returned an invalid result");
  assert.ok(bounded.length <= 10000, `Patched brace expansion exceeded expected output bound: ${bounded.length}`);
  assert.ok(elapsedMs < 2000, `Patched brace expansion exceeded bounded execution time: ${elapsedMs}ms`);
}

console.log(JSON.stringify({
  ok: true,
  productionVulnerabilities: production.metadata?.vulnerabilities ?? {},
  acceptedAdvisory: allowedHigh.length > 0 ? ALLOWED_ADVISORY : null,
  acceptedPackages: allowedHigh.map(([name]) => name).sort(),
}, null, 2));
