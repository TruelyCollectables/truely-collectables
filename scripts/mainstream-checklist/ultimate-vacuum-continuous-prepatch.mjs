#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const path = 'scripts/mainstream-checklist/ultimate-vacuum-discovery.mjs';
let source = readFileSync(path, 'utf8');

const policyAnchor = "const policy = JSON.parse(readFileSync(policyPath, 'utf8'));\n";
const seenBlock = `const seenPath = resolve(process.env.VACUUM_SEEN_URLS || 'ops/checklists/ultimate-vacuum-seen-urls-20260815.json');\nlet seenUrls = new Set();\ntry {\n  const seenDoc = JSON.parse(readFileSync(seenPath, 'utf8'));\n  seenUrls = new Set((seenDoc.urls || []).map(value => String(value)));\n} catch {}\n`;
if (!source.includes('const seenPath = resolve(process.env.VACUUM_SEEN_URLS')) {
  if (!source.includes(policyAnchor)) throw new Error('continuous vacuum policy anchor not found');
  source = source.replace(policyAnchor, `${policyAnchor}${seenBlock}`);
}

const queueAnchor = "    const queue = source.newestFirst === false ? [...discoveredUrls] : newestFirst(discoveredUrls);\n";
const revisitBlock = `    const alwaysRevisit = new Set([\n      ...(source.seedPaths || []).map(p => new URL(p, schemeHost).href),\n      ...(source.seedPathPrefixes || []).map(p => new URL(p, schemeHost).href),\n    ]);\n    if (source.id === 'cardboard-connection') {\n      for (let i = 1; i <= 40; i++) alwaysRevisit.add(\`${'${schemeHost}'}/page/${'${i}'}\`);\n    }\n    if (source.id === 'blowout-forums') alwaysRevisit.add(\`${'${schemeHost}'}/index.php\`);\n`;
if (!source.includes('const alwaysRevisit = new Set([')) {
  if (!source.includes(queueAnchor)) throw new Error('continuous vacuum queue anchor not found');
  source = source.replace(queueAnchor, `${queueAnchor}${revisitBlock}`);
}

const workerAnchor = "        queued.delete(url);\n        if (seen.has(url)) continue;\n";
const workerReplacement = "        queued.delete(url);\n        if (seenUrls.has(url) && !alwaysRevisit.has(url)) {\n          stats.skippedSeen = Number(stats.skippedSeen || 0) + 1;\n          continue;\n        }\n        if (seen.has(url)) continue;\n";
if (!source.includes('stats.skippedSeen = Number(stats.skippedSeen || 0) + 1;')) {
  if (!source.includes(workerAnchor)) throw new Error('continuous vacuum worker anchor not found');
  source = source.replace(workerAnchor, workerReplacement);
}

writeFileSync(path, source, 'utf8');
console.log(JSON.stringify({ patched: true, seenUrls: seenUrls.size }));
