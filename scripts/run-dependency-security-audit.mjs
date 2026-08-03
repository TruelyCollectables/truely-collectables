import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ALLOWED_ADVISORY = "https://github.com/advisories/GHSA-rgw5-rvv9-x895";
const SHIM_PATH = "vendor/brace-expansion-compat/index.cjs";
const SHIM_PACKAGE_PATH = "vendor/brace-expansion-compat/package.json";
const EXPECTED_SHIM_SHA256 = "6a1b20f886fb373aedb76730649edac36585ad5bca69f2ba733ab8c166696eff";
const EXPECTED_PACKAGE_SHA256 = "31b91457b9c2b41e28736041bbc11e12b383249f8180864d01576fcd94573bb6";

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
  const urls = advisoryUrls(vulnerability);
  return !urls.includes(ALLOWED_ADVISORY);
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
  const bounded = expand("{1..1000}{1..1000}");
  const elapsedMs = Date.now() - started;
  assert.ok(Array.isArray(bounded), "Patched brace expansion returned an invalid result");
  assert.ok(elapsedMs < 2000, `Patched brace expansion exceeded bounded execution time: ${elapsedMs}ms`);
}

console.log(JSON.stringify({
  ok: true,
  productionVulnerabilities: production.metadata?.vulnerabilities ?? {},
  acceptedAdvisory: allowedHigh.length > 0 ? ALLOWED_ADVISORY : null,
  acceptedPackages: allowedHigh.map(([name]) => name).sort(),
}, null, 2));
