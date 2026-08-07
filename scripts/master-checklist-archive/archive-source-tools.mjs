import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";

import { normalized, parseChecklist, sha256 } from "../mainstream-checklist/source-tools.mjs";

const TEMP_ROOT = resolve(process.cwd(), ".checklist-discovery/master-archive-tmp");
const ARCHIVE_ROOT_NAME = ".card-checklist-master-archive";
const STRUCTURED = new Set([".xlsx", ".xls", ".csv", ".tsv"]);
const CARD_NUMBER = /^(?:\d{1,5}[A-Za-z]?|[A-Z]{1,12}-?[A-Z0-9]{1,18}|NNO|NO#)$/i;

function extension(name) {
  const value = String(name || "").toLowerCase();
  const duplicate = value.replace(/\.duplicate-of\.txt$/i, "");
  return extname(duplicate);
}

function mimeFor(name) {
  switch (extension(name)) {
    case ".xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".xls": return "application/vnd.ms-excel";
    case ".csv": return "text/csv";
    case ".tsv": return "text/tab-separated-values";
    default: return "text/plain";
  }
}

function candidatePath(root, candidate, file) {
  if (file.duplicateOf) return resolve(root, file.duplicateOf);
  return resolve(root, candidate.archivePath, file.name);
}

function checklistTextFile(candidate) {
  return (candidate.files || []).find((file) => file.role === "checklist-text") || null;
}

function structuredFiles(candidate) {
  return (candidate.files || [])
    .filter((file) => file.role === "source-download" && STRUCTURED.has(extension(file.name)))
    .sort((a, b) => {
      const rank = new Map([[".xlsx", 0], [".xls", 1], [".csv", 2], [".tsv", 3]]);
      return (rank.get(extension(a.name)) ?? 10) - (rank.get(extension(b.name)) ?? 10);
    });
}

function workbookToText(path, mime) {
  const python = String.raw`
import csv, sys
path, mime = sys.argv[1], sys.argv[2]
def cell(v):
    if v is None: return ''
    if isinstance(v, float) and v.is_integer(): return str(int(v))
    return str(v).strip().replace('\n', ' ')
if path.lower().endswith('.xlsx') or 'openxmlformats' in mime:
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    for ws in wb.worksheets:
        print('## ' + ws.title)
        for row in ws.iter_rows(values_only=True):
            vals = [cell(v) for v in row]
            if any(vals): print(' | '.join(vals))
else:
    import xlrd
    wb = xlrd.open_workbook(path)
    for ws in wb.sheets():
        print('## ' + ws.name)
        for r in range(ws.nrows):
            vals = [cell(ws.cell_value(r, c)) for c in range(ws.ncols)]
            if any(vals): print(' | '.join(vals))
`;
  return execFileSync("python3", ["-c", python, path, mime], {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    timeout: 240_000,
  }).trim();
}

function delimitedToText(bytes, delimiter) {
  mkdirSync(TEMP_ROOT, { recursive: true });
  const path = resolve(TEMP_ROOT, `${sha256(bytes).slice(0, 16)}.txt`);
  writeFileSync(path, bytes);
  const python = String.raw`
import csv, sys
path, delim = sys.argv[1], sys.argv[2]
with open(path, 'r', encoding='utf-8-sig', errors='replace', newline='') as fh:
    for row in csv.reader(fh, delimiter=delim):
        vals = [str(v).strip().replace('\n', ' ') for v in row]
        if any(vals): print(' | '.join(vals))
`;
  try {
    return execFileSync("python3", ["-c", python, path, delimiter], {
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
      timeout: 180_000,
    }).trim();
  } finally {
    rmSync(path, { force: true });
  }
}

function headerKey(value) {
  return normalized(value).toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();
}

function headerIndex(headers, patterns) {
  return headers.findIndex((value) => patterns.some((pattern) => pattern.test(value)));
}

function inferSetType(name) {
  const value = normalized(name).toLowerCase();
  if (!value || /^(base|base set|base cards)$/.test(value)) return "Base Set";
  return normalized(name);
}

function parseStructuredTable(entry, text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let headerAt = -1;
  let indices = null;
  for (let index = 0; index < Math.min(lines.length, 80); index += 1) {
    if (!lines[index].includes(" | ")) continue;
    const headers = lines[index].split(" | ").map(headerKey);
    const card = headerIndex(headers, [/^card #$/, /^card no$/, /^card number$/, /^number$/, /^#$/]);
    const player = headerIndex(headers, [/^player$/, /^subject$/, /^name$/, /^athlete$/, /^cardholder$/, /^character$/]);
    if (card < 0 || player < 0) continue;
    indices = {
      card,
      player,
      team: headerIndex(headers, [/^team$/, /^club$/, /^country$/]),
      set: headerIndex(headers, [/^card set$/, /^set$/, /^subset$/, /^insert set$/, /^insert$/, /^card type$/, /^type$/]),
      parallel: headerIndex(headers, [/^parallel$/, /^parallel name$/, /^variant$/, /^variation$/]),
      serial: headerIndex(headers, [/^print run$/, /^serial$/, /^serial run$/, /^numbered to$/]),
    };
    headerAt = index;
    break;
  }
  if (headerAt < 0 || !indices) return null;

  const cards = [];
  for (const line of lines.slice(headerAt + 1)) {
    if (line.startsWith("## ")) continue;
    const cells = line.split(" | ").map(normalized);
    const cardNumber = cells[indices.card] || "";
    const player = cells[indices.player] || "";
    if (!CARD_NUMBER.test(cardNumber) || !player || /^(player|subject|name)$/i.test(player)) continue;
    const setName = inferSetType(indices.set >= 0 ? cells[indices.set] : "Base Set");
    const parallel = indices.parallel >= 0 ? cells[indices.parallel] || null : null;
    const serialText = indices.serial >= 0 ? cells[indices.serial] || "" : "";
    const serialRun = /^\d{1,7}$/.test(serialText) ? Number(serialText) : null;
    cards.push({
      setName: parallel ? `${setName} - ${parallel}` : setName,
      cardNumber,
      players: [player.replace(/\s+(?:RC|ROOKIE)$/i, "").trim()],
      teams: indices.team >= 0 && cells[indices.team] ? [cells[indices.team]] : [],
      rookieDesignation: /(?:\bRC\b|\brookie\b)/i.test(player),
      firstBowmanDesignation: /first bowman/i.test(`${setName} ${player}`),
      autographStatus: /autograph|signature|signed/i.test(setName) ? "autograph" : "non-auto",
      memorabiliaStatus: /relic|memorabilia|patch|swatch|jersey/i.test(setName) ? "memorabilia" : "non-memorabilia",
      variation: parallel || null,
      sourceNotes: serialRun ? `Archived structured row; serial run ${serialRun}` : "Archived structured row",
    });
  }
  if (!cards.length) return null;
  const exact = new Map();
  for (const card of cards) {
    const key = `${card.setName.toLowerCase()}::${card.cardNumber.toLowerCase()}::${card.players.join("+").toLowerCase()}`;
    if (!exact.has(key)) exact.set(key, card);
  }
  return {
    cards: [...exact.values()],
    parallels: [],
    warnings: [{ code: "master_archive_structured_source", severity: "warning", message: "Parsed from archived structured source data." }],
    errors: [],
  };
}

function looksCardLine(line) {
  const match = normalized(line).match(/^([^\s]+)\s+(.+)$/);
  return Boolean(match && CARD_NUMBER.test(match[1]) && !/^(?:19|20)\d{2}$/.test(match[1]));
}

function parseBigApple(entry, raw) {
  const lines = String(raw || "").split(/\r?\n/).map(normalized).filter(Boolean);
  const semantic = [];
  let section = null;
  let table = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^(?:More |Frequently Asked Questions|Checklist data sourced|Shop Hobby Boxes|What to chase:)/i.test(line)) {
      table = false;
      if (/^(?:More |Frequently Asked Questions)/i.test(line)) section = null;
      continue;
    }
    const heading = line.match(/^(.{2,120}?)\s+([0-9][0-9,]*)\s+cards?$/i);
    if (heading && !/[.!?]$/.test(heading[1])) {
      section = heading[1].replace(/^Checklist\s*/i, "").trim() || "Base Set";
      semantic.push(`## ${section} Checklist`);
      table = false;
      continue;
    }
    if (/^#\s+Player(?:\s+Team)?(?:\s+Scan)?$/i.test(line)) {
      table = Boolean(section);
      continue;
    }
    if (!table || !section || !looksCardLine(line)) continue;
    const match = line.match(/^([^\s]+)\s+(.+)$/);
    const cardNumber = match[1];
    const player = match[2];
    let team = "";
    const next = lines[index + 1] || "";
    if (
      next &&
      !looksCardLine(next) &&
      !/^#\s+Player/i.test(next) &&
      !/^.{2,120}?\s+[0-9][0-9,]*\s+cards?$/i.test(next) &&
      next.length <= 100 &&
      !/^(?:Parallels?|Autographs?|Inserts?|Variations?|Notes?|Shop|More )/i.test(next)
    ) {
      team = next;
      index += 1;
    }
    semantic.push(`${cardNumber} | ${player} | ${team}`);
  }
  if (!semantic.some((line) => line.includes(" | "))) return null;
  return parseChecklist({ minimumCardRows: Math.max(3, Number(entry.minimumCardRows || 3)) }, semantic.join("\n"));
}

function declaredTotal(text) {
  const head = normalized(String(text || "").slice(0, 8_000));
  const patterns = [
    /\bindexes?\s+([0-9][0-9,]*)\s+total cards\b/i,
    /\btotal cards\s*:?\s*([0-9][0-9,]*)\b/i,
    /\bcomplete set\s*[-:]?\s*([0-9][0-9,]*)\s+cards\b/i,
    /\bchecklist\s*\(\s*([0-9][0-9,]*)\s+cards?\s*\)/i,
  ];
  for (const pattern of patterns) {
    const match = head.match(pattern);
    if (match) return Number(match[1].replace(/,/g, ""));
  }
  return null;
}

function quality(entry, candidate, parsed, text, mode) {
  const errors = [...(parsed.errors || [])];
  const expected = Number(candidate.checklistRows || 0);
  const count = Number(parsed.cards?.length || 0);
  const declared = declaredTotal(text);
  if (count < 3) {
    errors.push({ code: "master_archive_insufficient_rows", severity: "error", message: `Only ${count} deterministic card rows were parsed.` });
  }
  if (expected >= 20 && count < Math.floor(expected * 0.90)) {
    errors.push({ code: "master_archive_row_count_shortfall", severity: "error", message: `Parsed ${count} rows from an archive item that recorded ${expected} checklist rows.` });
  }
  if (expected >= 20 && count > Math.max(expected + 25, Math.ceil(expected * 1.20))) {
    errors.push({ code: "master_archive_row_count_excess", severity: "error", message: `Parsed ${count} rows from an archive item that recorded ${expected}; probable page contamination.` });
  }
  if (declared && declared >= 20 && count < Math.floor(declared * 0.95)) {
    errors.push({ code: "master_archive_declared_count_shortfall", severity: "error", message: `Source declares ${declared} cards but only ${count} deterministic rows were parsed.` });
  }
  return {
    ...parsed,
    errors,
    warnings: [...(parsed.warnings || []), { code: "master_archive_mode", severity: "warning", message: `Master archive parser mode: ${mode}.` }],
  };
}

function readArchivedFile(root, candidate, file) {
  const path = candidatePath(root, candidate, file);
  if (!existsSync(path)) throw new Error(`Archived source file is missing: ${path}`);
  return { path, bytes: readFileSync(path), mimeType: mimeFor(file.name), filename: file.name.replace(/\.DUPLICATE-OF\.txt$/i, "") };
}

export function parseArchivedCandidate(entry, candidate, extractedRoot) {
  const root = resolve(extractedRoot, ARCHIVE_ROOT_NAME);
  const structured = structuredFiles(candidate);
  for (const file of structured) {
    try {
      const source = readArchivedFile(root, candidate, file);
      let text;
      if ([".xlsx", ".xls"].includes(extension(file.name))) text = workbookToText(source.path, source.mimeType);
      else text = delimitedToText(source.bytes, extension(file.name) === ".tsv" ? "\t" : ",");
      const tabular = parseStructuredTable(entry, text);
      const parsed = tabular || parseChecklist(entry, text);
      const checked = quality(entry, candidate, parsed, text, `structured-${extension(file.name).slice(1)}`);
      if (!checked.errors.some((issue) => issue.severity === "error")) {
        return {
          parsed: checked,
          text,
          source: {
            bytes: source.bytes,
            mimeType: source.mimeType,
            filename: source.filename,
            selectedUrl: candidate.sourceUrl,
            finalUrl: candidate.sourceUrl,
            archivedMasterSource: true,
          },
          mode: `structured-${extension(file.name).slice(1)}`,
        };
      }
    } catch {
      // Continue to the saved checklist text or another candidate.
    }
  }

  const textFile = checklistTextFile(candidate);
  if (!textFile) throw new Error("Archive candidate has no saved checklist text or usable structured file.");
  const source = readArchivedFile(root, candidate, textFile);
  const text = source.bytes.toString("utf8");
  let parsed = null;
  let mode = "saved-text";
  if (candidate.source === "bigapplecollects") {
    parsed = parseBigApple(entry, text);
    mode = "bigapple-saved-text";
  } else if (candidate.source === "breakninja") {
    const semantic = text.replace(/\t/g, " | ");
    parsed = parseStructuredTable(entry, semantic) || parseChecklist(entry, semantic);
    mode = "breakninja-tabular-text";
  } else if (["cardboardchecklist", "cardboardconnection", "beckett", "gogts"].includes(candidate.source)) {
    throw new Error(`${candidate.source} archive text loses table-cell boundaries; use live/structured source before accepting it.`);
  } else {
    parsed = parseChecklist(entry, text);
  }
  if (!parsed) throw new Error(`Could not parse archived ${candidate.source} checklist text.`);
  const checked = quality(entry, candidate, parsed, text, mode);
  if (checked.errors.some((issue) => issue.severity === "error")) {
    const message = checked.errors.slice(0, 3).map((issue) => issue.message).join("; ");
    throw new Error(message || "Archived checklist did not pass deterministic completeness checks.");
  }
  return {
    parsed: checked,
    text,
    source: {
      bytes: source.bytes,
      mimeType: "text/plain",
      filename: "checklist.txt",
      selectedUrl: candidate.sourceUrl,
      finalUrl: candidate.sourceUrl,
      archivedMasterSource: true,
    },
    mode,
  };
}

export function parseSourceBytes(entry, source) {
  const mime = String(source.mimeType || "application/octet-stream").toLowerCase();
  let text = "";
  if (mime.includes("spreadsheetml") || mime.includes("ms-excel")) {
    mkdirSync(TEMP_ROOT, { recursive: true });
    const suffix = mime.includes("spreadsheetml") ? ".xlsx" : ".xls";
    const path = resolve(TEMP_ROOT, `${sha256(source.bytes).slice(0, 16)}${suffix}`);
    writeFileSync(path, source.bytes);
    try { text = workbookToText(path, mime); } finally { rmSync(path, { force: true }); }
  } else if (mime.includes("csv")) {
    text = delimitedToText(source.bytes, ",");
  } else if (mime.includes("tab-separated")) {
    text = delimitedToText(source.bytes, "\t");
  } else {
    text = Buffer.from(source.bytes).toString("utf8");
  }
  const tabular = parseStructuredTable(entry, text);
  return { text, parsed: tabular || parseChecklist(entry, text) };
}
