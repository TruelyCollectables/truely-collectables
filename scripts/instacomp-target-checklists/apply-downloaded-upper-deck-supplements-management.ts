import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { importChecklistArtifact } from "../../src/lib/checklist-registry/server";
import type { ChecklistImportPlan, ChecklistSourceArtifact } from "../../src/lib/checklist-registry/source-adapter";
import { persistPlanManagement, preflightReleaseManagement } from "./management-staged-registry-writer.mjs";

const ROOT = resolve(process.env.DOWNLOADED_CHECKLIST_CORPUS_ROOT || "");
const OUTPUT = resolve(process.env.UPPER_DECK_SUPPLEMENT_RECEIPT || `${ROOT}/upper-deck-supplement-production-receipt.json`);
const DELAY_MS = Math.max(0, Number(process.env.UPPER_DECK_SUPPLEMENT_DELAY_MS || 3000));
const ATTEMPTS = Math.max(1, Number(process.env.UPPER_DECK_SUPPLEMENT_ATTEMPTS || 6));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const transient = (message: unknown) => /timeout|timed out|too many connections|connection terminated|connection reset|connection refused|could not query the database|web server is down|ssl handshake|\b50[0234]\b|\b52[125]\b|\b544\b|fetch failed|network|aborted|temporar|lock timeout/i.test(String(message || ""));

type Target = {
  key: string;
  title: string;
  sourceUrl: string;
  path: string;
};

function walk(dir: string, output: string[] = []) {
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path, output);
    else output.push(path);
  }
  return output;
}

function canonicalizePlan(plan: ChecklistImportPlan): ChecklistImportPlan {
  const norm = (value: unknown) => String(value ?? "").trim().toLowerCase().replaceAll("&", " and ").replace(/[^\p{L}\p{N}/]+/gu, " ") || null;
  const by = new Map<string, any>();
  const alias = new Map<string, string>();
  const configs = new Map<string, Set<string>>();
  const parallels: any[] = [];
  for (const p of plan.parallels || []) {
    const key = JSON.stringify([String(p.setSourceKey || ""), norm(p.name), Number(p.serialRun || 0)]);
    if (!configs.has(key)) configs.set(key, new Set());
    configs.get(key)!.add(String(p.configurationExclusivity || ""));
    if (!by.has(key)) {
      const kept = { ...p };
      by.set(key, kept);
      alias.set(String(p.sourceKey), String(p.sourceKey));
      parallels.push(kept);
    } else {
      alias.set(String(p.sourceKey), String(by.get(key).sourceKey));
    }
  }
  for (const p of parallels) {
    const key = JSON.stringify([String(p.setSourceKey || ""), norm(p.name), Number(p.serialRun || 0)]);
    if ((configs.get(key)?.size || 0) > 1) p.configurationExclusivity = null;
  }
  const identities: any[] = [];
  const seen = new Set<string>();
  for (const identity of plan.identities || []) {
    const mapped = {
      ...identity,
      parallelSourceKey: identity.parallelSourceKey ? (alias.get(String(identity.parallelSourceKey)) || identity.parallelSourceKey) : null,
    };
    const fingerprintKey = `${mapped.fingerprint?.schema || ""}|${mapped.fingerprint?.fingerprintSha256 || ""}`;
    if (seen.has(fingerprintKey)) continue;
    seen.add(fingerprintKey);
    identities.push(mapped);
  }
  return {
    ...plan,
    parallels,
    identities,
    validation: {
      ...plan.validation,
      counts: {
        ...plan.validation.counts,
        parallels: parallels.length,
        identities: identities.length,
      },
    },
  };
}

async function retry<T>(label: string, fn: () => Promise<T>) {
  let last: unknown = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      console.warn(`${label} attempt ${attempt}/${ATTEMPTS}: ${error instanceof Error ? error.message : String(error)}`);
      if (attempt === ATTEMPTS || !transient(error)) break;
      await sleep(Math.min(60_000, 5_000 * attempt));
    }
  }
  throw last;
}

function targetsFromReceipts(): Target[] {
  const receipts = walk(ROOT).filter((path) => /batch-\d+-receipt\.json$/i.test(path));
  const targets = new Map<string, Target>();
  for (const receiptPath of receipts) {
    let receipt: any;
    try { receipt = JSON.parse(readFileSync(receiptPath, "utf8")); } catch { continue; }
    for (const row of Array.isArray(receipt?.results) ? receipt.results : []) {
      const key = String(row?.key || "");
      const sourceUrl = String(row?.finalUrl || row?.url || "");
      const relative = String(row?.file || "");
      if (row?.status !== "downloaded") continue;
      if (!key.startsWith("hockey|") || !key.includes("|upper-deck|")) continue;
      if (!/upperdeck\.com/i.test(sourceUrl)) continue;
      const path = resolve(dirname(receiptPath), relative);
      if (!relative || !existsSync(path) || !/\.html$/i.test(path)) continue;
      targets.set(key, { key, title: String(row?.title || key), sourceUrl, path });
    }
  }
  return [...targets.values()].sort((a, b) => a.key.localeCompare(b.key));
}

async function main() {
  if (!ROOT || !existsSync(ROOT)) throw new Error(`Downloaded checklist corpus is missing: ${ROOT}`);
  const targets = targetsFromReceipts();
  if (targets.length < 50) throw new Error(`Expected at least 50 downloaded Upper Deck HTML supplements, found ${targets.length}.`);

  const receipt: any = {
    schema: "tcos.downloadedUpperDeckSupplementProduction.v1",
    sourceOnly: true,
    targetCount: targets.length,
    results: [],
  };
  const save = () => {
    receipt.updatedAt = new Date().toISOString();
    receipt.alreadyLiveCount = receipt.results.filter((r: any) => r.status === "already_live").length;
    receipt.persistedCount = receipt.results.filter((r: any) => r.status === "persisted").length;
    receipt.liveCount = receipt.alreadyLiveCount + receipt.persistedCount;
    receipt.validationFailedCount = receipt.results.filter((r: any) => r.status === "validation_failed").length;
    receipt.failedCount = receipt.results.filter((r: any) => r.status === "failed" || r.status === "postflight_failed").length;
    receipt.unresolvedCount = targets.length - receipt.liveCount;
    writeFileSync(OUTPUT, `${JSON.stringify(receipt, null, 2)}\n`);
  };

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    let row: any = { index: index + 1, exactSetKey: target.key, title: target.title, sourceUrl: target.sourceUrl };
    try {
      const content = readFileSync(target.path, "utf8");
      if (content.length < 1000) throw new Error(`Downloaded HTML is too small (${content.length} bytes).`);
      const artifact: ChecklistSourceArtifact = {
        sourceUrl: target.sourceUrl,
        originalFilename: basename(target.path),
        mimeType: "text/html",
        content,
        retrievedAt: new Date().toISOString(),
        authority: "official_manufacturer",
        redistributionAllowed: false,
      };
      const parsed = await importChecklistArtifact({ artifact, validateOnly: true });
      const plan = canonicalizePlan(parsed.plan);
      row.adapter = parsed.adapter;
      row.release = plan.release;
      row.counts = plan.validation.counts;
      const errors = plan.validation.issues.filter((issue) => issue.severity === "error");
      const sport = String(plan.release.sport || "").toLowerCase();
      if (sport !== "hockey" || errors.length || plan.validation.status !== "passed") {
        row.status = "validation_failed";
        row.errors = errors.slice(0, 50);
      } else {
        const slug = String(plan.release.releaseSlug || "");
        if (!slug) throw new Error("Validated plan is missing releaseSlug.");
        const before = await retry(`preflight ${slug}`, () => preflightReleaseManagement(slug));
        row.preflight = before;
        if ((before as any)?.complete) {
          row.status = "already_live";
        } else {
          row.transaction = await retry(`persist ${slug}`, () => persistPlanManagement(plan, Buffer.from(content, "utf8")));
          const after = await retry(`postflight ${slug}`, () => preflightReleaseManagement(slug));
          row.postflight = after;
          if (!(after as any)?.complete) {
            row.status = "postflight_failed";
            row.error = `Postflight did not find a complete active version for ${slug}`;
          } else {
            row.status = "persisted";
          }
        }
      }
    } catch (error) {
      row.status = "failed";
      row.error = error instanceof Error ? error.message : String(error);
    }
    receipt.results.push(row);
    save();
    console.log(`[${index + 1}/${targets.length}] ${row.status} ${target.key}`);
    if (index + 1 < targets.length && DELAY_MS) await sleep(DELAY_MS);
  }

  save();
  console.log(JSON.stringify({
    targetCount: receipt.targetCount,
    liveCount: receipt.liveCount,
    alreadyLiveCount: receipt.alreadyLiveCount,
    persistedCount: receipt.persistedCount,
    validationFailedCount: receipt.validationFailedCount,
    failedCount: receipt.failedCount,
    unresolvedCount: receipt.unresolvedCount,
  }, null, 2));
  if (receipt.failedCount) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
