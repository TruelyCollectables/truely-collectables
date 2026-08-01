"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type ManifestItem = {
  client_id: string;
  title?: string | null;
  front_image: string;
  back_image?: string | null;
  player?: string | null;
  year?: string | number | null;
  manufacturer?: string | null;
  brand?: string | null;
  set_name?: string | null;
  subset?: string | null;
  card_number?: string | number | null;
  parallel?: string | null;
  serial_number?: string | null;
  title_print_run?: string | null;
  team?: string | null;
  sport?: string | null;
  rookie?: boolean | null;
  is_auto?: boolean | null;
  is_relic?: boolean | null;
  purchase_id?: string | null;
  cost_basis?: number | null;
  purchase_match_status?: string | null;
  identification_confidence?: string | null;
  notes?: string | null;
};

type PendingImportManifest = {
  schema?: string;
  batch_id: string;
  total_cards?: number;
  items: ManifestItem[];
};

type PreparedItem = {
  item: ManifestItem;
  front: File | null;
  back: File | null;
};

type ImportProgress = {
  processed: number;
  created: number;
  existing: number;
  failed: number;
  total: number;
};

type DirectoryFile = File & { webkitRelativePath?: string };

function normalizePath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

function fileName(value: string) {
  return normalizePath(value).split("/").at(-1) || "";
}

function indexFiles(files: File[]) {
  const byPath = new Map<string, File>();
  const byName = new Map<string, File | null>();

  for (const file of files as DirectoryFile[]) {
    const relative = normalizePath(file.webkitRelativePath || file.name);
    byPath.set(relative, file);
    byPath.set(normalizePath(file.name), file);

    const imagesMarker = relative.lastIndexOf("/images/");
    if (imagesMarker >= 0) {
      byPath.set(relative.slice(imagesMarker + 1), file);
    }

    const name = fileName(relative);
    if (!byName.has(name)) byName.set(name, file);
    else if (byName.get(name) !== file) byName.set(name, null);
  }

  return { byPath, byName };
}

function resolveImage(
  path: string | null | undefined,
  indexed: ReturnType<typeof indexFiles>,
) {
  if (!path) return null;
  const normalized = normalizePath(path);
  const exact = indexed.byPath.get(normalized);
  if (exact) return exact;

  const uniqueName = indexed.byName.get(fileName(normalized));
  return uniqueName || null;
}

export default function PendingCardImportClient() {
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const [manifest, setManifest] = useState<PendingImportManifest | null>(null);
  const [prepared, setPrepared] = useState<PreparedItem[]>([]);
  const [packageName, setPackageName] = useState("");
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const [importedIds, setImportedIds] = useState<string[]>([]);
  const [progress, setProgress] = useState<ImportProgress>({
    processed: 0,
    created: 0,
    existing: 0,
    failed: 0,
    total: 0,
  });

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
  }, []);

  const missingFronts = useMemo(
    () => prepared.filter((entry) => !entry.front),
    [prepared],
  );
  const missingBacks = useMemo(
    () => prepared.filter((entry) => entry.item.back_image && !entry.back),
    [prepared],
  );
  const readyCount = prepared.filter((entry) => entry.front).length;

  async function loadPackage(fileList: FileList | null) {
    const files = Array.from(fileList || []);
    setManifest(null);
    setPrepared([]);
    setFailures([]);
    setImportedIds([]);
    setNotice("");
    setError("");
    setProgress({ processed: 0, created: 0, existing: 0, failed: 0, total: 0 });

    if (!files.length) {
      setError("Choose the extracted TC_Card_Staging_Package folder.");
      return;
    }

    const manifestFile =
      files.find((file) => file.name === "Truely_Collectables_Website_Pending_Import.json") ||
      files.find((file) => file.name.toLowerCase().endsWith(".json"));
    if (!manifestFile) {
      setError("The selected folder does not contain the pending-import JSON manifest.");
      return;
    }

    try {
      const parsed = JSON.parse(await manifestFile.text()) as PendingImportManifest;
      if (!parsed.batch_id?.trim() || !Array.isArray(parsed.items) || !parsed.items.length) {
        throw new Error("The manifest is missing batch_id or card items.");
      }

      const indexed = indexFiles(files);
      const nextPrepared = parsed.items.map((item) => ({
        item,
        front: resolveImage(item.front_image, indexed),
        back: resolveImage(item.back_image, indexed),
      }));
      const directoryFile = files[0] as DirectoryFile;
      const rootName = (directoryFile.webkitRelativePath || "").split("/")[0];

      setManifest(parsed);
      setPrepared(nextPrepared);
      setPackageName(rootName || manifestFile.name);
      setProgress({
        processed: 0,
        created: 0,
        existing: 0,
        failed: 0,
        total: parsed.items.length,
      });
      setNotice(
        `Loaded ${parsed.items.length} cards and ${files.filter((file) => file.type.startsWith("image/")).length} image files.`,
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not read the import manifest.");
    }
  }

  async function importPackage() {
    if (!manifest || !prepared.length) {
      setError("Choose the extracted staging package first.");
      return;
    }
    if (missingFronts.length) {
      setError(`Cannot start: ${missingFronts.length} card front image${missingFronts.length === 1 ? " is" : "s are"} missing.`);
      return;
    }

    setWorking(true);
    setError("");
    setFailures([]);
    setImportedIds([]);
    setNotice(`Importing ${prepared.length} pending cards...`);

    let cursor = 0;
    let processed = 0;
    let created = 0;
    let existing = 0;
    let failed = 0;
    const nextFailures: string[] = [];
    const nextIds: string[] = [];

    async function worker() {
      while (cursor < prepared.length) {
        const index = cursor;
        cursor += 1;
        const entry = prepared[index];

        try {
          const formData = new FormData();
          formData.append(
            "item",
            JSON.stringify({ ...entry.item, batch_id: activeManifest.batch_id }),
          );
          formData.append("batchId", activeManifest.batch_id);
          formData.append("frontImage", entry.front!);
          if (entry.back) formData.append("backImage", entry.back);

          const response = await fetch("/api/admin/pending-card-import", {
            method: "POST",
            body: formData,
            credentials: "same-origin",
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.success) {
            throw new Error(data.error || "Import failed.");
          }

          if (data.alreadyExisted) existing += 1;
          else created += 1;
          if (data.inventoryItemId) nextIds.push(String(data.inventoryItemId));
        } catch (nextError) {
          failed += 1;
          const message = nextError instanceof Error ? nextError.message : "Import failed.";
          nextFailures.push(`${entry.item.client_id}: ${message}`);
        } finally {
          processed += 1;
          setProgress({ processed, created, existing, failed, total: prepared.length });
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(3, prepared.length) }, () => worker()),
    );

    setWorking(false);
    setFailures(nextFailures);
    setImportedIds(nextIds);
    setNotice(
      `Finished ${processed}/${prepared.length}: ${created} created, ${existing} already present, ${failed} failed.`,
    );
    if (nextFailures.length) {
      setError(nextFailures.slice(0, 8).join(" | "));
    }
  }

  const percentage = progress.total
    ? Math.round((progress.processed / progress.total) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border-2 border-neutral-950 bg-white p-5 shadow-[7px_7px_0_#facc15] sm:p-6">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">
          Step 1 · Load package
        </p>
        <h2 className="mt-2 text-3xl font-black">Choose the extracted staging folder</h2>
        <p className="mt-2 max-w-4xl font-semibold leading-7 text-neutral-600">
          Unzip TC_Card_Staging_Package.zip, then choose the extracted folder. The importer finds the JSON manifest and all front/back images automatically.
        </p>
        <input
          ref={folderInputRef}
          type="file"
          multiple
          disabled={working}
          onChange={(event) => void loadPackage(event.target.files)}
          className="mt-5 block w-full rounded-xl border-2 border-dashed border-neutral-400 bg-neutral-50 p-4 font-bold"
        />

        {notice ? (
          <p className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 font-bold text-emerald-900">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 font-bold text-red-900">
            {error}
          </p>
        ) : null}
      </section>

      {manifest ? (
        <section className="rounded-3xl border-2 border-neutral-950 bg-white p-5 shadow-[7px_7px_0_#111318] sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">
            Step 2 · Verify and import
          </p>
          <h2 className="mt-2 text-3xl font-black">{packageName || manifest.batch_id}</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Metric label="Manifest cards" value={String(prepared.length)} />
            <Metric label="Ready" value={String(readyCount)} good={!missingFronts.length} />
            <Metric label="Missing fronts" value={String(missingFronts.length)} bad={Boolean(missingFronts.length)} />
            <Metric label="Missing backs" value={String(missingBacks.length)} bad={Boolean(missingBacks.length)} />
            <Metric label="Starting price" value="$0.00" />
          </div>

          <div className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 font-bold text-amber-950">
            Every card is created as an unpublished draft with quantity 1 and status Pending InstaComp 2.0. Purchase cost stays private and is excluded from InstaComp and market comps.
          </div>

          <button
            type="button"
            onClick={() => void importPackage()}
            disabled={working || Boolean(missingFronts.length)}
            className="mt-5 min-h-14 w-full rounded-xl bg-neutral-950 px-5 py-3 text-lg font-black text-white disabled:bg-neutral-400"
          >
            {working ? `Importing ${progress.processed}/${progress.total}…` : `Import all ${readyCount} pending cards`}
          </button>

          {working || progress.processed ? (
            <div className="mt-5">
              <div className="h-4 overflow-hidden rounded-full bg-neutral-200">
                <div
                  className="h-full bg-blue-700 transition-all"
                  style={{ width: `${percentage}%` }}
                />
              </div>
              <p className="mt-2 font-black">
                {percentage}% · {progress.created} created · {progress.existing} already present · {progress.failed} failed
              </p>
            </div>
          ) : null}

          {failures.length ? (
            <details className="mt-5 rounded-2xl border border-red-300 bg-red-50 p-4">
              <summary className="cursor-pointer font-black text-red-900">
                Show {failures.length} failed card{failures.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-3 space-y-2 text-sm font-bold text-red-900">
                {failures.map((failure) => <li key={failure}>{failure}</li>)}
              </ul>
            </details>
          ) : null}

          {!working && importedIds.length ? (
            <div className="mt-5 rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-5">
              <h3 className="text-2xl font-black text-emerald-950">Pending listings are in the website database</h3>
              <p className="mt-2 font-bold text-emerald-900">
                Open the listing queue to review the front/back images and run the next InstaComp 2.0 step before publishing.
              </p>
              <Link
                href="/list#listing-queue"
                className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-emerald-800 px-5 py-3 font-black text-white"
              >
                View pending listing queue
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  good = false,
  bad = false,
}: {
  label: string;
  value: string;
  good?: boolean;
  bad?: boolean;
}) {
  const tone = bad
    ? "border-red-300 bg-red-50 text-red-950"
    : good
      ? "border-emerald-300 bg-emerald-50 text-emerald-950"
      : "border-neutral-200 bg-neutral-50 text-neutral-950";

  return (
    <div className={`rounded-2xl border p-4 ${tone}`}>
      <p className="text-xs font-black uppercase tracking-[0.14em] opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}
