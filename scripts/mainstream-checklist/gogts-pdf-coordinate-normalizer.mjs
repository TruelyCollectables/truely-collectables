import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TEMP_ROOT = resolve(process.cwd(), ".checklist-discovery/gogts-coordinate-tmp");

function clean(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[®™]/g, "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function setClass(name) {
  const text = clean(name).toLowerCase();
  const auto = /autograph|signature|signed/.test(text);
  const memorabilia = /relic|memorabilia|patch|swatch|jersey/.test(text);
  if (auto && memorabilia) return "autograph-memorabilia";
  if (auto) return "autograph";
  if (memorabilia) return "memorabilia";
  return "standard";
}

function uniqueRows(rows) {
  const output = [];
  const seen = new Set();
  for (const row of rows) {
    const key = `${row.cardNumber}\u001f${row.subject}\u001f${row.team}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(row);
  }
  return output;
}

function membershipSignature(rows) {
  return [...new Set(rows.map((row) => `${row.cardNumber}\u001f${row.subject}\u001f${row.team}`))]
    .sort()
    .join("\u001e");
}

function prefixCanonical(names) {
  const values = [...new Set(names.map(clean).filter(Boolean))].sort(
    (a, b) => a.length - b.length || a.localeCompare(b),
  );
  for (const candidate of values) {
    const lower = candidate.toLowerCase();
    if (
      values.every((value) => {
        const next = value.toLowerCase();
        return next === lower || next.startsWith(`${lower} `) || next.startsWith(`${lower} -`);
      })
    ) {
      return candidate;
    }
  }
  return null;
}

function baseSuffixCanonical(names) {
  const values = [...new Set(names.map(clean).filter(Boolean))];
  for (const candidate of values) {
    const match = candidate.match(/^Base(?: Set)?\s*-\s*(.+)$/i);
    if (!match) continue;
    const suffix = clean(match[1]);
    if (!suffix) continue;
    if (
      values.every(
        (value) =>
          value.toLowerCase() === candidate.toLowerCase() ||
          value.toLowerCase().endsWith(` - ${suffix.toLowerCase()}`),
      )
    ) {
      return { candidate, suffix };
    }
  }
  return null;
}

function canonicalSetName(names) {
  const prefix = prefixCanonical(names);
  if (prefix) return prefix;
  const values = [...new Set(names.map(clean).filter(Boolean))].sort(
    (a, b) => a.length - b.length || a.localeCompare(b),
  );
  if (!values.length) return "Base Set";
  const tokenized = values.map((value) => value.match(/[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g) || []);
  const common = [];
  const width = Math.min(...tokenized.map((tokens) => tokens.length));
  for (let index = 0; index < width; index += 1) {
    const valuesAtIndex = new Set(tokenized.map((tokens) => tokens[index].toLowerCase()));
    if (valuesAtIndex.size !== 1) break;
    common.push(tokenized[0][index]);
  }
  while (
    common.length &&
    /^(?:prizm|prizms|parallel|parallels|refractor|refractors)$/i.test(common.at(-1))
  ) {
    common.pop();
  }
  if (common.length >= 2) return common.join(" ");
  return values[0];
}

function serialRun(rows) {
  const values = rows
    .map((row) => clean(row.sequence))
    .map((value) => value.match(/^\/?(\d{1,7})$/)?.[1] || value.match(/\/(\d{1,7})\b/)?.[1] || null)
    .filter(Boolean)
    .map(Number);
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : null;
}

function parallelName(baseName, variantName, suffixRelation) {
  const base = clean(baseName);
  const variant = clean(variantName);
  if (!variant || variant.toLowerCase() === base.toLowerCase()) return null;
  const lowerBase = base.toLowerCase();
  const lowerVariant = variant.toLowerCase();
  if (lowerVariant.startsWith(`${lowerBase} - `)) return clean(variant.slice(base.length + 3));
  if (lowerVariant.startsWith(`${lowerBase} `)) return clean(variant.slice(base.length + 1));
  if (suffixRelation && lowerVariant.endsWith(` - ${suffixRelation.suffix.toLowerCase()}`)) {
    return clean(variant.slice(0, -(suffixRelation.suffix.length + 3)));
  }
  return variant;
}

function safeCell(value) {
  return clean(value).replace(/\s*\|\s*/g, " / ");
}

function bucketRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const setName = clean(row.setName);
    if (!setName) continue;
    const list = groups.get(setName) || [];
    list.push({
      cardNumber: clean(row.cardNumber),
      subject: clean(row.subject),
      team: clean(row.team),
      sequence: clean(row.sequence),
    });
    groups.set(setName, list);
  }

  const byMembership = new Map();
  for (const [setName, sourceRows] of groups) {
    const deduped = uniqueRows(sourceRows).filter(
      (row) => row.cardNumber && row.subject && !/^(?:card|card #|number)$/i.test(row.cardNumber),
    );
    if (!deduped.length) continue;
    const key = `${setClass(setName)}\u001d${membershipSignature(deduped)}`;
    const values = byMembership.get(key) || [];
    values.push({ setName, rows: deduped });
    byMembership.set(key, values);
  }

  const buckets = [];
  for (const values of byMembership.values()) {
    const membershipSize = values[0]?.rows.length || 0;
    const names = values.map((value) => value.setName);
    const prefix = prefixCanonical(names);
    const suffixRelation = baseSuffixCanonical(names);
    const shouldCollapse = values.length > 1 && (membershipSize >= 5 || Boolean(prefix) || Boolean(suffixRelation));
    if (!shouldCollapse) {
      for (const value of values) buckets.push({ ...value, parallels: [] });
      continue;
    }

    const canonical = prefix || suffixRelation?.candidate || canonicalSetName(names);
    const representative =
      values.find((value) => value.setName.toLowerCase() === canonical.toLowerCase()) ||
      [...values].sort((a, b) => a.setName.length - b.setName.length || a.setName.localeCompare(b.setName))[0];
    const parallels = [];
    for (const value of values) {
      if (value === representative) continue;
      const name = parallelName(representative.setName, value.setName, suffixRelation);
      if (!name) continue;
      parallels.push({ name, serialRun: serialRun(value.rows) });
    }
    buckets.push({ setName: representative.setName, rows: representative.rows, parallels });
  }
  return buckets.sort((a, b) => a.setName.localeCompare(b.setName, undefined, { numeric: true, sensitivity: "base" }));
}

const PYTHON_EXTRACTOR = String.raw`
import json, re, subprocess, sys, xml.etree.ElementTree as ET

path = sys.argv[1]

def clean(value):
    return re.sub(r'\s+', ' ', str(value or '').replace('\u00a0', ' ')).strip()

def group_by_y(words, tolerance=1.8):
    rows = []
    for x, y, text in sorted(words, key=lambda item: (item[1], item[0])):
        target = None
        for row in rows[-3:]:
            if abs(row['y'] - y) <= tolerance:
                target = row
                break
        if target is None:
            rows.append({'y': y, 'words': [(x, text)]})
        else:
            target['words'].append((x, text))
    return rows

def phrase_start(words, phrase):
    tokens = phrase.lower().split()
    ordered = sorted(words)
    texts = [clean(text).lower() for _, text in ordered]
    for index in range(0, len(ordered) - len(tokens) + 1):
        if texts[index:index + len(tokens)] == tokens:
            return ordered[index][0]
    return None

def detect_layout(row):
    words = sorted(row['words'])
    aliases = {
        'number': ['card #', 'card number', 'card'],
        'setName': ['set name', 'card set'],
        'subject': ['player name', 'athlete', 'description'],
        'team': ['team name', 'team'],
        'sequence': ["serial #'d", "#'d", 'sequence', 'print run'],
        'ignore_position': ['position'],
        'ignore_rookie': ['rookie'],
        'ignore_auto': ['auto'],
        'ignore_mem': ['mem/tech'],
        'ignore_sps': ['sps'],
        'ignore_odds': ['stated odds'],
        'ignore_point': ['point'],
    }
    found = {}
    for kind, phrases in aliases.items():
        for phrase in phrases:
            start = phrase_start(words, phrase)
            if start is not None:
                found[kind] = start
                break
    if not all(kind in found for kind in ('number', 'setName', 'subject')):
        return None
    if found['number'] == found['setName']:
        return None
    return sorted((start, kind) for kind, start in found.items())

def assign_row(row, layout):
    starts = [start for start, _ in layout]
    values = {kind: [] for _, kind in layout}
    for x, text in sorted(row['words']):
        selected = -1
        for index, start in enumerate(starts):
            if x + 2.5 >= start:
                selected = index
            else:
                break
        if selected >= 0:
            values[layout[selected][1]].append(text)
    return {kind: clean(' '.join(parts)) for kind, parts in values.items()}

def acceptable_number(value):
    value = clean(value)
    if not value or len(value) > 32 or re.search(r'\s', value):
        return False
    if value.lower() in {'card', 'number', 'card#', 'card #'}:
        return False
    return bool(re.match(r'^[A-Za-z0-9#.-]+$', value))

process = subprocess.Popen(['pdftotext', '-bbox-layout', path, '-'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
rows_out = []
layout = None
namespace_suffix = '}page'
try:
    for event, element in ET.iterparse(process.stdout, events=('end',)):
        if not str(element.tag).endswith(namespace_suffix):
            continue
        words = []
        for word in element.iter():
            if not str(word.tag).endswith('}word'):
                continue
            text = clean(''.join(word.itertext()))
            if not text:
                continue
            try:
                x = float(word.attrib.get('xMin'))
                y = float(word.attrib.get('yMin'))
            except (TypeError, ValueError):
                continue
            words.append((x, y, text))
        for row in group_by_y(words):
            candidate = detect_layout(row)
            if candidate is not None:
                layout = candidate
                continue
            if layout is None:
                continue
            values = assign_row(row, layout)
            card_number = clean(values.get('number'))
            set_name = clean(values.get('setName'))
            subject = clean(values.get('subject'))
            team = clean(values.get('team'))
            sequence = clean(values.get('sequence'))
            if not acceptable_number(card_number) or not set_name or not subject:
                continue
            rows_out.append({
                'cardNumber': card_number,
                'setName': set_name,
                'subject': subject,
                'team': team,
                'sequence': sequence,
            })
        element.clear()
finally:
    if process.stdout:
        process.stdout.close()
    stderr = process.stderr.read().decode('utf-8', errors='replace') if process.stderr else ''
    code = process.wait()
    if code != 0:
        raise RuntimeError(f'pdftotext -bbox-layout failed ({code}): {stderr[:1000]}')

print(json.dumps(rows_out, ensure_ascii=False))
`;

export function extractGoGtsPdfCoordinateRows(bytes) {
  mkdirSync(TEMP_ROOT, { recursive: true });
  const inputPath = resolve(TEMP_ROOT, `${sha256(bytes).slice(0, 16)}.pdf`);
  writeFileSync(inputPath, bytes);
  try {
    const output = execFileSync("python3", ["-c", PYTHON_EXTRACTOR, inputPath], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      timeout: 240_000,
    });
    const rows = JSON.parse(output || "[]");
    if (!Array.isArray(rows)) throw new Error("GoGTS coordinate extractor returned non-array output.");
    return rows;
  } finally {
    rmSync(inputPath, { force: true });
  }
}

export function normalizeGoGtsPdfCoordinates(bytes) {
  const rows = extractGoGtsPdfCoordinateRows(bytes);
  if (!rows.length) return { detected: false, rows: [], text: "", buckets: [] };
  const buckets = bucketRows(rows);
  if (!buckets.length) return { detected: false, rows, text: "", buckets: [] };

  const lines = ["## Checklist"];
  for (const bucket of buckets) {
    lines.push(`## ${safeCell(bucket.setName)}`);
    for (const row of bucket.rows) {
      const values = [safeCell(row.cardNumber), safeCell(row.subject), safeCell(row.team)];
      lines.push(values.join(" | "));
    }
    for (const parallel of bucket.parallels) {
      const suffix = parallel.serialRun ? ` /${parallel.serialRun}` : "";
      lines.push(`Parallel: ${safeCell(parallel.name)}${suffix}`);
    }
  }
  return { detected: true, rows, buckets, text: lines.join("\n") };
}

export function normalizeCoordinateParsedChecklist(parsed) {
  const output = structuredClone(parsed);
  for (const card of output.cards || []) {
    if (/\b(?:rookie|rookies|young guns?|1st round rookies|future watch)\b/i.test(card.setName || "")) {
      card.rookieDesignation = true;
    }
  }
  for (const parallel of output.parallels || []) {
    parallel.name = clean(String(parallel.name || "").replace(/^Parallel\s*:\s*/i, ""));
  }
  return output;
}

export function runGoGtsCoordinateNormalizerSelfTest() {
  const sampleRows = [
    { cardNumber: "1", setName: "Base", subject: "Alpha Player", team: "Team A", sequence: "" },
    { cardNumber: "2", setName: "Base", subject: "Beta Player", team: "Team B", sequence: "" },
    { cardNumber: "1", setName: "Base Gold", subject: "Alpha Player", team: "Team A", sequence: "10" },
    { cardNumber: "2", setName: "Base Gold", subject: "Beta Player", team: "Team B", sequence: "10" },
  ];
  const buckets = bucketRows(sampleRows);
  if (buckets.length !== 1 || buckets[0].parallels.length !== 1 || buckets[0].parallels[0].serialRun !== 10) {
    throw new Error(`Coordinate normalizer grouping self-test failed: ${JSON.stringify(buckets)}`);
  }
  return { status: "passed", membershipCollapse: true, serialRun: true };
}
