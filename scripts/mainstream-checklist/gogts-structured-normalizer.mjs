const NUMBER_HEADERS = new Set(["card #", "number", "card number", "card no.", "card no", "no.", "no", "#"]);
const SUBJECT_HEADERS = new Set(["athlete", "player", "subject", "name"]);
const SET_HEADERS = new Set(["card set", "set", "subset"]);
const TEAM_HEADERS = new Set(["team"]);
const SEQUENCE_HEADERS = new Set(["sequence", "seq.", "seq", "print run", "serial #", "serial number"]);

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

function header(value) {
  return clean(value).toLowerCase();
}

function csvCells(line) {
  const cells = [];
  let value = "";
  let quoted = false;
  const text = String(line || "");
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(clean(value));
      value = "";
      continue;
    }
    value += char;
  }
  cells.push(clean(value));
  return cells;
}

function pipeCells(line) {
  return String(line || "").split(/\s*\|\s*/).map(clean);
}

function indexOfHeader(cells, aliases) {
  return cells.findIndex((value) => aliases.has(header(value)));
}

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
    .sort()
    .join("\u001e");
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
  const values = [...new Set(names.map(clean).filter(Boolean))].sort(
    (a, b) => a.length - b.length || a.localeCompare(b),
  );
  if (!values.length) return "Base Set";

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

function parseStructuredRows(text) {
  const groups = new Map();
  let detected = false;
  let active = null;
  let delimiter = null;

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = String(rawLine || "").trim();
    if (!line) continue;
    if (line.startsWith("## ")) {
      active = null;
      delimiter = null;
      continue;
    }

    const choices = [];
    if (line.includes(" | ")) choices.push(["pipe", pipeCells(line)]);
    if (line.includes(",")) choices.push(["csv", csvCells(line)]);

    if (!active) {
      for (const [kind, cells] of choices) {
        const mapping = headerMap(cells);
        if (!mapping) continue;
        active = mapping;
        delimiter = kind;
        detected = true;
        break;
      }
      continue;
    }

    const cells = delimiter === "pipe" ? pipeCells(line) : csvCells(line);
    const highest = Math.max(
      active.number,
      active.subject,
      active.setName,
      active.team,
      active.sequence,
    );
    if (highest >= cells.length) continue;

    const cardNumber = clean(cells[active.number]);
    const subject = clean(cells[active.subject]);
    const setName = clean(cells[active.setName]);
    const team = active.team >= 0 ? clean(cells[active.team]) : "";
    const sequence = active.sequence >= 0 ? clean(cells[active.sequence]) : "";
    if (!cardNumber || !subject || !setName) continue;
    if (NUMBER_HEADERS.has(header(cardNumber))) continue;

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
      const representative =
        values.find((value) => value.setName === name) ||
        [...values].sort(
          (a, b) => a.setName.length - b.setName.length || a.setName.localeCompare(b.setName),
        )[0];
      buckets.push({ setName: name, rows: representative.rows });
      continue;
    }
    for (const value of values) buckets.push(value);
  }
  return buckets;
}

function safeCell(value) {
  return clean(value).replace(/\s*\|\s*/g, " / ");
}

export function normalizeGoGtsStructuredText(text) {
  const { detected, groups } = parseStructuredRows(text);
  if (!detected || !groups.size) return text;

  const buckets = normalizedBuckets(groups).sort((a, b) =>
    a.setName.localeCompare(b.setName, undefined, { numeric: true, sensitivity: "base" }),
  );
  const headingCounts = new Map();
  const lines = ["## Checklist"];
  for (const bucket of buckets) {
    const key = bucket.setName.toLowerCase();
    const count = (headingCounts.get(key) || 0) + 1;
    headingCounts.set(key, count);
    const heading = count === 1 ? bucket.setName : `${bucket.setName} - Variant ${count}`;
    lines.push(`## ${safeCell(heading)}`);
    for (const row of bucket.rows) {
      const values = [safeCell(row.cardNumber), safeCell(row.subject)];
      if (row.team) values.push(safeCell(row.team));
      lines.push(values.join(" | "));
    }
  }
  return lines.join("\n");
}

export function runGoGtsStructuredNormalizerSelfTest() {
  const pipe = [
    "## Sheet1",
    "CARD SET | ATHLETE | TEAM | CARD # | SEQUENCE",
    "Base | Alpha Player | Team A | 1.0 | ",
    "Base | Beta Player | Team B | 2.0 | ",
    "Base Holo | Alpha Player | Team A | 1.0 | ",
    "Base Holo | Beta Player | Team B | 2.0 | ",
    "Base Autographs Gold | Alpha Player | Team A | A-1 | 10.0",
    "Base Autographs Gold | Beta Player | Team B | A-2 | 10.0",
  ].join("\n");
  const csv = [
    "Card Set,Number,Player,Team,Seq.",
    "Base,1,Alpha Player,Team A,",
    "Base,2,Beta Player,Team B,",
  ].join("\n");
  const pipeNormalized = normalizeGoGtsStructuredText(pipe);
  const csvNormalized = normalizeGoGtsStructuredText(csv);
  if (!pipeNormalized.includes("1 | Alpha Player | Team A")) {
    throw new Error(`Pipe structured normalization failed: ${pipeNormalized}`);
  }
  if (!pipeNormalized.includes("## Base Autographs Gold")) {
    throw new Error(`Autograph set class was collapsed into base: ${pipeNormalized}`);
  }
  if (!csvNormalized.includes("2 | Beta Player | Team B")) {
    throw new Error(`CSV structured normalization failed: ${csvNormalized}`);
  }
  return { status: "passed", pipe: true, csv: true, setClassGuard: true };
}
