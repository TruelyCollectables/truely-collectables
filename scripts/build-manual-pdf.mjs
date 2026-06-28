import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const manualPath = path.join(root, "docs", "TCOS_OPERATOR_MANUAL.md");
const htmlPath = path.join(root, "docs", "TCOS_OPERATOR_MANUAL_PRINT.html");
const pdfPath = path.join(root, "docs", "TCOS_OPERATOR_MANUAL.pdf");

if (!fs.existsSync(manualPath)) {
  console.error(`Manual not found: ${manualPath}`);
  process.exit(1);
}

const markdown = fs.readFileSync(manualPath, "utf8");

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderInline(value) {
  let rendered = escapeHtml(value);

  rendered = rendered.replace(/`([^`]+)`/g, "<code>$1</code>");
  rendered = rendered.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  rendered = rendered.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2">$1</a>',
  );

  return rendered;
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function closeList(state, output) {
  if (state.listType) {
    output.push(`</${state.listType}>`);
    state.listType = null;
  }
}

function renderMarkdown(source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const output = [];
  const state = { codeBlock: false, codeLines: [], listType: null };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line.startsWith("```")) {
      closeList(state, output);

      if (state.codeBlock) {
        output.push(`<pre><code>${escapeHtml(state.codeLines.join("\n"))}</code></pre>`);
        state.codeBlock = false;
        state.codeLines = [];
      } else {
        state.codeBlock = true;
        state.codeLines = [];
      }

      continue;
    }

    if (state.codeBlock) {
      state.codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      closeList(state, output);
      continue;
    }

    if (line.trim().startsWith("|") && lines[index + 1] && isTableSeparator(lines[index + 1])) {
      closeList(state, output);

      const headers = splitTableRow(line);
      index += 2;
      const rows = [];

      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }

      index -= 1;

      output.push("<table>");
      output.push("<thead><tr>");
      for (const header of headers) {
        output.push(`<th>${renderInline(header)}</th>`);
      }
      output.push("</tr></thead>");
      output.push("<tbody>");
      for (const row of rows) {
        output.push("<tr>");
        for (const cell of row) {
          output.push(`<td>${renderInline(cell)}</td>`);
        }
        output.push("</tr>");
      }
      output.push("</tbody></table>");
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList(state, output);
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = /^\s*[-*]\s+(.*)$/.exec(line);
    if (unordered) {
      if (state.listType !== "ul") {
        closeList(state, output);
        state.listType = "ul";
        output.push("<ul>");
      }
      output.push(`<li>${renderInline(unordered[1])}</li>`);
      continue;
    }

    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ordered) {
      if (state.listType !== "ol") {
        closeList(state, output);
        state.listType = "ol";
        output.push("<ol>");
      }
      output.push(`<li>${renderInline(ordered[1])}</li>`);
      continue;
    }

    closeList(state, output);
    output.push(`<p>${renderInline(line)}</p>`);
  }

  if (state.codeBlock) {
    output.push(`<pre><code>${escapeHtml(state.codeLines.join("\n"))}</code></pre>`);
  }

  closeList(state, output);
  return output.join("\n");
}

const browserCandidates = [
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

const browserPath = browserCandidates.find((candidate) => fs.existsSync(candidate));
const body = renderMarkdown(markdown);
const generatedAt = new Date().toISOString().slice(0, 10);

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TCOS Operator Manual</title>
  <style>
    @page {
      size: letter;
      margin: 0.65in;
    }

    * {
      box-sizing: border-box;
    }

    body {
      color: #18191f;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10.5pt;
      line-height: 1.45;
      margin: 0;
    }

    h1,
    h2,
    h3,
    h4 {
      color: #111827;
      line-height: 1.18;
      margin: 0.28in 0 0.08in;
      page-break-after: avoid;
    }

    h1 {
      border-bottom: 2px solid #111827;
      font-size: 24pt;
      margin-top: 0;
      padding-bottom: 0.12in;
    }

    h2 {
      border-bottom: 1px solid #d8dde8;
      font-size: 15pt;
      padding-bottom: 0.04in;
    }

    h3 {
      font-size: 12pt;
    }

    p {
      margin: 0 0 0.08in;
    }

    ul,
    ol {
      margin: 0 0 0.1in 0.22in;
      padding-left: 0.18in;
    }

    li {
      margin: 0.025in 0;
    }

    table {
      border-collapse: collapse;
      margin: 0.08in 0 0.16in;
      page-break-inside: avoid;
      width: 100%;
    }

    th,
    td {
      border: 1px solid #cdd5e1;
      padding: 0.055in 0.07in;
      text-align: left;
      vertical-align: top;
    }

    th {
      background: #eef2f7;
      font-weight: 700;
    }

    code {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 3px;
      font-family: Consolas, "Courier New", monospace;
      font-size: 9pt;
      padding: 0.01in 0.035in;
    }

    pre {
      background: #f8fafc;
      border: 1px solid #dce3ee;
      border-radius: 4px;
      margin: 0.08in 0 0.15in;
      overflow-wrap: anywhere;
      padding: 0.09in;
      white-space: pre-wrap;
    }

    pre code {
      background: transparent;
      border: 0;
      padding: 0;
    }

    a {
      color: #1d4ed8;
      text-decoration: none;
    }

    .print-meta {
      color: #5b6472;
      font-size: 8.5pt;
      margin-bottom: 0.18in;
    }
  </style>
</head>
<body>
  <div class="print-meta">Generated ${generatedAt} from docs/TCOS_OPERATOR_MANUAL.md</div>
  ${body}
</body>
</html>
`;

fs.writeFileSync(htmlPath, html);
console.log(`Manual HTML written: ${htmlPath}`);

if (!browserPath) {
  console.warn("No supported browser was found. PDF was not generated.");
  process.exit(0);
}

const fileUrl = `file:///${htmlPath.replaceAll("\\", "/")}`;
const result = spawnSync(
  browserPath,
  ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, fileUrl],
  { stdio: "inherit" },
);

if (result.status !== 0) {
  console.error(`PDF generation failed with exit code ${result.status}.`);
  process.exit(result.status ?? 1);
}

console.log(`Manual PDF written: ${pdfPath}`);
