from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    (ROOT / path).write_text(text, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if text.count(old) != 1:
        raise SystemExit(f"expected one patch anchor in {path}, got {text.count(old)}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


path = "src/lib/instacomp-learning-server.ts"
replace_once(
    path,
    '  options: { allowAdjacentYearRecovery?: boolean } = {},\n',
    '  options: {\n    allowAdjacentYearRecovery?: boolean;\n    allowExactReceiptUnnumberedSerialRecovery?: boolean;\n  } = {},\n',
)
old = '''    if (targetSerialRun) {\n      if (serialRun !== Number(targetSerialRun)) continue;\n      if (\n        registryBase ||\n        !parallelProfile.signature ||\n        registryParallelSignature !== parallelProfile.signature\n      ) {\n        continue;\n      }\n    } else {\n      if (serialRun) continue;\n      if (parallelProfile.baseLike) {\n        if (!registryBase) continue;\n      } else if (\n        registryBase ||\n        registryParallelSignature !== parallelProfile.signature\n      ) {\n        continue;\n      }\n    }\n'''
new = '''    const exactReceiptUnnumberedSerialRecovery =\n      Boolean(targetSerialRun) &&\n      options.allowExactReceiptUnnumberedSerialRecovery === true &&\n      serialRun === null;\n\n    if (targetSerialRun && !exactReceiptUnnumberedSerialRecovery) {\n      if (serialRun !== Number(targetSerialRun)) continue;\n      if (\n        registryBase ||\n        !parallelProfile.signature ||\n        registryParallelSignature !== parallelProfile.signature\n      ) {\n        continue;\n      }\n    } else {\n      if (serialRun) continue;\n      if (parallelProfile.baseLike) {\n        if (!registryBase) continue;\n      } else if (\n        registryBase ||\n        registryParallelSignature !== parallelProfile.signature\n      ) {\n        continue;\n      }\n    }\n'''
replace_once(path, old, new)
replace_once(
    path,
    '  const match = chooseRegistryMatch(params.ai, [row]);\n',
    '  const match = chooseRegistryMatch(params.ai, [row], {\n    // This path already verified the exact current UUID + stored fingerprint.\n    // If that exact Registry identity is unnumbered, a lone AI serial guess\n    // must not invalidate the receipt. Generic Registry lookup stays strict.\n    allowExactReceiptUnnumberedSerialRecovery: true,\n  });\n',
)

path = "src/lib/instacomp-consensus.ts"
anchor = '''  if (knownValue(catalogValue)) {\n'''
insert = '''  const catalogSerialRun =\n    field === "serialNumber" && catalogReferee?.status === "catalog_confirmed"\n      ? (catalogReferee.identity as (InstaCompConsensusIdentity & { serialRun?: string | null }) | null | undefined)?.serialRun\n      : undefined;\n  const catalogExplicitlyUnnumbered =\n    field === "serialNumber" &&\n    catalogReferee?.status === "catalog_confirmed" &&\n    Boolean(catalogReferee.identity) &&\n    Object.prototype.hasOwnProperty.call(catalogReferee.identity, "serialRun") &&\n    !knownValue(catalogSerialRun);\n\n  if (catalogExplicitlyUnnumbered && groups.length) {\n    const independentFamilies = uniqueStrings(groups.flatMap((group) => group.families));\n    if (independentFamilies.length >= 2) {\n      return {\n        field,\n        status: "review_required",\n        value: groups[0].value,\n        sources: uniqueStrings(groups.flatMap((group) => group.sources)),\n        conflictingValues: ["Registry: unnumbered"],\n        reason:\n          "Two independent scanner families observed a serial denominator, but the exact Registry identity is unnumbered; operator review is required.",\n      };\n    }\n\n    return {\n      field,\n      status: "catalog_referee",\n      value: "",\n      sources: [catalogReferee?.sourceLabel || "Catalog/checklist referee"],\n      conflictingValues: uniqueStrings(groups.map((group) => String(group.value))),\n      reason:\n        "Exact Registry identity marks this printing unnumbered, so a serial supplied by only one scanner family was not accepted as physical identity evidence.",\n    };\n  }\n\n  if (knownValue(catalogValue)) {\n'''
replace_once(path, anchor, insert)

# Add an offline regression that mirrors Malonga's lone /299 hallucination.
path = "scripts/run-instacomp-final-identity-consensus-simulations.ts"
anchor = '''console.log("PASS final InstaComp identity consensus simulations");\n'''
insert = '''const malongaSerialHallucinationConsensus = buildInstaCompMultiScannerConsensus({\n  readers: [\n    {\n      readerId: "malonga-primary-serial",\n      label: "Primary local Qwen",\n      kind: "primary_vision",\n      family: "instacomp_internal",\n      identity: { player: "Dominique Malonga", year: "2025", brand: "Panini", setName: "Base", cardNumber: "116", parallel: "Prizms Ice", serialNumber: "/299", sport: "Basketball", isAuto: false, isRelic: false },\n      confidence: 0.98,\n      evidence: ["model supplied /299"],\n    },\n    {\n      readerId: "malonga-deterministic-no-serial",\n      label: "Apple Vision/OpenCV deterministic evidence",\n      kind: "ocr_printed_evidence",\n      family: "instacomp_local_deterministic",\n      identity: { year: "2025", brand: "Panini", cardNumber: "116", parallel: "Cracked Ice Prizm" },\n      confidence: 0.99,\n      evidence: ["no printed serial stamp detected"],\n    },\n  ],\n  baseIdentity: { player: "Dominique Malonga", year: "2025", brand: "Panini", setName: "Base", cardNumber: "116", parallel: "Prizms Ice", serialNumber: "/299", sport: "Basketball", isAuto: false, isRelic: false },\n  catalogReferee: iceReferee,\n  escalation: basicEscalation,\n});\nassert.equal(malongaSerialHallucinationConsensus.trustedForIdentity, true);\nassert.equal(malongaSerialHallucinationConsensus.finalIdentity.serialNumber, "");\nconst malongaSerialDecision = malongaSerialHallucinationConsensus.fieldDecisions.find((d) => d.field === "serialNumber");\nassert.equal(malongaSerialDecision?.status, "catalog_referee");\n\nconsole.log("PASS final InstaComp identity consensus simulations");\n'''
replace_once(path, anchor, insert)

print("PASS applied exact Registry receipt serial safeguard v4")
