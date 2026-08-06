import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function requireText(source, value, message) {
  if (!source.includes(value)) throw new Error(message);
}

const orientation = read("src/lib/instacomp-image-orientation.ts");
requireText(
  orientation,
  "Use the direction of printed writing as the primary evidence",
  "Orientation must be based on printed writing.",
);
requireText(
  orientation,
  'image_url: { url: params.frontDataUrl, detail: "high" }',
  "Front orientation must use high-detail vision.",
);
requireText(
  orientation,
  "backStandalonePrizm: null",
  "Orientation must not make parallel decisions.",
);

const route = read(
  "src/app/api/kingmaker/instacomp-front-back-auto/route.ts",
);
requireText(
  route,
  "resolveChecklistParallelFromVision",
  "The scan route must constrain parallels to checklist identities.",
);
requireText(
  route,
  "Multiple checklist identities remain. Base was not assumed.",
  "Ambiguous cards must never default to Base.",
);
if (route.includes("no_prizm_on_back_forced_base")) {
  throw new Error("The obsolete no-PRIZM-on-back Base rule is still active.");
}

const config = read("next.config.ts");
requireText(
  config,
  'source: "/api/account/seller/inventory/instacomp-front-back"',
  "The old front/back endpoint must route through automatic orientation.",
);

const policy = read(
  "src/app/kingmaker/instacomp-audit/automatic-image-policy.tsx",
);
requireText(
  policy,
  'label.includes("Rotate left")',
  "Manual rotate controls must be removed from KINGMAKER.",
);
requireText(
  policy,
  "oriented automatically from printed card text",
  "KINGMAKER must explain automatic orientation.",
);

console.log(
  "Printed-text orientation and checklist-constrained parallel contract passed.",
);
