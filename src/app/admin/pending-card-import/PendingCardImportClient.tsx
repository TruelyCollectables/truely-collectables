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

type CardImportStatus = "importing" | "created" | "existing" | "failed";

type CardImportResult = {
  clientId: string;
  title: string;
  status: CardImportStatus;
  message?: string;
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

function cardLabel(item: ManifestItem) {
  return String(item.title || item.client_id || "Card").trim();
}

function statusTone(status: CardImportStatus) {
  if (status === "created") return "border-emerald-200 bg-emerald-50 text-emerald-950";
  if (status === "existing") return "border-sky-200 bg-sky-50 text-sky-950";
  if (status === "failed") return "border-red-200 bg-red-50 text-red-950";
  return "border-amber-200 bg-amber-50 text-amber-950";
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
  const [activeCards, setActiveCards] = useState<string[]>([]);
  const [cardResults, setCardResults] = useState<Record<string, CardImportResult>>({});
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

  useEffect(() => {
    if (!working) return;

    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [working]);

  const missingFronts = useMemo(
    () => prepared.filter((entry) => !entry.front),
    [prepared],
  );
  const missingBacks = useMemo(
    () => prepared.filter((entry) => entry.item.back_image && !entry.back),
    [prepared],
  );
  const readyCount = prepared.filter((entry) => entry.front).length;
  const percentage = progress.total
    ? Math.round((progress.processed / progress.total) * 100)
    : 0;
  const remaining = Math.max(progress.total - progress.processed, 0);
  const complete = progress.total > 0 && progress.processed === progress.total && !working;
  const recentResults = Object.values(cardResults).slice(-8).reverse();
  const progressStatus = working
    ? "Import running"
    : complete && progress.failed > 0
      ? "Finished with errors"
      : complete
        ? "Import complete"
        : manifest
          ? "Ready to import"
          : "Waiting for package";
  const progressPanelTone = working
    ? "border-blue-300 bg-blue-50"
    : complete && progress.failed > 0
      ? "border-red-300 bg-red-50"
      : complete
        ? "border-emerald-400 bg-emerald-50"
        : "border-neutral-300 bg-white";

  function resetImportState(total = 0) {
    setFailures([]);
    setImportedIds([]);
    setActiveCards([]);
    setCardResults({});
    setProgress({ processed: 0, created: 0, existing: 0, failed: 0, total });
  }

  async function loadPackage(fileList: FileList | null) {
    const files = Array.from(fileList || []);
    setManifest(null);
    setPrepared([]);
    setPackageName("");
    setNotice("");
    setError("");
    resetImportState();

    if (!files.length) {
      setError("Choose an extracted Truely Collectables card package folder.");
      return;
    }

    const manifestFile =
      files.find((file) => file.name === "Truely_Collectables_Website_Pending_Import.json") ||
      files.find((file) => file.name.toLowerCase().endsWith(".json"));
    if (!manifestFile) {
      setError("The selected folder does not contain a pending-import JSON manifest.");
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
      setPackageName(rootName || parsed.batch_id);
      resetImportState(parsed.items.length);
      setNotice(
        `Loaded ${parsed.items.length} card${parsed.items.length === 1 ? "" : "s"} and ${files.filter((file) => file.type.startsWith("image/")).length} image files.`,
      );
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not read the import manifest.");
    }
  }

  async function importPackage() {
    if (!manifest || !prepared.length) {
      setError("Choose an extracted card package first.");
      return;
    }
    if (missingFronts.length) {
      setError(`Cannot start: ${missingFronts.length} card front image${missingFronts.length === 1 ? " is" : "s are"} missing.`);
      return;
    }

    const activeManifest = manifest;

    setWorking(true);
    setError("");
    setFailures([]);
    setImportedIds([]);
    setActiveCards([]);
    setCardResults({});
    setProgress({
      processed: 0,
      created: 0,
      existing: 0,
      failed: 0,
      total: prepared.length,
    });
    setNotice(`Importing ${prepared.length} pending card${prepared.length === 1 ? "" : "s"}...`);

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
        const title = cardLabel(entry.item);
        const clientId = entry.item.client_id;

        setActiveCards((current) =>
          [...current.filter((value) => value !== title), title].slice(-3),
        );
        setCardResults((current) => ({
          ...current,
          [clientId]: { clientId, title, status: "importing" },
        }));

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

          if (data.alreadyExisted) {
            existing += 1;
            setCardResults((current) => ({
              ...current,
              [clientId]: { clientId, title, status: "existing" },
            }));
          } else {
            created += 1;
            setCardResults((current) => ({
              ...current,
              [clientId]: { clientId, title, status: "created" },
            }));
          }

          if (data.inventoryItemId) nextIds.push(String(data.inventoryItemId));
        } catch (nextError) {
          failed += 1;
          const message = nextError instanceof Error ? nextError.message : "Import failed.";
          nextFailures.push(`${clientId}: ${message}`);
          setCardResults((current) => ({
            ...current,
            [clientId]: { clientId, title, status: "failed", message },
          }));
        } finally {
          processed += 1;
          setActiveCards((current) => current.filter((value) => value !== title));
          setProgress({ processed, created, existing, failed, total: prepared.length });
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(3, prepared.length) }, () => worker()),
    );

    setWorking(false);
    setActiveCards([]);
    setFailures(nextFailures);
    setImportedIds(nextIds);
    setNotice(
      `Finished ${processed}/${prepared.length}: ${created} created, ${existing} already present, ${failed} failed.`,
    );
    if (nextFailures.length) {
      setError(nextFailures.slice(0, 8).join(" | "));
    }

    if (nextIds.length) {
      window.dispatchEvent(
        new CustomEvent("tcos:simple-list-drafts-created", {
          detail: { inventoryItemIds: nextIds },
        }),
      );
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border-2 border-neutral-950 bg-white p-5 shadow-[7px_7px_0_#facc15] sm:p-6">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">
          Step 1 · Load a card package
        </p>
        <h2 className="mt-2 text-3xl font-black">Choose the extracted package folder</h2>
        <p className="mt-2 max-w-4xl font-semibold leading-7 text-neutral-600">
          This is the permanent intake tool. It accepts any future Truely Collectables card package containing a JSON manifest and matching front/back image files—not just the current batch.
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
        <>
          <section
            role="status"
            aria-live="polite"
            className={`sticky top-4 z-30 rounded-3xl border-2 p-5 shadow-2xl backdrop-blur sm:p-6 ${progressPanelTone}`}
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">
                  Live import status
                </p>
                <h2 className="mt-1 text-3xl font-black">{progressStatus}</h2>
                <p className="mt-1 break-words font-bold text-neutral-700">
                  {packageName || manifest.batch_id}
                </p>
              </div>
              <div className="text-left lg:text-right">
                <p className="text-5xl font-black tabular-nums">{percentage}%</p>
                <p className="mt-1 font-black tabular-nums text-neutral-700">
                  {progress.processed} of {progress.total} finished
                </p>
              </div>
            </div>

            <div
              className="mt-5 h-6 overflow-hidden rounded-full border border-neutral-300 bg-white"
              role="progressbar"
              aria-label="Card import progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percentage}
            >
              <div
                className={`h-full transition-[width] duration-300 ${complete && progress.failed === 0 ? "bg-emerald-600" : progress.failed > 0 ? "bg-red-600" : "bg-blue-700"}`}
                style={{ width: `${percentage}%` }}
              />
            </div>

            <div className="mt-5 grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
              <ProgressMetric label="Created" value={progress.created} />
              <ProgressMetric label="Already there" value={progress.existing} />
              <ProgressMetric label="Failed" value={progress.failed} bad={progress.failed > 0} />
              <ProgressMetric label="Remaining" value={remaining} />
              <ProgressMetric label="Missing fronts" value={missingFronts.length} bad={missingFronts.length > 0} />
              <ProgressMetric label="Missing backs" value={missingBacks.length} bad={missingBacks.length > 0} />
            </div>

            {activeCards.length ? (
              <div className="mt-5 rounded-2xl border border-blue-200 bg-white p-4">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-blue-700">
                  Processing now
                </p>
                <ul className="mt-2 space-y-1 text-sm font-bold text-neutral-800">
                  {activeCards.map((title) => <li key={title}>• {title}</li>)}
                </ul>
              </div>
            ) : null}

            {complete ? (
              <div className={`mt-5 rounded-2xl border-2 p-4 font-black ${progress.failed ? "border-red-300 bg-red-100 text-red-950" : "border-emerald-400 bg-emerald-100 text-emerald-950"}`}>
                {progress.failed
                  ? `Import finished with ${progress.failed} card${progress.failed === 1 ? "" : "s"} needing review.`
                  : `Import finished. All ${progress.total} card${progress.total === 1 ? "" : "s"} were processed.`}
              </div>
            ) : null}
          </section>

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
              {working
                ? `Importing ${progress.processed}/${progress.total} · ${percentage}%`
                : complete
                  ? `Re-run this batch safely`
                  : `Import all ${readyCount} pending cards`}
            </button>

            {recentResults.length ? (
              <div className="mt-5">
                <h3 className="text-lg font-black">Latest card results</h3>
                <div className="mt-3 grid gap-2">
                  {recentResults.map((result) => (
                    <div
                      key={result.clientId}
                      className={`rounded-xl border px-3 py-2 text-sm font-bold ${statusTone(result.status)}`}
                    >
                      <span className="uppercase">{result.status.replaceAll("_", " ")}</span>
                      <span className="mx-2">·</span>
                      <span>{result.title}</span>
                      {result.message ? <span className="block mt-1">{result.message}</span> : null}
                    </div>
                  ))}
                </div>
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
                  The listing queue below refreshes automatically. Review the images and identity, run InstaComp 2.0, set pricing, then publish only the cards you select.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    href="#listing-queue"
                    className="inline-flex min-h-12 items-center rounded-xl bg-emerald-800 px-5 py-3 font-black text-white"
                  >
                    View listing queue
                  </a>
                  <Link
                    href="/admin/instacomp/v2"
                    className="inline-flex min-h-12 items-center rounded-xl border-2 border-emerald-800 bg-white px-5 py-3 font-black text-emerald-950"
                  >
                    Open InstaComp 2.0
                  </Link>
                </div>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}

function ProgressMetric({
  label,
  value,
  bad = false,
}: {
  label: string;
  value: number;
  bad?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-3 ${bad ? "border-red-300 bg-red-100 text-red-950" : "border-neutral-200 bg-white text-neutral-950"}`}>
      <p className="text-xs font-black uppercase tracking-[0.12em] opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums">{value}</p>
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
