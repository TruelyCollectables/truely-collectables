"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

type PairMode = "single" | "front_back";
type RowStatus = "ready" | "scanning" | "scanned" | "drafting" | "drafted" | "error";

type CardRow = {
  id: string;
  frontFile: File;
  backFile: File | null;
  frontPreview: string;
  backPreview: string | null;
  selected: boolean;
  status: RowStatus;
  error: string | null;
  scan: Record<string, any> | null;
  title: string;
  player: string;
  year: string;
  brand: string;
  setName: string;
  cardNumber: string;
  parallel: string;
  serialNumber: string;
  team: string;
  sport: string;
  condition: string;
  grader: string;
  grade: string;
  certificationNumber: string;
  isRookie: boolean;
  isAuto: boolean;
  isRelic: boolean;
  price: string;
  quantity: string;
  inventoryItemId: string | null;
};

function cleanBaseName(value: string) {
  return value.replace(/\.[^.]+$/, "").replace(/(?:[-_ ]?(?:front|back|obverse|reverse))$/i, "");
}

function buildTitle(row: CardRow, ai: Record<string, any>) {
  const parts = [
    ai.year,
    ai.brand,
    ai.setName,
    ai.player,
    ai.cardNumber ? `#${String(ai.cardNumber).replace(/^#/, "")}` : null,
    ai.parallel,
    ai.serialNumber ? `/${String(ai.serialNumber).replace(/^\//, "")}` : null,
    ai.gradingCompany,
    ai.gradeValue,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return parts.join(" ") || cleanBaseName(row.frontFile.name);
}

function pairsFromFiles(files: File[], mode: PairMode) {
  if (mode === "single") {
    return files.map((file) => ({ front: file, back: null as File | null }));
  }

  const pairs: Array<{ front: File; back: File | null }> = [];
  for (let index = 0; index < files.length; index += 2) {
    pairs.push({ front: files[index], back: files[index + 1] || null });
  }
  return pairs;
}

function newRow(front: File, back: File | null): CardRow {
  return {
    id: crypto.randomUUID(),
    frontFile: front,
    backFile: back,
    frontPreview: URL.createObjectURL(front),
    backPreview: back ? URL.createObjectURL(back) : null,
    selected: true,
    status: "ready",
    error: null,
    scan: null,
    title: cleanBaseName(front.name),
    player: "",
    year: "",
    brand: "",
    setName: "",
    cardNumber: "",
    parallel: "",
    serialNumber: "",
    team: "",
    sport: "",
    condition: "",
    grader: "",
    grade: "",
    certificationNumber: "",
    isRookie: false,
    isAuto: false,
    isRelic: false,
    price: "",
    quantity: "1",
    inventoryItemId: null,
  };
}

export default function SimpleListIntake() {
  const [pairMode, setPairMode] = useState<PairMode>("single");
  const [rows, setRows] = useState<CardRow[]>([]);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const rowsRef = useRef<CardRow[]>([]);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    return () => {
      for (const row of rowsRef.current) {
        URL.revokeObjectURL(row.frontPreview);
        if (row.backPreview) URL.revokeObjectURL(row.backPreview);
      }
    };
  }, []);

  const selectedRows = useMemo(() => rows.filter((row) => row.selected), [rows]);
  const selectedScannedRows = useMemo(
    () => selectedRows.filter((row) => row.status === "scanned" || row.status === "error"),
    [selectedRows],
  );

  function updateRow(id: string, update: Partial<CardRow> | ((row: CardRow) => CardRow)) {
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? typeof update === "function"
            ? update(row)
            : { ...row, ...update }
          : row,
      ),
    );
  }

  function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter((file) => file.type.startsWith("image/"));
    if (!files.length) {
      setError("Choose JPEG, PNG, or WebP card photos.");
      return;
    }
    const additions = pairsFromFiles(files, pairMode).map(({ front, back }) =>
      newRow(front, back),
    );
    setRows((current) => [...current, ...additions].slice(0, 100));
    setNotice(`Added ${additions.length} card${additions.length === 1 ? "" : "s"}.`);
    setError("");
  }

  function removeRow(row: CardRow) {
    URL.revokeObjectURL(row.frontPreview);
    if (row.backPreview) URL.revokeObjectURL(row.backPreview);
    setRows((current) => current.filter((item) => item.id !== row.id));
  }

  function selectAll(selected: boolean) {
    setRows((current) =>
      current.map((row) =>
        row.status === "drafted" ? row : { ...row, selected },
      ),
    );
  }

  async function scanOne(row: CardRow) {
    updateRow(row.id, { status: "scanning", error: null });
    const formData = new FormData();
    formData.append("frontImage", row.frontFile);
    if (row.backFile) formData.append("backImage", row.backFile);
    formData.append("aiCouncilTier", "adaptive");

    const response = await fetch("/api/instacomp/scan", {
      method: "POST",
      body: formData,
      credentials: "same-origin",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "InstaComp™ could not scan this card.");
    }

    updateRow(row.id, (current) => {
      const ai = data.ai || {};
      const suggested = Number(data.stats?.suggestedPrice || data.soldStats?.suggestedPrice || 0);
      return {
        ...current,
        status: "scanned",
        error: null,
        scan: data,
        title: buildTitle(current, ai),
        player: String(ai.player || ""),
        year: String(ai.year || ""),
        brand: String(ai.brand || ""),
        setName: String(ai.setName || ""),
        cardNumber: String(ai.cardNumber || ""),
        parallel: String(ai.parallel || ""),
        serialNumber: String(ai.serialNumber || ""),
        team: String(ai.team || ""),
        sport: String(ai.sport || ""),
        condition: String(ai.conditionGuess || ""),
        grader: String(ai.gradingCompany || ""),
        grade: String(ai.gradeValue || ""),
        certificationNumber: String(ai.certificationNumber || ""),
        isRookie: Boolean(ai.isRookie),
        isAuto: Boolean(ai.isAuto),
        isRelic: Boolean(ai.isRelic),
        price: current.price || (suggested > 0 ? suggested.toFixed(2) : ""),
      };
    });
  }

  async function runSelectedInstaComp() {
    const targets = selectedRows.filter((row) => row.status !== "drafted");
    if (!targets.length) {
      setError("Select at least one card to run through InstaComp™.");
      return;
    }

    setWorking(true);
    setError("");
    setNotice(`Running InstaComp™ on ${targets.length} selected card${targets.length === 1 ? "" : "s"}...`);
    let cursor = 0;
    let completed = 0;
    const failures: string[] = [];

    async function worker() {
      while (cursor < targets.length) {
        const row = targets[cursor];
        cursor += 1;
        try {
          await scanOne(row);
          completed += 1;
        } catch (nextError) {
          const message = nextError instanceof Error ? nextError.message : "Scan failed.";
          failures.push(`${row.frontFile.name}: ${message}`);
          updateRow(row.id, { status: "error", error: message });
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, () => worker()));
    setWorking(false);
    setNotice(`InstaComp™ completed ${completed}/${targets.length} selected card${targets.length === 1 ? "" : "s"}.`);
    if (failures.length) setError(failures.slice(0, 5).join(" | "));
  }

  function draftPayload(row: CardRow) {
    const ai = {
      player: row.player || null,
      year: row.year || null,
      brand: row.brand || null,
      setName: row.setName || null,
      cardNumber: row.cardNumber || null,
      parallel: row.parallel || null,
      serialNumber: row.serialNumber || null,
      team: row.team || null,
      sport: row.sport || null,
      conditionGuess: row.condition || null,
      gradingCompany: row.grader || null,
      gradeValue: row.grade || null,
      certificationNumber: row.certificationNumber || null,
      isRookie: row.isRookie,
      isAuto: row.isAuto,
      isRelic: row.isRelic,
      confidence: row.scan?.ai?.confidence ?? null,
      notes: row.scan?.ai?.notes ?? null,
    };
    return {
      clientId: row.id,
      scanId: row.scan?.scanId || null,
      title: row.title,
      price: Number(row.price),
      quantity: Number(row.quantity),
      searchQuery: row.scan?.searchQuery || null,
      ai,
      stats: row.scan?.stats || {},
      soldStats: row.scan?.soldStats || {},
      sourceCoverage: row.scan?.sourceCoverage || [],
    };
  }

  function rowReadyForDraft(row: CardRow) {
    return Boolean(
      row.scan &&
        row.title.trim() &&
        Number(row.price) > 0 &&
        Number.isInteger(Number(row.quantity)) &&
        Number(row.quantity) >= 1,
    );
  }

  async function createDraft(row: CardRow) {
    if (!rowReadyForDraft(row)) {
      throw new Error("Scan the card, then enter a title, price, and quantity of at least 1.");
    }
    updateRow(row.id, { status: "drafting", error: null });
    const formData = new FormData();
    formData.append("item", JSON.stringify(draftPayload(row)));
    formData.append("frontImage", row.frontFile);
    if (row.backFile) formData.append("backImage", row.backFile);
    const response = await fetch("/api/admin/simple-list-drafts", {
      method: "POST",
      body: formData,
      credentials: "same-origin",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      throw new Error(data.error || "Could not add this card to the listing queue.");
    }
    updateRow(row.id, {
      status: "drafted",
      selected: false,
      inventoryItemId: String(data.inventoryItemId || "") || null,
      error: null,
    });
    return String(data.inventoryItemId || "");
  }

  async function addSelectedToQueue() {
    const targets = selectedScannedRows.filter(rowReadyForDraft);
    if (!targets.length) {
      setError("Select scanned cards with a title, price, and quantity to add to the listing queue.");
      return;
    }

    setWorking(true);
    setError("");
    setNotice(`Adding ${targets.length} selected card${targets.length === 1 ? "" : "s"} to the listing queue...`);
    const createdIds: string[] = [];
    const failures: string[] = [];
    let cursor = 0;

    async function worker() {
      while (cursor < targets.length) {
        const row = targets[cursor];
        cursor += 1;
        try {
          const inventoryItemId = await createDraft(row);
          if (inventoryItemId) createdIds.push(inventoryItemId);
        } catch (nextError) {
          const message = nextError instanceof Error ? nextError.message : "Draft failed.";
          failures.push(`${row.title || row.frontFile.name}: ${message}`);
          updateRow(row.id, { status: "error", error: message });
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, () => worker()));
    setWorking(false);
    setNotice(`Added ${createdIds.length}/${targets.length} card${targets.length === 1 ? "" : "s"} to the listing queue below.`);
    if (failures.length) setError(failures.slice(0, 5).join(" | "));
    if (createdIds.length) {
      window.dispatchEvent(
        new CustomEvent("tcos:simple-list-drafts-created", {
          detail: { inventoryItemIds: createdIds },
        }),
      );
      window.setTimeout(() => document.getElementById("listing-queue")?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }

  return (
    <section className="rounded-3xl border-2 border-neutral-950 bg-white p-4 shadow-[7px_7px_0_#111318] sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-700">Step 1 · Photos and InstaComp™</p>
          <h2 className="mt-2 text-3xl font-black">Upload and price your cards</h2>
          <p className="mt-2 max-w-3xl font-semibold text-neutral-600">
            Upload photos, select any cards, run InstaComp™ in bulk, then edit every field before sending selected cards to the listing queue.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => selectAll(true)} disabled={working || !rows.length} className="rounded-xl border-2 border-neutral-950 px-4 py-2 font-black disabled:opacity-40">Select all</button>
          <button type="button" onClick={() => selectAll(false)} disabled={working || !rows.length} className="rounded-xl border-2 border-neutral-950 px-4 py-2 font-black disabled:opacity-40">Clear selection</button>
        </div>
      </div>

      <div
        onDrop={(event) => {
          event.preventDefault();
          if (!working) addFiles(event.dataTransfer.files);
        }}
        onDragOver={(event) => event.preventDefault()}
        className="mt-6 rounded-2xl border-2 border-dashed border-neutral-500 bg-neutral-50 p-6 text-center"
      >
        <p className="text-xl font-black">Drop card photos here</p>
        <p className="mt-1 text-sm font-semibold text-neutral-600">Or choose up to 100 images from your phone or computer.</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
          <label className="font-black">
            <span className="mr-2">Photo setup</span>
            <select value={pairMode} onChange={(event) => setPairMode(event.target.value as PairMode)} disabled={working} className="rounded-lg border-2 border-neutral-950 bg-white px-3 py-2">
              <option value="single">One photo per card</option>
              <option value="front_back">Front/back pairs in upload order</option>
            </select>
          </label>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={working || rows.length >= 100}
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.currentTarget.value = "";
            }}
            className="max-w-full font-bold"
          />
        </div>
      </div>

      {notice ? <p role="status" className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 font-bold text-emerald-900">{notice}</p> : null}
      {error ? <p role="alert" className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 font-bold text-red-900">{error}</p> : null}

      {rows.length ? (
        <>
          <div className="sticky top-20 z-20 mt-6 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-neutral-950 bg-yellow-300 p-3 shadow-lg">
            <strong>{selectedRows.length} selected</strong>
            <button type="button" onClick={() => void runSelectedInstaComp()} disabled={working || !selectedRows.length} className="rounded-xl bg-neutral-950 px-5 py-3 font-black text-white disabled:bg-neutral-500">
              {working ? "Working..." : `Run InstaComp™ on Selected (${selectedRows.length})`}
            </button>
            <button type="button" onClick={() => void addSelectedToQueue()} disabled={working || !selectedScannedRows.length} className="rounded-xl border-2 border-neutral-950 bg-white px-5 py-3 font-black disabled:opacity-40">
              Add Selected to Listing Queue ({selectedScannedRows.filter(rowReadyForDraft).length})
            </button>
          </div>

          <div className="mt-5 grid gap-4">
            {rows.map((row, index) => (
              <article key={row.id} className={`rounded-2xl border-2 p-4 ${row.selected ? "border-blue-700 bg-blue-50/40" : "border-neutral-300 bg-white"}`}>
                <div className="grid gap-4 lg:grid-cols-[180px_1fr]">
                  <div>
                    <label className="flex items-center gap-3 text-lg font-black">
                      <input type="checkbox" checked={row.selected} disabled={working || row.status === "drafted"} onChange={(event) => updateRow(row.id, { selected: event.target.checked })} className="h-6 w-6" />
                      Card {index + 1}
                    </label>
                    <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
                      <div className="relative aspect-[4/5] overflow-hidden rounded-xl border bg-neutral-100">
                        <Image src={row.frontPreview} alt={`Card ${index + 1} front`} fill unoptimized className="object-contain" />
                      </div>
                      {row.backPreview ? (
                        <div className="relative aspect-[4/5] overflow-hidden rounded-xl border bg-neutral-100">
                          <Image src={row.backPreview} alt={`Card ${index + 1} back`} fill unoptimized className="object-contain" />
                        </div>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs font-black uppercase text-neutral-500">{row.status.replaceAll("_", " ")}</p>
                    <button type="button" onClick={() => removeRow(row)} disabled={working || row.status === "drafting"} className="mt-2 text-sm font-black text-red-700 underline disabled:opacity-40">Remove card</button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Listing title" className="sm:col-span-2 lg:col-span-4">
                      <input value={row.title} onChange={(event) => updateRow(row.id, { title: event.target.value })} className="input" />
                    </Field>
                    <Field label="Player / subject"><input value={row.player} onChange={(event) => updateRow(row.id, { player: event.target.value })} className="input" /></Field>
                    <Field label="Year"><input value={row.year} onChange={(event) => updateRow(row.id, { year: event.target.value })} className="input" /></Field>
                    <Field label="Brand"><input value={row.brand} onChange={(event) => updateRow(row.id, { brand: event.target.value })} className="input" /></Field>
                    <Field label="Set"><input value={row.setName} onChange={(event) => updateRow(row.id, { setName: event.target.value })} className="input" /></Field>
                    <Field label="Card number"><input value={row.cardNumber} onChange={(event) => updateRow(row.id, { cardNumber: event.target.value })} className="input" /></Field>
                    <Field label="Parallel / variation"><input value={row.parallel} onChange={(event) => updateRow(row.id, { parallel: event.target.value })} className="input" /></Field>
                    <Field label="Serial number"><input value={row.serialNumber} onChange={(event) => updateRow(row.id, { serialNumber: event.target.value })} className="input" /></Field>
                    <Field label="Team"><input value={row.team} onChange={(event) => updateRow(row.id, { team: event.target.value })} className="input" /></Field>
                    <Field label="Sport"><input value={row.sport} onChange={(event) => updateRow(row.id, { sport: event.target.value })} className="input" /></Field>
                    <Field label="Condition"><input value={row.condition} onChange={(event) => updateRow(row.id, { condition: event.target.value })} className="input" /></Field>
                    <Field label="Grader"><input value={row.grader} onChange={(event) => updateRow(row.id, { grader: event.target.value })} className="input" /></Field>
                    <Field label="Grade"><input value={row.grade} onChange={(event) => updateRow(row.id, { grade: event.target.value })} className="input" /></Field>
                    <Field label="Certification #"><input value={row.certificationNumber} onChange={(event) => updateRow(row.id, { certificationNumber: event.target.value })} className="input" /></Field>
                    <Field label="Price"><input type="number" min="0.01" step="0.01" value={row.price} onChange={(event) => updateRow(row.id, { price: event.target.value })} className="input" /></Field>
                    <Field label="Quantity"><input type="number" min="1" step="1" value={row.quantity} onChange={(event) => updateRow(row.id, { quantity: event.target.value })} className="input" /></Field>
                    <div className="flex flex-wrap items-center gap-4 sm:col-span-2 lg:col-span-4">
                      <Check label="Rookie" checked={row.isRookie} onChange={(checked) => updateRow(row.id, { isRookie: checked })} />
                      <Check label="Autograph" checked={row.isAuto} onChange={(checked) => updateRow(row.id, { isAuto: checked })} />
                      <Check label="Relic / memorabilia" checked={row.isRelic} onChange={(checked) => updateRow(row.id, { isRelic: checked })} />
                    </div>
                    {row.scan ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-900 sm:col-span-2 lg:col-span-4">
                        InstaComp™ confidence: {Number(row.scan.ai?.confidence || 0)}% · Suggested: {Number(row.scan.stats?.suggestedPrice || 0) > 0 ? `$${Number(row.scan.stats.suggestedPrice).toFixed(2)}` : "review price manually"}
                      </div>
                    ) : null}
                    {row.error ? <p className="text-sm font-bold text-red-700 sm:col-span-2 lg:col-span-4">{row.error}</p> : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}

      <style jsx>{`
        .input { width: 100%; border: 2px solid #d4d4d4; border-radius: 0.65rem; padding: 0.7rem 0.8rem; background: white; font-weight: 650; }
        .input:focus { border-color: #111318; outline: none; box-shadow: 0 0 0 3px rgba(250, 204, 21, 0.45); }
      `}</style>
    </section>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block text-sm font-black text-neutral-700 ${className}`}>{label}{children}</label>;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 font-black">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-5 w-5" />
      {label}
    </label>
  );
}
