import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const workflow = read(".github/workflows/automatic-checklist-discovery.yml");
const updater = read("scripts/discover-and-import-checklists.ts");
const discovery = read("scripts/discover-official-checklists.ts");
const policy = JSON.parse(read("data/official-checklist-manufacturers.json"));
const documentation = read("docs/checklists/official-manufacturer-update-policy.md");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  policy.schema === "tcos.officialManufacturerChecklistPolicy.v1",
  "Wrong official manufacturer policy schema.",
);
assert(
  policy.policy === "new_release_updates_official_manufacturer_only",
  "New-release update policy must be manufacturer-only.",
);
assert(
  Array.isArray(policy.manufacturers) && policy.manufacturers.length >= 8,
  "Expected at least eight configured manufacturer families.",
);

const ids = new Set(policy.manufacturers.map((row) => row.id));
for (const required of [
  "topps",
  "panini",
  "upper-deck",
  "leaf",
  "pokemon",
  "konami-yugioh",
  "wizards-magic",
  "ravensburger-lorcana",
]) {
  assert(ids.has(required), `Missing manufacturer policy: ${required}`);
}

const universes = new Set(
  policy.manufacturers.flatMap((row) => row.universes || []),
);
for (const required of [
  "baseball",
  "hockey",
  "entertainment",
  "non-sport",
  "stickers",
  "pokemon",
  "magic-the-gathering",
  "yu-gi-oh",
  "lorcana",
]) {
  assert(universes.has(required), `Missing declared update universe: ${required}`);
}

for (const manufacturer of policy.manufacturers) {
  assert(manufacturer.name, `${manufacturer.id} has no display name.`);
  assert(manufacturer.seedPath, `${manufacturer.id} has no seed path.`);
  assert(
    Array.isArray(manufacturer.startUrls) && manufacturer.startUrls.length > 0,
    `${manufacturer.id} has no official discovery entrypoint.`,
  );
  assert(
    Array.isArray(manufacturer.officialHosts) &&
      manufacturer.officialHosts.length > 0,
    `${manufacturer.id} has no official host allowlist.`,
  );
  assert(
    manufacturer.registryMode === "validate_and_import_supported",
    `${manufacturer.id} may not bypass validation-first Registry imports.`,
  );
}

assert(
  /cron:\s*"17 11 \* \* \*"/.test(workflow),
  "Official manufacturer updater must run once every 24 hours.",
);
assert(
  workflow.includes("environment: Production"),
  "Scheduled apply job must use the protected Production environment.",
);
assert(
  workflow.includes("CHECKLIST_DISCOVERY_AUTO_IMPORT"),
  "Workflow is missing the explicit apply/validate gate.",
);
assert(
  workflow.includes("discover-official-checklists.ts"),
  "Workflow must run official manufacturer discovery first.",
);
assert(
  workflow.includes("discover-and-import-checklists.ts"),
  "Workflow must run the Registry updater.",
);

for (const required of [
  'authority: "official_manufacturer"',
  "response.url",
  "hostAllowed(finalParsed.hostname",
  "source_sha256",
  "importChecklistArtifact",
  "validateOnly: true",
  'status: "quarantined"',
  'status: "imported"',
  "archiveContent",
  "official_source_card_count_regression",
]) {
  assert(updater.includes(required), `Updater is missing required contract: ${required}`);
}

for (const required of [
  "tcos.officialManufacturerChecklistPolicy.v1",
  "officialHosts",
  "crawlHosts",
  "Redirected outside official host allowlist",
  "CHECKLIST_DISCOVERY_MANUFACTURERS",
]) {
  assert(discovery.includes(required), `Discovery is missing required contract: ${required}`);
}

const forbiddenAutomaticSources = [
  "beckett",
  "cardboardconnection",
  "cardboard checklist",
  "gogts",
  "keyman",
  "sportscardradio",
  "baseballcardpedia",
  "tcdb",
];
const automaticSurface = `${workflow}\n${updater}\n${discovery}`.toLowerCase();
for (const forbidden of forbiddenAutomaticSources) {
  assert(
    !automaticSurface.includes(forbidden),
    `Automatic live updater references a non-manufacturer source: ${forbidden}`,
  );
}

assert(
  documentation.includes("Public aggregators") &&
    documentation.includes(
      "are not permitted to create or replace a live Checklist Registry version",
    ),
  "Documentation must block public aggregators from live automatic updates.",
);
assert(
  documentation.includes("same versioned `checklist_*` Registry"),
  "Documentation must preserve one database for every universe.",
);

console.log(
  JSON.stringify(
    {
      ok: true,
      schema: "tcos.checklist.officialManufacturerUpdateSimulation.v1",
      manufacturers: policy.manufacturers.length,
      universes: [...universes].sort(),
      schedule: "every_24_hours",
      liveSourcePolicy: "official_manufacturer_only",
      unsupportedBehavior: "quarantine_without_replacing_live_version",
    },
    null,
    2,
  ),
);
