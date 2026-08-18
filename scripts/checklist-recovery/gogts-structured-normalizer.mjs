const NUMBER_HEADERS = new Set(["card #", "number", "card number", "card no.", "card no", "no.", "no", "#"]);
const SUBJECT_HEADERS = new Set(["athlete", "player", "player name", "subject", "name", "description"]);
const SET_HEADERS = new Set(["card set", "set name", "set", "subset"]);
const TEAM_HEADERS = new Set(["team", "team name"]);
const SEQUENCE_HEADERS = new Set(["sequence", "seq.", "seq", "print run", "serial #", "serial number", "#'d", "serial #'d"]);

function clean(value) {
  let text = String(value ?? "")
    .normalize("NFKC")
    .replace(/[®™]/g, "")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (/^-?\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, "");
  return text;
}

function header(value) { return clean(value).toLowerCase(); }
function pipeCells(line) { return String(line || "").split(/\s*\|\s*/).map(clean); }
function indexOfHeader(cells, aliases) { return cells.findIndex((value) => aliases.has(header(value))); }

function headerMap(cells) {
  const number = indexOfHeader(cells, NUMBER_HEADERS);
  const subject = indexOfHeader(cells, SUBJECT_HEADERS);
  const setName = indexOfHeader(cells, SET_HEADERS);
  if (number < 0 || subject < 0 || setName < 0) return null;
  return {
    number,
    subject,
    setName,
    team: indexOfHeader(cells, TEAM_HEADERS),
    sequence: indexOfHeader(cells, SEQUENCE_HEADERS),
  };
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

function signature(rows) {
  return [...new Set(rows.map((row) => `${row.cardNumber}\u001f${row.subject}\u001f${row.team}`))]
    .sort().join("\u001e");
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

function canonicalSetName(names) {
  const values = [...new Set(names.map(clean).filter(Boolean))].sort((a, b) => a.length - b.length || a.localeCompare(b));
  if (!values.length) return "Base Set";
  for (const candidate of values) {
    const lower = candidate.toLowerCase();
    if (values.every((value) => {
      const next = value.toLowerCase();
      return next === lower || next.startsWith(`${lower} `) || next.startsWith(`${lower} -`);
    })) return candidate;
  }
  return values[0];
}

function parseStructuredRows(text) {
  const groups = new Map();
  let detected = false;
  let active = null;
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = String(rawLine || "").trim();
    if (!line) continue;
    if (line.startsWith("## ")) { active = null; continue; }
    const cells = pipeCells(line);
    if (!active) {
      const mapping = headerMap(cells);
      if (mapping) { active = mapping; detected = true; }
      continue;
    }
    const highest = Math.max(active.number, active.subject, active.setName, active.team, active.sequence);
    if (highest >= cells.length) continue;
    const cardNumber = clean(cells[active.number]);
    const subject = clean(cells[active.subject]);
    const setName = clean(cells[active.setName]);
    const team = active.team >= 0 ? clean(cells[active.team]) : "";
    const sequence = active.sequence >= 0 ? clean(cells[active.sequence]) : "";
    if (!cardNumber || !subject || !setName || NUMBER_HEADERS.has(header(cardNumber))) continue;
    const rows = groups.get(setName) || [];
    rows.push({ cardNumber, subject, team, sequence });
    groups.set(setName, rows);
  }
  return { detected, groups };
}

function normalizedBuckets(groups) {
  const byMembership = new Map();
  for (const [setName, sourceRows] of groups) {
    const rows = uniqueRows(sourceRows);
    if (!rows.length) continue;
    const key = `${setClass(setName)}\u001d${signature(rows)}`;
    const values = byMembership.get(key) || [];
    values.push({ setName, rows });
    byMembership.set(key, values);
  }
  const buckets = [];
  for (const values of byMembership.values()) {
    const membershipSize = values[0]?.rows.length || 0;
    if (membershipSize >= 5) {
      const name = canonicalSetName(values.map((value) => value.setName));
      const representative = values.find((value) => value.setName === name) || [...values].sort((a, b) => a.setName.length - b.setName.length || a.setName.localeCompare(b.setName))[0];
      buckets.push({ setName: name, rows: representative.rows });
      continue;
    }
    for (const value of values) buckets.push(value);
  }
  return buckets;
}

function safeCell(value) { return clean(value).replace(/\s*\|\s*/g, " / "); }

export function normalizeGoGtsStructuredText(text) {
  const { detected, groups } = parseStructuredRows(text);
  if (!detected || !groups.size) return { detected: false, text: String(text || ""), groupCount: 0, rowCount: 0 };
  const buckets = normalizedBuckets(groups).sort((a, b) => a.setName.localeCompare(b.setName, undefined, { numeric: true, sensitivity: "base" }));
  const lines = ["## Checklist"];
  let rowCount = 0;
  for (const bucket of buckets) {
    lines.push(`## ${safeCell(bucket.setName)}`);
    for (const row of bucket.rows) {
      const values = [safeCell(row.cardNumber), safeCell(row.subject)];
      if (row.team) values.push(safeCell(row.team));
      lines.push(values.join(" | "));
      rowCount += 1;
    }
  }
  return { detected: true, text: lines.join("\n"), groupCount: buckets.length, rowCount };
}

export function runStructuredRecoverySelfTest() {
  const source = [
    "## Sheet1",
    "Card Number | Set Name | Player | Auto | Mem/Tech | #'d | SP's | Odds | Pts.",
    "1 | Base Set | Dave Bolland | | | | | |",
    "2 | Base Set | Jonathan Toews | | | | | |",
  ].join("\n");
  const out = normalizeGoGtsStructuredText(source);
  if (!out.detected || out.rowCount !== 2 || !out.text.includes("1 | Dave Bolland")) throw new Error(`Structured recovery self-test failed: ${JSON.stringify(out)}`);
  return { status: "passed", rows: out.rowCount };
}
