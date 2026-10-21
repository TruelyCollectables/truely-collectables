#!/usr/bin/env python3
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: patch-prizm-wnba-canary-importer-20260803.py <importer>")

importer = Path(sys.argv[1])
text = importer.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    '''  normalizedPlanSha256: "e3d529384fc3778732f1f4fc6897079154506cb167b39f14d02bd60bd2b28159",
  sets: 12,
  cards: 337,''',
    '''  originalNormalizedPlanSha256: "e3d529384fc3778732f1f4fc6897079154506cb167b39f14d02bd60bd2b28159",
  normalizedPlanSha256: "49edca289849a82694b0565a8e2e1eabe99ea71449e59f94bb4093c74d6de6f8",
  sets: 12,
  sourceCards: 337,
  cards: 335,''',
    "source repair contract",
)

replace_once(
    "  active_cards: 36_324,",
    "  active_cards: 36_322,",
    "post-import active-card total",
)

replace_once(
    '    ["cards", Number(counts.cards), SOURCE.cards],',
    '    ["cards", Number(counts.cards), SOURCE.sourceCards],',
    "source card-count validation",
)

replace_once(
    '''      SOURCE.normalizedPlanSha256,
    ],''',
    '''      SOURCE.originalNormalizedPlanSha256,
    ],''',
    "source semantic digest validation",
)

replace_once(
    "  return { plan, rawBytes, planPath, rawPath };",
    '''  const repairReceipt = applyCanonicalRepairs(plan);
  return { plan, rawBytes, planPath, rawPath, repairReceipt };''',
    "prepare-source repair call",
)

helper = r'''const EMPTY_FINGERPRINT_VALUE = "∅";

function canonicalField(name, value) {
  const encoded = Array.isArray(value)
    ? value.length
      ? value.join("+")
      : EMPTY_FINGERPRINT_VALUE
    : value || EMPTY_FINGERPRINT_VALUE;
  return `${name}=${encoded}`;
}

function normalizeFingerprintList(values) {
  return [...values]
    .map((value) =>
      String(value)
        .normalize("NFKC")
        .replace(/[‐‑‒–—―]/g, "-")
        .replace(/&/g, " and ")
        .replace(/[’‘]/g, "'")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase(),
    )
    .sort((left, right) => left.localeCompare(right));
}

function rebuildFingerprint(fingerprint, players, teams) {
  const normalized = {
    ...fingerprint.normalized,
    players: normalizeFingerprintList(players),
    teams: normalizeFingerprintList(teams),
  };
  const canonicalKey = [
    canonicalField("schema", normalized.schema),
    canonicalField("release_year", normalized.releaseYear),
    canonicalField("season", normalized.season),
    canonicalField("manufacturer", normalized.manufacturer),
    canonicalField("brand", normalized.brand),
    canonicalField("product", normalized.product),
    canonicalField("sport", normalized.sport),
    canonicalField("league", normalized.league),
    canonicalField("set", normalized.setName),
    canonicalField("subset", normalized.subset),
    canonicalField("card_number", normalized.cardNumber),
    canonicalField("players", normalized.players),
    canonicalField("teams", normalized.teams),
    canonicalField("parallel", normalized.parallel),
    canonicalField("variation", normalized.variation),
    canonicalField("serial_run", normalized.serialRun),
    canonicalField("autograph", normalized.autographStatus),
    canonicalField("memorabilia", normalized.memorabiliaStatus),
    canonicalField("configuration", normalized.configurationExclusivity),
  ].join("|");
  return {
    schema: normalized.schema,
    normalized,
    canonicalKey,
    fingerprintSha256: sha256(canonicalKey),
  };
}

function applyCanonicalRepairs(plan) {
  const repairs = [
    {
      setSourceKey: "set:base",
      cardNumber: "140",
      keep: "card:base:140:998bc19c8763f18b",
      drop: "card:base:140:a3fc543e6dfffb74",
      players: ["Elizabeth Kitley"],
      teams: ["Las Vegas Aces"],
    },
    {
      setSourceKey: "set:fearless",
      cardNumber: "10",
      keep: "card:fearless:10:ea3a847abe4e4a30",
      drop: "card:fearless:10:f218e343535c72b0",
      players: ["Caitlin Clark"],
      teams: ["Indiana Fever"],
    },
  ];

  if (plan.cards.length !== SOURCE.sourceCards) {
    throw new Error(
      `Canonical repair expected ${SOURCE.sourceCards} source cards, received ${plan.cards.length}.`,
    );
  }
  if (plan.identities.length !== SOURCE.identities) {
    throw new Error(
      `Canonical repair expected ${SOURCE.identities} identities, received ${plan.identities.length}.`,
    );
  }

  const applied = [];
  for (const repair of repairs) {
    const keepRows = plan.cards.filter((card) => card.sourceKey === repair.keep);
    const dropRows = plan.cards.filter((card) => card.sourceKey === repair.drop);
    if (keepRows.length !== 1 || dropRows.length !== 1) {
      throw new Error(
        `Canonical repair source keys were not exact for ${repair.setSourceKey}/${repair.cardNumber}.`,
      );
    }
    const keep = keepRows[0];
    const drop = dropRows[0];
    for (const card of [keep, drop]) {
      if (
        card.setSourceKey !== repair.setSourceKey ||
        String(card.cardNumber) !== repair.cardNumber ||
        String(card.variation || "") !== ""
      ) {
        throw new Error(`Canonical repair key mismatch for ${card.sourceKey}.`);
      }
    }

    keep.players = [...repair.players];
    keep.teams = [...repair.teams];
    keep.sourceNotes = [
      keep.sourceNotes,
      "canonical_card_repair=source_parallel_conflict",
      `dropped_source_key=${repair.drop}`,
    ]
      .filter(Boolean)
      .join("; ");

    const beforeCards = plan.cards.length;
    plan.cards = plan.cards.filter((card) => card.sourceKey !== repair.drop);
    if (plan.cards.length !== beforeCards - 1) {
      throw new Error(`Canonical repair did not remove ${repair.drop}.`);
    }

    let remappedIdentities = 0;
    for (const identity of plan.identities) {
      if (
        identity.cardSourceKey === repair.keep ||
        identity.cardSourceKey === repair.drop
      ) {
        identity.cardSourceKey = repair.keep;
        identity.fingerprint = rebuildFingerprint(
          identity.fingerprint,
          repair.players,
          repair.teams,
        );
        remappedIdentities += 1;
      }
    }
    if (remappedIdentities < 2) {
      throw new Error(
        `Canonical repair remapped only ${remappedIdentities} identities for ${repair.keep}.`,
      );
    }
    applied.push({
      setSourceKey: repair.setSourceKey,
      cardNumber: repair.cardNumber,
      keptSourceKey: repair.keep,
      droppedSourceKey: repair.drop,
      players: repair.players,
      teams: repair.teams,
      remappedIdentities,
    });
  }

  plan.validation.counts.cards = plan.cards.length;
  plan.validation.counts.identities = plan.identities.length;
  plan.validation.issues = [
    ...(plan.validation.issues || []),
    {
      code: "canonical_card_repairs_applied",
      severity: "warning",
      message:
        "Resolved two pinned third-party parallel-row subject conflicts against canonical base checklist rows.",
    },
  ];

  const uniqueCardKeys = new Set(
    plan.cards.map(
      (card) => `${card.setSourceKey}|${card.cardNumber}|${card.variation || ""}`,
    ),
  );
  const uniqueFingerprints = new Set(
    plan.identities.map((identity) => identity.fingerprint.fingerprintSha256),
  );
  const digest = normalizedPlanDigest(plan);
  const failures = [];
  if (plan.cards.length !== SOURCE.cards) {
    failures.push(`cards=${plan.cards.length}, expected=${SOURCE.cards}`);
  }
  if (uniqueCardKeys.size !== SOURCE.cards) {
    failures.push(`uniqueCardKeys=${uniqueCardKeys.size}, expected=${SOURCE.cards}`);
  }
  if (plan.identities.length !== SOURCE.identities) {
    failures.push(
      `identities=${plan.identities.length}, expected=${SOURCE.identities}`,
    );
  }
  if (uniqueFingerprints.size !== SOURCE.identities) {
    failures.push(
      `uniqueFingerprints=${uniqueFingerprints.size}, expected=${SOURCE.identities}`,
    );
  }
  if (digest !== SOURCE.normalizedPlanSha256) {
    failures.push(
      `normalizedPlanSha256=${digest}, expected=${SOURCE.normalizedPlanSha256}`,
    );
  }
  if (failures.length) {
    throw new Error(`Canonical repair validation blocked: ${failures.join("; ")}`);
  }

  return {
    schema: "tcos.checklist.canonicalCardRepair.v1",
    status: "passed",
    sourceCards: SOURCE.sourceCards,
    canonicalCards: SOURCE.cards,
    identities: SOURCE.identities,
    uniqueCardKeys: uniqueCardKeys.size,
    uniqueFingerprints: uniqueFingerprints.size,
    normalizedPlanSha256: digest,
    repairs: applied,
  };
}

'''

replace_once(
    "function managementContext() {",
    helper + "function managementContext() {",
    "canonical repair helper insertion",
)

replace_once(
    '''    normalizedPlanSha256: SOURCE.normalizedPlanSha256,
    postgresConnection: connectionReceipt,''',
    '''    normalizedPlanSha256: SOURCE.normalizedPlanSha256,
    canonicalRepair: entry.repairReceipt,
    postgresConnection: connectionReceipt,''',
    "repair receipt persistence",
)

replace_once(
    '''      thirdPartyRowsNeverRepresentedAsOfficialManufacturer: true,
      exactVerifiedTransportOnly: true,''',
    '''      thirdPartyRowsNeverRepresentedAsOfficialManufacturer: true,
      canonicalCardRepairsApplied: true,
      sourceConflictRepairsExact: 2,
      databaseCardUniquenessValidated: true,
      exactVerifiedTransportOnly: true,''',
    "repair safety receipt",
)

importer.write_text(text)
print(f"patched {importer}")
