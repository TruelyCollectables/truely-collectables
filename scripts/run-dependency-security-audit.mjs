import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ALLOWED_ADVISORY = "https://github.com/advisories/GHSA-rgw5-rvv9-x895";
const SHIM_PATH = "vendor/brace-expansion-compat/index.cjs";
const SHIM_PACKAGE_PATH = "vendor/brace-expansion-compat/package.json";
const EXPECTED_SHIM_SHA256 = "5dc7d661b096d6771f2622b21aaaf135a5f9eb4cf6a85a41b68344b73bb0f395";
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

function resolveAdvisoryUrls(name, vulnerabilities, visiting = new Set()) {
  if (visiting.has(name)) return new Set();
  const vulnerability = vulnerabilities[name];
  if (!vulnerability) return new Set();

  const nextVisiting = new Set(visiting);
  nextVisiting.add(name);
  const urls = new Set();
  for (const entry of Array.isArray(vulnerability.via) ? vulnerability.via : []) {
    if (typeof entry === "string") {
      for (const url of resolveAdvisoryUrls(entry, vulnerabilities, nextVisiting)) urls.add(url);
    } else if (entry && typeof entry === "object" && typeof entry.url === "string") {
      urls.add(entry.url);
    }
  }
  return urls;
}

const production = auditJson(["--omit=dev", "--audit-level=moderate"]);
assert.equal(production.metadata?.vulnerabilities?.moderate ?? 0, 0, "Production dependency audit found moderate vulnerabilities");
assert.equal(production.metadata?.vulnerabilities?.high ?? 0, 0, "Production dependency audit found high vulnerabilities");
assert.equal(production.metadata?.vulnerabilities?.critical ?? 0, 0, "Production dependency audit found critical vulnerabilities");

const full = auditJson(["--audit-level=high"]);
const vulnerabilityMap = full.vulnerabilities ?? {};
const highOrCritical = Object.entries(vulnerabilityMap).filter(([, vulnerability]) =>
  vulnerability?.severity === "high" || vulnerability?.severity === "critical",
);

const classified = highOrCritical.map(([name, vulnerability]) => {
  const urls = [...resolveAdvisoryUrls(name, vulnerabilityMap)].sort();
  return {
    name,
    severity: vulnerability.severity,
    urls,
    accepted: urls.length > 0 && urls.every((url) => url === ALLOWED_ADVISORY),
  };
});

const blocking = classified.filter((entry) => !entry.accepted);
assert.deepEqual(
  blocking.map((entry) => ({ name: entry.name, urls: entry.urls })),
  [],
  `Unexpected high/critical dependency advisories: ${blocking.map((entry) => `${entry.name}[${entry.urls.join(",") || "unresolved"}]`).join(", ")}`,
);

const acceptedPackages = classified.filter((entry) => entry.accepted).map((entry) => entry.name).sort();
if (acceptedPackages.length > 0) {
  assert.ok(acceptedPackages.includes("brace-expansion"), "Allowed advisory chain does not include brace-expansion");
  assert.equal(sha256(SHIM_PATH), EXPECTED_SHIM_SHA256, "Bounded brace-expansion compatibility shim changed");
  assert.equal(sha256(SHIM_PACKAGE_PATH), EXPECTED_PACKAGE_SHA256, "Brace-expansion package metadata changed");

  const shimModule = await import(pathToFileURL(`${process.cwd()}/${SHIM_PATH}`).href);
  const expand = shimModule.default ?? shimModule;
  assert.equal(typeof expand, "function", "Bounded brace-expansion shim does not export a function");
  assert.deepEqual(expand("a{b,c}d"), ["abd", "acd"]);
  assert.deepEqual(expand("{1..3}"), ["1", "2", "3"]);
  assert.throws(() => expand("{1..1001}"), /safe width/);
  assert.throws(() => expand("{1..101}{1..101}"), /safe output bound/);
  assert.throws(() => expand("x".repeat(4097)), /safe length/);

  const started = Date.now();
  assert.throws(() => expand("{1..1000}{1..1000}"), /safe output bound/);
  assert.ok(Date.now() - started < 250, "Hostile brace pattern was not rejected promptly");
}

console.log(JSON.stringify({
  ok: true,
  productionVulnerabilities: production.metadata?.vulnerabilities ?? {},
  acceptedAdvisory: acceptedPackages.length > 0 ? ALLOWED_ADVISORY : null,
  acceptedPackages,
  mitigation: acceptedPackages.length > 0 ? "bounded-and-hash-pinned-compatibility-shim" : null,
}, null, 2));
