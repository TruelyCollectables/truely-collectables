#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

const BATCH001_IDS = new Set([
  "batch-001-card-01",
  "batch-001-card-02",
  "batch-001-card-03",
  "batch-001-card-04",
  "batch-001-card-05",
  "batch-001-card-06",
]);

const REQUIRED_TRUE_FIELDS = [
  "manufacturer_known",
  "card_number_known",
  "base_or_insert_known",
  "exact_variant_known",
  "raw_or_graded_known",
  "product_line_known",
  "release_year_known",
  "signer_known_if_auto",
  "memorabilia_known_if_relic",
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function asText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asNonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseArgs(argv) {
  const args = {
    file: "",
    apply: false,
    sourceName: "",
    replaceSource: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === "--file") {
      args.file = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (current === "--apply") {
      args.apply = true;
      continue;
    }

    if (current === "--source-name") {
      args.sourceName = argv[index + 1] || "";
      index += 1;
      continue;
    }

    if (current === "--replace-source") {
      args.replaceSource = true;
      continue;
    }

    if (!current.startsWith("-") && !args.file) {
      args.file = current;
      continue;
    }

    fail(`Unknown argument: ${current}`);
  }

  if (!args.file) {
    fail(
      "Usage: npm run import:verified-reference:batch001 -- --file /absolute/path/to/batch001.json [--apply] [--source-name name] [--replace-source]",
    );
  }

  return args;
}

function validateBatch(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail("Verified reference payload must be a JSON object.");
  }

  const cards = Array.isArray(payload.cards) ? payload.cards : [];
  if (cards.length !== 6) {
    fail(`Batch 001 must contain exactly 6 cards; found ${cards.length}.`);
  }

  const seen = new Set();
  const errors = [];
  const cardsById = new Map();

  for (const card of cards) {
    const id = asText(card?.id);
    if (!BATCH001_IDS.has(id)) {
      errors.push(`Unexpected card id: ${id || "missing"}`);
      continue;
    }

    if (seen.has(id)) {
      errors.push(`Duplicate card id: ${id}`);
      continue;
    }
    seen.add(id);
    cardsById.set(id, card);

    for (const field of [
      "player_or_subject",
      "year",
      "manufacturer",
      "brand",
      "product_line",
      "set_name",
      "card_number",
      "parallel",
      "condition",
      "raw_or_graded",
      "exact_card_fingerprint",
    ]) {
      if (!asText(card?.[field])) errors.push(`${id}: missing ${field}`);
    }

    for (const field of REQUIRED_TRUE_FIELDS) {
      if (card?.[field] !== true) errors.push(`${id}: ${field} must be true`);
    }

    if (asText(card?.raw_or_graded) === "graded") {
      for (const field of ["grading_company", "grade"]) {
        if (!asText(card?.[field])) errors.push(`${id}: graded card missing ${field}`);
      }
    }

    if (card?.autographed === true && !asText(card?.signer)) {
      errors.push(`${id}: autographed card missing signer`);
    }

    if (card?.memorabilia === true && !asText(card?.memorabilia_type)) {
      errors.push(`${id}: memorabilia card missing memorabilia_type`);
    }

    if (card?.serial_numbered === true && asNonNegativeNumber(card?.serial_denominator) === null) {
      errors.push(`${id}: serial-numbered card missing serial_denominator`);
    }

    if (card?.serial_numbered !== true && card?.serial_denominator != null) {
      errors.push(`${id}: non-numbered card must not include serial_denominator`);
    }
  }

  for (const id of BATCH001_IDS) {
    if (!seen.has(id)) errors.push(`Missing required Batch 001 card: ${id}`);
  }

  if (errors.length > 0) {
    fail(`Verified reference validation failed:\n- ${errors.join("\n- ")}`);
  }

  const sourceName =
    asText(payload.source_name) || asText(payload.sourceName) || "batch-001-verified-reference";
  const sourceVersion = asText(payload.source_version) || asText(payload.sourceVersion) || "1";
  const referenceUrl = asText(payload.reference_url) || asText(payload.referenceUrl) || null;
  const notes = asText(payload.notes) || null;

  return {
    sourceName,
    sourceVersion,
    referenceUrl,
    notes,
    cards,
    cardsById,
  };
}

function printCard(card) {
  const flags = [
    card.autographed === true ? "AUTO" : "",
    card.memorabilia === true ? "MEM" : "",
    card.serial_numbered === true ? `/${card.serial_denominator}` : "",
    asText(card.raw_or_graded).toUpperCase(),
  ].filter(Boolean);

  console.log(
    `${card.id}: ${card.year} ${card.manufacturer} ${card.product_line} ${card.player_or_subject} #${card.card_number} ${card.parallel} [${flags.join(", ")}]`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = resolve(args.file);
  const rawText = readFileSync(filePath, "utf8");
  const payload = JSON.parse(rawText);
  const validated = validateBatch(payload);

  const sourceName = args.sourceName || validated.sourceName;
  console.log(`Validated Batch 001 source: ${sourceName}`);
  console.log(`Source version: ${validated.sourceVersion}`);
  console.log(`Cards: ${validated.cards.length}`);
  for (const card of validated.cards) printCard(card);

  if (!args.apply) {
    console.log("\nDry run only. Add --apply to import through the protected admin route.");
    return;
  }

  if (typeof File === "undefined" || typeof FormData === "undefined") {
    fail("Node.js 20 or newer is required because File/FormData are unavailable.");
  }

  console.log("\n=== APPLYING DIRECTLY TO SUPABASE ===");
  if (!process.env.ADMIN_SESSION_SECRET?.trim()) {
    process.env.ADMIN_SESSION_SECRET = randomBytes(32).toString("hex");
    console.log("Using an ephemeral in-process admin session for this local import only.");
  }
  const [{ createAdminSessionValue, ADMIN_SESSION_COOKIE_NAME }, routeModule] =
    await Promise.all([
      import("../src/lib/admin-session.ts"),
      import("../src/app/api/admin/verified-reference-import/route.ts"),
    ]);
  const sessionValue = await createAdminSessionValue("cookie");
  const formData = new FormData();
  formData.set(
    "verifiedReferenceFile",
    new File([rawText], basename(filePath), {
      type: "application/json",
    }),
  );
  formData.set("sourceName", sourceName);
  formData.set("sourceVersion", validated.sourceVersion);
  formData.set("referenceUrl", validated.referenceUrl || "");
  formData.set("notes", validated.notes || "");
  if (args.replaceSource) formData.set("replaceSource", "true");

  const request = new Request("http://localhost/api/admin/verified-reference-import", {
    method: "POST",
    headers: {
      cookie: `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionValue)}`,
    },
    body: formData,
  });

  const response = await routeModule.POST(request);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    fail(`Import failed (${response.status}): ${JSON.stringify(body, null, 2)}`);
  }

  console.log(JSON.stringify(body, null, 2));
  console.log("Batch 001 import complete.");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    fail(error?.stack || error?.message || String(error));
  });
}
