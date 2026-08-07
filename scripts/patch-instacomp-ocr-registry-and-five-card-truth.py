#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / "services" / "instacomp-ai" / "app" / "local_vision.py"
OLLAMA = ROOT / "services" / "instacomp-ai" / "app" / "ollama.py"
SERVER = ROOT / "src" / "lib" / "instacomp-checklist-first-server.ts"


def sub_once(path: Path, pattern: str, replacement: str) -> None:
    source = path.read_text(encoding="utf-8")
    compiled = re.compile(pattern, re.S)
    updated, count = compiled.subn(lambda _match: replacement, source, count=1)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement for {pattern[:100]!r}, found {count}")
    path.write_text(updated, encoding="utf-8")


# --- deterministic OCR hard facts -------------------------------------------------
sub_once(
    LOCAL,
    r"def _year_hint\(text: str\) -> str \| None:\n.*?\n\ndef _manufacturer_hint",
    '''def _year_hint(observations: Iterable[OCRObservation]) -> str | None:\n    scores: dict[int, float] = {}\n    for observation in observations:\n        text = str(observation.text or \"\")\n        lowered = text.lower()\n        for raw in YEAR_RE.findall(text):\n            year = int(raw)\n            if not 1900 <= year <= 2035:\n                continue\n            score = max(0.05, float(observation.confidence))\n            # Product/copyright lines describe the card's release year and must\n            # outrank historical season/stat rows such as \"2024 WNBA TOTALS\".\n            if any(name in lowered for name in MANUFACTURERS):\n                score += 5.0\n            if any(token in lowered for token in (\"prizm\", \"select\", \"basketball\", \"baseball\", \"hockey\", \"football\")):\n                score += 2.0\n            if \"licensed product\" in lowered or \"©\" in text:\n                score += 2.0\n            if any(token in lowered for token in (\"totals\", \"season\", \"ncaa\", \"stats\")):\n                score -= 1.0\n            scores[year] = scores.get(year, 0.0) + score\n    if not scores:\n        return None\n    return str(max(scores, key=lambda value: (scores[value], value)))\n\n\ndef _manufacturer_hint''',
)

sub_once(
    LOCAL,
    r"def _card_number_hint\(observations: Iterable\[OCRObservation\]\) -> str \| None:\n.*?\n\ndef _player_hint",
    '''def _card_number_hint(observations: Iterable[OCRObservation]) -> str | None:\n    values = list(observations)\n    ordered = sorted(\n        values,\n        key=lambda value: (\n            0 if value.side == \"back\" else 1,\n            -value.confidence,\n            -value.box.height,\n        ),\n    )\n    # First prefer a complete labeled token such as \"No. 122\".\n    for observation in ordered:\n        for pattern in CARD_NUMBER_PATTERNS:\n            match = pattern.search(observation.text)\n            if match:\n                return match.group(1).strip().upper()\n\n    # Apple Vision frequently separates the printed \"No.\" label and the value\n    # into adjacent OCR boxes. Pair those boxes geometrically instead of asking\n    # Qwen to guess the number from the image again.\n    label_re = re.compile(r\"^(?:no\\.?|card(?:\\s*(?:no\\.?|number))?)$\", re.I)\n    value_re = re.compile(r\"^[A-Z]{0,4}\\d+[A-Z0-9-]{0,8}$\", re.I)\n    labels = [value for value in values if label_re.match(value.text.strip())]\n    candidates = [\n        value\n        for value in values\n        if value_re.match(value.text.strip())\n        and not (value.text.strip().isdigit() and 1900 <= int(value.text.strip()) <= 2035)\n    ]\n    best: tuple[float, str] | None = None\n    for label in labels:\n        lx = label.box.x + label.box.width / 2\n        ly = label.box.y + label.box.height / 2\n        for candidate in candidates:\n            if candidate.side != label.side:\n                continue\n            cx = candidate.box.x + candidate.box.width / 2\n            cy = candidate.box.y + candidate.box.height / 2\n            dx = abs(cx - lx)\n            dy = abs(cy - ly)\n            # Card-number value is normally on the same row or directly below the\n            # label. Keep the search bounded so jersey/stat numbers are ignored.\n            if dx > 0.34 or dy > 0.16:\n                continue\n            score = (2.0 - 2.5 * dy - 1.2 * dx) + candidate.confidence\n            if cx >= lx - 0.05:\n                score += 0.35\n            token = candidate.text.strip().upper()\n            if best is None or score > best[0]:\n                best = (score, token)\n    return best[1] if best else None\n\n\ndef _player_hint''',
)

sub_once(
    LOCAL,
    r"def _parallel_hint\(\n    \*,\n    front: SideVisionEvidence,\n    back: SideVisionEvidence \| None,\n\) -> str \| None:\n.*?\n\ndef build_identity_hints",
    '''def _parallel_hint(\n    *,\n    front: SideVisionEvidence,\n    back: SideVisionEvidence | None,\n) -> str | None:\n    # Dominant image colors describe jerseys, borders, backgrounds, and photos;\n    # they are not sufficient evidence for a named parallel. Only emit a local\n    # parallel hint when measured surface geometry itself is confident.\n    label = front.pattern.label\n    confidence = float(front.pattern.confidence or 0)\n    if confidence < 0.70:\n        return None\n    if label == \"velocity\":\n        return \"Velocity Prizm\"\n    if label == \"cracked_ice\":\n        return \"Cracked Ice Prizm\"\n    return None\n\n\ndef build_identity_hints''',
)

source = LOCAL.read_text(encoding="utf-8")
source = source.replace("year=_year_hint(text),", "year=_year_hint(observations),", 1)
LOCAL.write_text(source, encoding="utf-8")

# --- deterministic fields outrank model guesses ----------------------------------
sub_once(
    OLLAMA,
    r"    hints = local_vision\.identity_hints\.model_dump\(mode=\"json\"\)\n    for field, value in hints\.items\(\):\n        if identity\.get\(field\) in \{None, \"\"\} and value not in \{None, \"\"\}:\n            identity\[field\] = value\n    if local_vision\.serial\.stamp_present and local_vision\.serial\.exact_stamp:\n        identity\[\"serial_number\"\] = local_vision\.serial\.exact_stamp\n        identity\[\"serial_run\"\] = local_vision\.serial\.visible_denominator",
    '''    hints = local_vision.identity_hints.model_dump(mode=\"json\")\n    hard_fields = {\"year\", \"manufacturer\", \"card_number\"}\n    for field, value in hints.items():\n        if value in {None, \"\"}:\n            continue\n        if field in hard_fields or identity.get(field) in {None, \"\"}:\n            identity[field] = value\n    # Surface geometry is deterministic evidence. If it produced a parallel hint,\n    # it outranks a free-form model guess. Otherwise do not let dominant image\n    # color masquerade as a checklist parallel.\n    if hints.get(\"parallel\"):\n        identity[\"parallel\"] = hints[\"parallel\"]\n    elif identity.get(\"parallel\") and re.search(\n        r\"^(?:white|black|red|blue|green|gold|orange|purple|pink|silver)\\s+prizm$\",\n        str(identity.get(\"parallel\")),\n        re.I,\n    ):\n        identity[\"parallel\"] = None\n    if local_vision.serial.stamp_present and local_vision.serial.exact_stamp:\n        identity[\"serial_number\"] = local_vision.serial.exact_stamp\n        identity[\"serial_run\"] = local_vision.serial.visible_denominator\n    else:\n        # A checklist print run is not a visible physical copy stamp. Never keep a\n        # model-invented numerator/denominator when deterministic OCR saw no stamp.\n        identity[\"serial_number\"] = None\n        identity[\"serial_run\"] = None''',
)

# --- bounded Registry loading -----------------------------------------------------
server = SERVER.read_text(encoding="utf-8")
server = server.replace(
    'import { createClient } from "@supabase/supabase-js";',
    'import { createClient, type SupabaseClient } from "@supabase/supabase-js";',
    1,
)
SERVER.write_text(server, encoding="utf-8")

insert_marker = "export type InstaCompChecklistFirstServerDecision = InstaCompChecklistFirstDecision & {"
helper = r'''type RegistryLoad = {
  rows: any[];
  errorCode: string | null;
};

function queryErrorCode(error: any) {
  return String(error?.code || "unknown");
}

async function loadRegistryRowsBounded(
  supabase: SupabaseClient,
  cardNumber: string,
  input: InstaCompChecklistLookupInput,
): Promise<RegistryLoad> {
  // Do not expand all relationships in one PostgREST statement. That query grows
  // multiplicatively across players, teams, and identities and has timed out in
  // Production. Fetch the small card-ID set first, then expand only those IDs.
  const cardResult = await supabase
    .from("checklist_cards")
    .select(
      "id,release_id,version_id,set_id,card_number,normalized_card_number,variation,autograph_status,memorabilia_status",
    )
    .eq("normalized_card_number", cardNumber)
    .limit(250);
  if (cardResult.error) {
    return { rows: [], errorCode: queryErrorCode(cardResult.error) };
  }
  const cards = cardResult.data || [];
  if (!cards.length) return { rows: [], errorCode: null };

  const unique = (values: unknown[]) => [
    ...new Set(values.map((value) => String(value || "")).filter(Boolean)),
  ];
  const versionIds = unique(cards.map((card: any) => card.version_id));
  const releaseIds = unique(cards.map((card: any) => card.release_id));

  const [versionResult, releaseResult] = await Promise.all([
    supabase.from("checklist_versions").select("id,is_active,status").in("id", versionIds),
    supabase
      .from("checklist_releases")
      .select(
        "id,product_name,release_year,season,manufacturer:checklist_manufacturers(name),brand:checklist_brands(name),sport:checklist_sports(name),league:checklist_leagues(name)",
      )
      .in("id", releaseIds),
  ]);
  const firstError = versionResult.error || releaseResult.error;
  if (firstError) return { rows: [], errorCode: queryErrorCode(firstError) };

  const activeVersionIds = new Set(
    (versionResult.data || [])
      .filter((version: any) => version.is_active === true && version.status === "live")
      .map((version: any) => String(version.id)),
  );
  const releaseById = new Map(
    (releaseResult.data || []).map((release: any) => [String(release.id), release]),
  );
  const requestedYear = yearStart(input.year);
  const requestedManufacturer = normalizedText(input.manufacturer);
  const eligibleCards = cards.filter((card: any) => {
    if (!activeVersionIds.has(String(card.version_id))) return false;
    const release: any = releaseById.get(String(card.release_id));
    if (!release) return false;
    if (requestedYear && yearStart(release.release_year || release.season) !== requestedYear) {
      return false;
    }
    if (requestedManufacturer) {
      const haystack = [
        release.manufacturer?.name,
        release.brand?.name,
        release.product_name,
      ]
        .map(normalizedText)
        .filter(Boolean);
      if (!haystack.some((value) => value === requestedManufacturer || value.includes(requestedManufacturer) || requestedManufacturer.includes(value))) {
        return false;
      }
    }
    return true;
  });
  if (!eligibleCards.length) return { rows: [], errorCode: null };

  const cardIds = unique(eligibleCards.map((card: any) => card.id));
  const setIds = unique(eligibleCards.map((card: any) => card.set_id));
  const [setResult, playerResult, teamResult, identityResult] = await Promise.all([
    setIds.length
      ? supabase.from("checklist_sets").select("id,name,normalized_name").in("id", setIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("checklist_card_players")
      .select("card_id,display_order,player:checklist_players(canonical_name)")
      .in("card_id", cardIds),
    supabase
      .from("checklist_card_teams")
      .select("card_id,display_order,team:checklist_teams(canonical_name)")
      .in("card_id", cardIds),
    supabase
      .from("checklist_card_identities")
      .select(
        "id,card_id,variation,autograph_status,memorabilia_status,parallel:checklist_parallels(name,serial_run)",
      )
      .in("card_id", cardIds),
  ]);
  const detailError =
    setResult.error || playerResult.error || teamResult.error || identityResult.error;
  if (detailError) return { rows: [], errorCode: queryErrorCode(detailError) };

  const setById = new Map(
    (setResult.data || []).map((set: any) => [String(set.id), set]),
  );
  const groupByCard = (rows: any[]) => {
    const result = new Map<string, any[]>();
    for (const row of rows || []) {
      const key = String(row.card_id);
      const bucket = result.get(key) || [];
      bucket.push(row);
      result.set(key, bucket);
    }
    return result;
  };
  const playersByCard = groupByCard(playerResult.data || []);
  const teamsByCard = groupByCard(teamResult.data || []);
  const identitiesByCard = groupByCard(identityResult.data || []);

  const rows = eligibleCards.map((card: any) => ({
    ...card,
    version: { id: card.version_id, is_active: true, status: "live" },
    release: releaseById.get(String(card.release_id)) || null,
    set: setById.get(String(card.set_id)) || null,
    players: playersByCard.get(String(card.id)) || [],
    teams: teamsByCard.get(String(card.id)) || [],
    identities: identitiesByCard.get(String(card.id)) || [],
  }));
  return { rows, errorCode: null };
}

'''
server = SERVER.read_text(encoding="utf-8")
if "loadRegistryRowsBounded" not in server:
    if insert_marker not in server:
        raise SystemExit("Registry server insertion marker missing")
    server = server.replace(insert_marker, helper + insert_marker, 1)
SERVER.write_text(server, encoding="utf-8")

sub_once(
    SERVER,
    r"  const supabase = serviceClient\(\);\n  const \{ data, error \} = await supabase\n    \.from\(\"checklist_cards\"\).*?\n\n  const candidates = toCandidates\(data \|\| \[\]\);",
    '''  const supabase = serviceClient();\n  const loaded = await loadRegistryRowsBounded(supabase, cardNumber, input);\n  if (loaded.errorCode) {\n    console.error(\"Checklist-first bounded Registry lookup failed:\", loaded.errorCode);\n    return {\n      status: \"review_required\",\n      aiRequired: true,\n      match: null,\n      candidates: [],\n      reasons: [`checklist_registry_lookup_failed:${loaded.errorCode}`],\n      source: \"checklist_registry\",\n      lookupAttempted: true,\n    };\n  }\n\n  const candidates = toCandidates(loaded.rows);''',
)

print("patched deterministic OCR precedence and bounded Registry lookup")
