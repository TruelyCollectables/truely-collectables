from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if text.count(old) != 1:
        raise SystemExit(f"Expected exactly one patch target in {path}, found {text.count(old)}")
    p.write_text(text.replace(old, new, 1))


replace_once(
    "src/lib/instacomp-ai-local.ts",
    '''  const serialRun = Number(identity.serial_run ?? identity.serialRun);\n  const printRun =\n    Number.isInteger(serialRun) && serialRun > 0 ? `/${serialRun}` : null;\n''',
    '''  const serialRun = Number(identity.serial_run ?? identity.serialRun);\n  // A trusted-memory identity may contain historical serial-run metadata, but\n  // serialization is visible-card evidence and must be re-proven on the current\n  // physical scan. Never let stale memory manufacture a /NNN constraint.\n  const deterministicSerialNumber = text(\n    deterministicIdentity(scan)?.serialNumber,\n  );\n  const deterministicSerialRun = deterministicSerialNumber\n    ?.match(/\\/\\s*(\\d{1,7})\\b/)?.[1];\n  const printRun =\n    Number.isInteger(serialRun) &&\n    serialRun > 0 &&\n    Number(deterministicSerialRun) === serialRun\n      ? `/${serialRun}`\n      : null;\n''',
)

replace_once(
    "src/lib/instacomp-learning-server.ts",
    '''  if (\n    !brandEvidenceMatches(ai.brand, [\n      manufacturer.name,\n      brand.name,\n      release.product_name,\n      row.name,\n    ])\n  ) {\n    return false;\n  }\n\n  const registrySetTokens = new Set(\n''',
    '''  if (\n    !brandEvidenceMatches(ai.brand, [\n      manufacturer.name,\n      brand.name,\n      release.product_name,\n      row.name,\n    ])\n  ) {\n    return false;\n  }\n\n  // PRIZM/PRISM by itself is a release/product-line observation, not a logical\n  // checklist set. Constrain it against the release brand/product only and let\n  // player + card number + parallel prove one unique logical set identity. Soft\n  // visible logical-set text (for example GROOVY) is still applied before this\n  // function by narrowing setRowsForCoverage, so inserts are never coerced Base.\n  if (isProductLineOnlySetEvidence(ai.setName)) {\n    const registryProductTokens = new Set(\n      meaningfulTokens(\n        [brand.name, release.product_name].filter(Boolean).join(" "),\n      ),\n    );\n    return [...targetSetTokens].every((token) =>\n      registryProductTokens.has(token),\n    );\n  }\n\n  const registrySetTokens = new Set(\n''',
)

print("Applied final Malonga stale-serial and Rickea product-line Registry repairs")
