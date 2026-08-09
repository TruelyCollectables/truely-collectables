from pathlib import Path

route_path = Path("src/app/api/instacomp/scan/route.ts")
text = route_path.read_text()

import_anchor = 'import { readValidatedInstaCompImage } from "../../../../lib/instacomp-image-safety";\n'
import_line = 'import { preserveSeasonYear } from "../../../../lib/instacomp-season-year";\n'
if import_line not in text:
    if import_anchor not in text:
        raise SystemExit("season-year import anchor missing")
    text = text.replace(import_anchor, import_anchor + import_line, 1)

old_year = 'year: registryMatch.year ? String(registryMatch.year) : consensusAi.year,'
current_year = 'year: preserveSeasonYear(consensusAi.year, registryMatch.year),'
final_year = 'year: preserveSeasonYear(listingIdentityHint.year || consensusAi.year, registryMatch.year),'
if old_year in text:
    text = text.replace(old_year, final_year, 1)
elif current_year in text:
    text = text.replace(current_year, final_year, 1)
elif final_year not in text:
    raise SystemExit("registry year assignment anchor missing")

helper_anchor = "\n\nasync function identifyCardWithConfiguredProviderFailover(params: {"
helper = r'''

function normalizeOperatorIdentityOverride(
  value: unknown,
): Partial<InstaCompAiResult> | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new InstaCompJobServerError(
      "Operator identity override must be valid JSON.",
      400,
      "INSTACOMP_OPERATOR_IDENTITY_OVERRIDE_INVALID",
    );
  }
  const record =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const textField = (name: string) => {
    if (!(name in record)) return undefined;
    const text = String(record[name] ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
    return text || undefined;
  };
  const override: Partial<InstaCompAiResult> = {
    ...(textField("player") ? { player: textField("player") } : {}),
    ...(textField("year") ? { year: textField("year") } : {}),
    ...(textField("brand") ? { brand: textField("brand") } : {}),
    ...(textField("setName") ? { setName: textField("setName") } : {}),
    ...(textField("cardNumber") ? { cardNumber: textField("cardNumber") } : {}),
    ...(textField("parallel") ? { parallel: textField("parallel") } : {}),
    ...(textField("serialNumber") ? { serialNumber: textField("serialNumber") } : {}),
    ...(textField("team") ? { team: textField("team") } : {}),
    ...(textField("sport") ? { sport: textField("sport") } : {}),
    ...(textField("conditionGuess") ? { conditionGuess: textField("conditionGuess") } : {}),
    ...(typeof record.isRookie === "boolean" ? { isRookie: record.isRookie } : {}),
    ...(typeof record.isAuto === "boolean" ? { isAuto: record.isAuto } : {}),
    ...(typeof record.isRelic === "boolean" ? { isRelic: record.isRelic } : {}),
  };
  return Object.keys(override).length ? override : null;
}

function applyOperatorIdentityOverride(
  ai: InstaCompAiResult,
  override: Partial<InstaCompAiResult> | null,
): InstaCompAiResult {
  if (!override) return ai;
  return {
    ...ai,
    ...override,
    notes: [
      ai.notes,
      `Admin operator identity override applied to: ${Object.keys(override).join(", ")}.`,
    ]
      .filter(Boolean)
      .join(" "),
  };
}
'''
if "function normalizeOperatorIdentityOverride(" not in text:
    if helper_anchor not in text:
        raise SystemExit("operator helper anchor missing")
    text = text.replace(helper_anchor, helper + helper_anchor, 1)

variable_anchor = '  let operatorSerialNumberOverride: string | null | undefined = undefined;\n  let listingTitleHint: string | null = null;\n'
variable_final = '  let operatorSerialNumberOverride: string | null | undefined = undefined;\n  let operatorIdentityOverride: Partial<InstaCompAiResult> | null = null;\n  let listingTitleHint: string | null = null;\n'
if variable_final not in text:
    if variable_anchor not in text:
        raise SystemExit("operator variable anchor missing")
    text = text.replace(variable_anchor, variable_final, 1)

form_anchor = '      const submittedListingTitleHint = formData.get("listingTitleHint");\n\n      frontImage = submittedFront instanceof File ? submittedFront : null;'
form_final = '      const submittedListingTitleHint = formData.get("listingTitleHint");\n      const submittedOperatorIdentityOverride = formData.get("operatorIdentityOverride");\n\n      frontImage = submittedFront instanceof File ? submittedFront : null;'
if form_final not in text:
    if form_anchor not in text:
        raise SystemExit("operator form anchor missing")
    text = text.replace(form_anchor, form_final, 1)

parse_anchor = '''      operatorSerialNumberOverride = normalizeOperatorSerialNumberOverride(
        submittedOperatorSerialNumberOverride,
        typeof submittedOperatorSerialNumberOverride === "string",
      );
      detailImageFiles = formData
'''
parse_final = '''      operatorSerialNumberOverride = normalizeOperatorSerialNumberOverride(
        submittedOperatorSerialNumberOverride,
        typeof submittedOperatorSerialNumberOverride === "string",
      );
      if (
        typeof submittedOperatorIdentityOverride === "string" &&
        submittedOperatorIdentityOverride.trim()
      ) {
        if (actor.type !== "admin") {
          throw new InstaCompJobServerError(
            "Only the store owner can apply an operator identity override.",
            403,
            "INSTACOMP_OPERATOR_IDENTITY_OVERRIDE_FORBIDDEN",
          );
        }
        operatorIdentityOverride = normalizeOperatorIdentityOverride(
          submittedOperatorIdentityOverride,
        );
      }
      detailImageFiles = formData
'''
if parse_final not in text:
    if parse_anchor not in text:
        raise SystemExit("operator parse anchor missing")
    text = text.replace(parse_anchor, parse_final, 1)

if "const registryAi: InstaCompAiResult = registryMatch" not in text:
    old = "const ai: InstaCompAiResult = registryMatch"
    if old not in text:
        raise SystemExit("registry ai declaration anchor missing")
    text = text.replace(old, "const registryAi: InstaCompAiResult = registryMatch", 1)

apply_anchor = '        };\n    const consensusCompSearchDecision = decideInstaCompCompSearch(consensus);'
apply_final = '        };\n    const ai = applyOperatorIdentityOverride(registryAi, operatorIdentityOverride);\n    const consensusCompSearchDecision = decideInstaCompCompSearch(consensus);'
if apply_final not in text:
    if apply_anchor not in text:
        raise SystemExit("operator apply anchor missing")
    text = text.replace(apply_anchor, apply_final, 1)

policy_old = 'requestedTier: requestedAiCouncilTier || INSTACOMP_AI_COUNCIL_TIER,'
if policy_old in text:
    text = text.replace(policy_old, 'requestedTier: "basic",', 1)
elif 'requestedTier: "basic",' not in text:
    raise SystemExit("AI council policy anchor missing")

secondary_old = '''      runSecondaryVision:
        requestedAiCouncilTier !== "basic" && consensusEscalation.runSecondaryVision,
      requestedTier: requestedAiCouncilTier,
'''
secondary_final = '''      runSecondaryVision: false,
      requestedTier: "basic",
'''
if secondary_old in text:
    text = text.replace(secondary_old, secondary_final, 1)
elif secondary_final not in text:
    raise SystemExit("AI council runtime anchor missing")

route_path.write_text(text)

workbench_path = Path("src/app/admin/instacomp/fast/InstaCompFastWorkbench.tsx")
workbench = workbench_path.read_text()
correction_anchor = '        form.append("listingTitleHint", identityTitle(correction));\n        form.append("operatorSerialNumberOverride", correction.serialNumber || "none");'
correction_final = '        form.append("listingTitleHint", identityTitle(correction));\n        form.append("operatorIdentityOverride", JSON.stringify(correction));\n        form.append("operatorSerialNumberOverride", correction.serialNumber || "none");'
if correction_final not in workbench:
    if correction_anchor not in workbench:
        raise SystemExit("workbench operator override anchor missing")
    workbench = workbench.replace(correction_anchor, correction_final, 1)

workbench = workbench.replace('form.append("aiCouncilTier", "adaptive");', 'form.append("aiCouncilTier", "basic");')
workbench_path.write_text(workbench)
