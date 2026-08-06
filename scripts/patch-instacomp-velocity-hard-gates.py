from __future__ import annotations

from pathlib import Path


def replace_once_or_applied(
    path: str,
    old: str,
    new: str,
    applied_marker: str,
    label: str,
) -> None:
    target = Path(path)
    text = target.read_text()
    if applied_marker in text:
        return
    if old not in text:
        raise SystemExit(f"{label}: anchor missing")
    target.write_text(text.replace(old, new, 1))


ROUTE = "src/app/api/instacomp/scan/route.ts"
OLLAMA = "services/instacomp-ai/app/ollama.py"
LOCAL_CLIENT = "src/lib/instacomp-ai-local.ts"
IDENTITY_GUARD = "src/lib/instacomp-identity-guard.ts"

replace_once_or_applied(
    ROUTE,
    '''function desiredAiCouncilReaders(
  runSecondaryVision: boolean,
  requestedTier?: string | null,
) {
  const tier = aiCouncilTier(requestedTier);

  if (tier === "basic") return 0;
  if (tier === "mid") return Math.max(8, INSTACOMP_AI_COUNCIL_MIN_READERS);
  if (tier === "pro") return 12;
  if (tier === "dealer") return 16;
  if (tier === "high_end" || tier === "high-end") return 24;
  if (tier === "courtroom") return INSTACOMP_AI_COUNCIL_MAX_READERS;

  if (INSTACOMP_AI_COUNCIL_ALWAYS_ON) {
    return INSTACOMP_AI_COUNCIL_MIN_READERS;
  }

  return runSecondaryVision ? INSTACOMP_AI_COUNCIL_MIN_READERS : 0;
}
''',
    '''function desiredAiCouncilReaders(
  runSecondaryVision: boolean,
  requestedTier?: string | null,
) {
  void runSecondaryVision;
  void requestedTier;
  // Production identity is owned exclusively by InstaComp AI on the Mac.
  // No tier, environment variable, or future caller may re-enable a website
  // identity council without deleting this hard gate and its regression test.
  return 0;
}
''',
    "No tier, environment variable, or future caller may re-enable",
    "hard-disable all website identity council tiers",
)

replace_once_or_applied(
    ROUTE,
    '''function buildAiCouncilProviderPlan() {
  return [
    ...builtInAiCouncilProviderPlan(),
    ...customAiCouncilProviderSlots(),
  ].slice(0, INSTACOMP_AI_COUNCIL_MAX_READERS);
}
''',
    '''function buildAiCouncilProviderPlan(): InstaCompAiCouncilProviderConfig[] {
  // Defense in depth: even if the reader-count gate is accidentally changed,
  // the website has no executable external identity-reader plan.
  return [];
}
''',
    "the website has no executable external identity-reader plan",
    "empty external identity provider plan",
)

replace_once_or_applied(
    OLLAMA,
    '''- A colored Prizm name such as Green Prizm, Silver Prizm, Blue Prizm, or Red Prizm requires visible color/finish evidence plus PRIZM in back_visible_text.
- The Checklist Registry locks the final exact identity. This backup reader supplies evidence only.
''',
    '''- A colored Prizm name such as Green Prizm, Silver Prizm, Blue Prizm, or Red Prizm requires visible color/finish evidence plus PRIZM in back_visible_text.
- Blue Velocity Prizm has a directional speed pattern: dense repeating diagonal lines, slashes, chevrons, or criss-cross velocity streaks. Call it Blue Velocity Prizm, never Blue Cracked Ice.
- Blue Cracked Ice Prizm has irregular polygonal shattered-ice or broken-glass facets. Do not call a card Cracked Ice from blue color, sparkle, or diagonal lines alone.
- When Velocity and Cracked Ice are the two candidates, describe the observed surface geometry in foil_or_pattern and choose the name supported by that geometry.
- The Checklist Registry locks the final exact identity. This backup reader supplies evidence only.
''',
    "Blue Velocity Prizm has a directional speed pattern",
    "teach exact Blue Velocity versus Cracked Ice geometry",
)

replace_once_or_applied(
    OLLAMA,
    '''def normalize_identity_payload(payload: dict) -> dict:
''',
    '''def _surface_text(value: object) -> str:
    if isinstance(value, list):
        return " ".join(_surface_text(item) for item in value)
    if isinstance(value, dict):
        return " ".join(_surface_text(item) for item in value.values())
    return str(value or "")


def normalize_prizm_surface_parallel(
    identity: dict,
    evidence: dict,
    explanation: str = "",
) -> dict:
    normalized = dict(identity)
    parallel = str(normalized.get("parallel") or "").strip()
    if not parallel:
        return normalized

    context = " ".join(
        [
            parallel,
            str(normalized.get("set_name") or ""),
            str(normalized.get("brand") or ""),
            _surface_text(evidence),
            explanation,
        ]
    ).lower()
    if "prizm" not in context:
        return normalized

    explicit_velocity = bool(re.search(r"\\bvelocity\\b", context))
    directional_velocity = bool(
        re.search(
            r"\\b(?:dense|repeating|directional|angled)?\\s*(?:diagonal|chevron|speed[- ]?line|criss[- ]?cross|cross[- ]?hatch)(?:\\s+(?:line|lines|slash|slashes|streak|streaks|pattern))?\\b",
            context,
        )
    )
    strong_cracked_ice = bool(
        re.search(
            r"\\b(?:irregular\\s+polygon|polygonal|shattered[- ]?(?:ice|glass)|broken[- ]?glass|ice[- ]?shard|faceted[- ]?(?:ice|crystal))\\b",
            context,
        )
    )
    weak_cracked_ice = bool(re.search(r"\\bcracked[- ]?ice\\b", context))

    blue = "blue" in context
    color = "Blue" if blue else ""
    velocity_supported = explicit_velocity or directional_velocity
    cracked_supported = strong_cracked_ice or (
        weak_cracked_ice and not directional_velocity
    )

    if velocity_supported and not strong_cracked_ice:
        if re.search(r"cracked[- ]?ice|\\bblue\\s+prizm\\b|\\bvelocity\\b", parallel, re.I):
            normalized["parallel"] = f"{color + ' ' if color else ''}Velocity Prizm"
    elif cracked_supported and not velocity_supported and re.search(
        r"velocity|\\bblue\\s+prizm\\b",
        parallel,
        re.I,
    ):
        normalized["parallel"] = f"{color + ' ' if color else ''}Cracked Ice Prizm"

    return normalized


def normalize_identity_payload(payload: dict) -> dict:
''',
    "def normalize_prizm_surface_parallel(",
    "add Prizm surface normalizer",
)

replace_once_or_applied(
    OLLAMA,
    '''    for field in [
        "visible_text",
        "front_visible_text",
        "back_visible_text",
        "front_notes",
        "back_notes",
    ]:
''',
    '''    for field in [
        "visible_text",
        "front_visible_text",
        "back_visible_text",
        "colors",
        "foil_or_pattern",
        "front_notes",
        "back_notes",
        "uncertainty",
    ]:
''',
    '        "foil_or_pattern",\n        "front_notes",',
    "preserve surface-pattern evidence",
)

replace_once_or_applied(
    OLLAMA,
    '''    payload["evidence"] = evidence
    return payload
''',
    '''    payload["evidence"] = evidence
    payload["identity"] = normalize_prizm_surface_parallel(
        identity,
        evidence,
        str(payload.get("explanation") or ""),
    )
    return payload
''',
    'payload["identity"] = normalize_prizm_surface_parallel(',
    "apply Prizm surface normalizer",
)

replace_once_or_applied(
    LOCAL_CLIENT,
    '''  const backNotes = textList(evidence?.back_notes);
  const backEvidence = [...backVisibleText, ...backNotes].join(" | ") || null;
  const notes = [
''',
    '''  const backNotes = textList(evidence?.back_notes);
  const frontPatternEvidence = [
    ...textList(evidence?.colors),
    ...textList(evidence?.foil_or_pattern),
    ...textList(evidence?.front_notes),
  ].join(" | ") || null;
  const backEvidence = [...backVisibleText, ...backNotes].join(" | ") || null;
  const notes = [
''',
    "const frontPatternEvidence = [",
    "carry Mac surface evidence into website guard",
)

replace_once_or_applied(
    LOCAL_CLIENT,
    '''    scan.local_suggestion?.explanation || null,
    backEvidence ? `Back evidence: ${backEvidence}` : null,
''',
    '''    scan.local_suggestion?.explanation || null,
    frontPatternEvidence
      ? `Front surface evidence: ${frontPatternEvidence}`
      : null,
    backEvidence ? `Back evidence: ${backEvidence}` : null,
''',
    "Front surface evidence:",
    "record Mac surface evidence in scan notes",
)

replace_once_or_applied(
    IDENTITY_GUARD,
    '''function appendNote(notes: string | null, note: string) {
  return [notes, note].filter(Boolean).join(" ");
}

export function applyInstaCompIdentityGuard(
''',
    '''function appendNote(notes: string | null, note: string) {
  return [notes, note].filter(Boolean).join(" ");
}

function normalizePrizmSurfaceParallel(
  ai: InstaCompAiResult,
  evidenceText: string,
): InstaCompAiResult {
  const parallel = cleanSignalText(ai.parallel);
  if (!parallel) return ai;

  const context = cleanSignalText(
    [parallel, ai.setName, ai.brand, ai.notes, evidenceText]
      .filter(Boolean)
      .join(" "),
  );
  if (!/\\bprizm\\b/i.test(context)) return ai;

  const explicitVelocity = /\\bvelocity\\b/i.test(context);
  const directionalVelocity = /\\b(?:dense|repeating|directional|angled)?\\s*(?:diagonal|chevron|speed[- ]?line|criss[- ]?cross|cross[- ]?hatch)(?:\\s+(?:line|lines|slash|slashes|streak|streaks|pattern))?\\b/i.test(
    context,
  );
  const strongCrackedIce = /\\b(?:irregular\\s+polygon|polygonal|shattered[- ]?(?:ice|glass)|broken[- ]?glass|ice[- ]?shard|faceted[- ]?(?:ice|crystal))\\b/i.test(
    context,
  );
  const weakCrackedIce = /\\bcracked[- ]?ice\\b/i.test(context);
  const color = /\\bblue\\b/i.test(context) ? "Blue " : "";

  if (
    (explicitVelocity || directionalVelocity) &&
    !strongCrackedIce &&
    /cracked[- ]?ice|\\bblue\\s+prizm\\b|\\bvelocity\\b/i.test(parallel)
  ) {
    const corrected = `${color}Velocity Prizm`;
    if (parallel.toLowerCase() === corrected.toLowerCase()) return ai;
    return {
      ...ai,
      parallel: corrected,
      notes: appendNote(
        ai.notes,
        `Prizm surface firewall corrected "${parallel}" to "${corrected}" because the evidence shows directional velocity lines rather than irregular shattered-ice facets.`,
      ),
    };
  }

  if (
    (strongCrackedIce || (weakCrackedIce && !directionalVelocity)) &&
    !explicitVelocity &&
    /velocity|\\bblue\\s+prizm\\b/i.test(parallel)
  ) {
    const corrected = `${color}Cracked Ice Prizm`;
    if (parallel.toLowerCase() === corrected.toLowerCase()) return ai;
    return {
      ...ai,
      parallel: corrected,
      notes: appendNote(
        ai.notes,
        `Prizm surface firewall corrected "${parallel}" to "${corrected}" because the evidence shows irregular shattered-ice facets.`,
      ),
    };
  }

  return ai;
}

export function applyInstaCompIdentityGuard(
''',
    "function normalizePrizmSurfaceParallel(",
    "add website Prizm surface firewall",
)

replace_once_or_applied(
    IDENTITY_GUARD,
    '''  const signal = detectPrintedVariantSignal(combinedEvidence);
  const currentParallel = ai.parallel || null;
''',
    '''  const surfaceGuardedAi = normalizePrizmSurfaceParallel(ai, combinedEvidence);
  const signal = detectPrintedVariantSignal(combinedEvidence);
  const currentParallel = surfaceGuardedAi.parallel || null;
''',
    "const surfaceGuardedAi = normalizePrizmSurfaceParallel",
    "run Prizm surface firewall before printed variant guard",
)

identity_guard = Path(IDENTITY_GUARD)
identity_text = identity_guard.read_text()
identity_text = identity_text.replace("return {\n      ...ai,", "return {\n      ...surfaceGuardedAi,")
identity_text = identity_text.replace("if (!signal) return ai;", "if (!signal) return surfaceGuardedAi;")
identity_text = identity_text.replace("notes: appendNote(\n        ai.notes,", "notes: appendNote(\n        surfaceGuardedAi.notes,")
identity_text = identity_text.replace("    ...ai,\n    setName:", "    ...surfaceGuardedAi,\n    setName:")
identity_text = identity_text.replace("      ai.notes,\n      `Identity guardrail:", "      surfaceGuardedAi.notes,\n      `Identity guardrail:")
identity_guard.write_text(identity_text)

print("InstaComp hard external-reader and Blue Velocity patch applied")
