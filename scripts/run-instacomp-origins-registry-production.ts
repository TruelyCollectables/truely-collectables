import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildInstaCompMultiScannerConsensus,
  type InstaCompConsensusReaderFinding,
} from "../src/lib/instacomp-consensus";
import { catalogEvidenceToConsensusReferee } from "../src/lib/instacomp-curated-checklist";
import {
  buildChecklistRegistryCatalogEvidence,
  buildInstaCompEvidenceIdentityDecision,
  resolveChecklistRegistry,
} from "../src/lib/instacomp-learning-server";
import { parsePaniniStructuredChecklist } from "../src/lib/checklist-registry/panini-structured";
import { importChecklistArtifact } from "../src/lib/checklist-registry/server";
import type { ChecklistSourceArtifact } from "../src/lib/checklist-registry/source-adapter";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function main() {
  const fixturePath = resolve(
    process.cwd(),
    "scripts/fixtures/checklist-registry/2025-panini-origins-football-base-rookies.structured.json",
  );
  const fixtureText = readFileSync(fixturePath, "utf8");
  const artifact: ChecklistSourceArtifact = {
    sourceUrl: "https://www.beckett.com/news/2025-panini-origins-football-cards/",
    originalFilename: "2025-panini-origins-football-base-rookies.structured.json",
    mimeType: "application/json",
    content: fixtureText,
    retrievedAt: "2026-08-03T02:30:00.000Z",
    authority: "approved_reference_dataset",
    redistributionAllowed: false,
  };

  const plan = parsePaniniStructuredChecklist(artifact);
  assert(
    plan.validation.status === "passed",
    "Origins checklist slice did not validate.",
  );
  assert(
    plan.validation.counts.sets === 1,
    "Expected one Base - Rookies cardset.",
  );
  assert(
    plan.validation.counts.cards === 50,
    "Expected all 50 Base - Rookies cards.",
  );
  assert(
    plan.validation.counts.parallels === 19,
    "Expected all 19 listed rookie parallels.",
  );
  assert(
    plan.validation.counts.identities === 1000,
    "Expected 1,000 exact rookie identities.",
  );

  const shedeurCard = plan.cards.find(
    (card) =>
      card.cardNumber === "107" && card.players.includes("Shedeur Sanders"),
  );
  assert(
    shedeurCard,
    "Shedeur Sanders #107 is missing from the normalized plan.",
  );
  const shedeurHoloBlue = plan.identities.find((identity) => {
    const normalized = identity.fingerprint.normalized;
    return (
      identity.cardSourceKey === shedeurCard.sourceKey &&
      normalized.parallel === "holo blue" &&
      normalized.serialRun === "/199"
    );
  });
  assert(
    shedeurHoloBlue,
    "Shedeur Sanders #107 Holo Blue /199 identity is missing.",
  );

  const apply = process.argv.includes("--apply");
  if (!apply) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: "validate_only",
          counts: plan.validation.counts,
          shedeurFingerprint: shedeurHoloBlue.fingerprint.fingerprintSha256,
        },
        null,
        2,
      ),
    );
    return;
  }

  const persistence = await importChecklistArtifact({
    artifact,
    validateOnly: false,
  });
  assert(
    persistence.ok && !persistence.validatedOnly,
    "Production Registry import did not persist.",
  );

  const scanIdentity = {
    player: "Shedeur Sanders",
    year: "2025",
    brand: "Panini",
    setName: "2025 Panini Origins Football",
    cardNumber: "107",
    parallel: "Blue Foil",
    variation: "Rookie",
    serialNumber: "162/199",
    team: "Cleveland Browns",
    sport: "Football",
    league: "NFL",
    isRookie: true,
    isAuto: false,
    isRelic: false,
    confidence: 0.99,
  };

  const resolution = await resolveChecklistRegistry(scanIdentity, {
    evidenceTrusted: true,
  });
  assert(
    resolution.status === "internal_exact_match" && resolution.match,
    `Production Registry did not resolve Shedeur #107: ${resolution.status} ${resolution.reasons.join(", ")}`,
  );
  assert(
    resolution.match.player === "Shedeur Sanders",
    "Production player mismatch.",
  );
  assert(
    resolution.match.cardNumber === "107",
    "Production card-number mismatch.",
  );
  assert(
    resolution.match.parallel === "Holo Blue",
    "Production parallel mismatch.",
  );
  assert(resolution.match.serialRun === 199, "Production serial-run mismatch.");

  function reader(params: {
    id: string;
    label: string;
    family: string;
    parallel: string;
    kind?: "primary_vision" | "secondary_vision";
  }): InstaCompConsensusReaderFinding {
    return {
      readerId: params.id,
      label: params.label,
      family: params.family,
      kind: params.kind || "secondary_vision",
      confidence: 0.99,
      weight: 1,
      identity: { ...scanIdentity, parallel: params.parallel },
      evidence: [`${params.label} observed ${params.parallel}`],
    };
  }

  const catalogEvidence = buildChecklistRegistryCatalogEvidence(resolution.match);
  const catalogReferee = catalogEvidenceToConsensusReferee(catalogEvidence);
  const consensus = buildInstaCompMultiScannerConsensus({
    baseIdentity: scanIdentity,
    readers: [
      reader({
        id: "openai-primary",
        label: "OpenAI primary",
        family: "openai",
        parallel: "Blue Foil",
        kind: "primary_vision",
      }),
      reader({
        id: "gemini-secondary",
        label: "Gemini secondary",
        family: "gemini",
        parallel: "Holo Blue",
      }),
    ],
    catalogReferee,
  });
  assert(consensus.trustedForIdentity, consensus.reviewReasons.join(", "));

  const identityDecision = buildInstaCompEvidenceIdentityDecision({
    resolution,
    consensus,
    hasBackImage: true,
    threshold: 0.95,
  });
  assert(identityDecision.confirmed, identityDecision.reviewReasons.join(", "));
  assert(
    identityDecision.confidence >= 0.95,
    "Production identity confidence is below 95%.",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: "production_apply_and_verify",
        counts: plan.validation.counts,
        persistence: persistence.persistence,
        match: {
          identityId: resolution.match.identityId,
          player: resolution.match.player,
          cardNumber: resolution.match.cardNumber,
          parallel: resolution.match.parallel,
          serialRun: resolution.match.serialRun,
        },
        consensusTrusted: consensus.trustedForIdentity,
        identityConfirmed: identityDecision.confirmed,
        identityConfidence: identityDecision.confidence,
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
