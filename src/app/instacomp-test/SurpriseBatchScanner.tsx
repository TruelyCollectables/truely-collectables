"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getAccountSession,
  type StoredAccountSession,
} from "@/src/app/account/account-session";
import {
  instaCompDropFileSignature,
  pairInstaCompDropFiles,
  runInstaCompBatchQueue,
} from "@/src/lib/instacomp-batch-drop";

type AiResult = {
  player: string | null;
  year: string | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallel: string | null;
  serialNumber: string | null;
  team: string | null;
  sport: string | null;
  isRookie: boolean;
  isAuto: boolean;
  isRelic: boolean;
  confidence: number;
  notes: string | null;
};

type SurpriseBenchmark = {
  exposure: "seen_memory" | "cold_lora" | "registry_resolved" | "fallback" | "unknown";
  seenByMemory: boolean;
  coldLora: boolean;
  candidateFallback: boolean;
  registryLocked: boolean;
  registryOutcome: string;
  registryIdentityId: string | null;
  registryFingerprintSha256: string | null;
  matchSource: string;
  localProvider: string | null;
  scanStatus: string;
  imagePairSha256: string | null;
  pricingCalled: false;
  teacherCalled: false;
  outsideAiCouncilCalled: false;
  learningMutation: false;
  inventoryMutation: false;
};

type SurpriseResponse = {
  ok: boolean;
  mode?: "SURPRISE";
  error?: string;
  details?: string;
  scanId?: string;
  cardUuid?: string | null;
  ai?: AiResult | null;
  benchmark?: SurpriseBenchmark;
  durationMs?: number;
};

type CardStatus = "incomplete" | "queued" | "scanning" | "done" | "error";

type SurpriseCard = {
  id: string;
  pairKey: string;
  pairing: "filename" | "drop_order";
  front: File | null;
  back: File | null;
  frontPreview: string | null;
  backPreview: string | null;
  status: CardStatus;
  result: SurpriseResponse | null;
  error: string | null;
};

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_CARDS = 100;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function id() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `surprise-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function percent(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

function identityTitle(ai: AiResult | null | undefined) {
  if (!ai) return "No identity returned";
  return [
    ai.year,
    ai.brand,
    ai.setName,
    ai.player,
    ai.isRookie ? "RC" : null,
    ai.parallel,
    ai.cardNumber ? `#${String(ai.cardNumber).replace(/^#/, "")}` : null,
    ai.serialNumber,
    ai.isAuto ? "AUTO" : null,
    ai.isRelic ? "RELIC" : null,
  ]
    .filter(Boolean)
    .join(" ") || "Identity incomplete";
}

function exposureLabel(value: SurpriseBenchmark["exposure"] | undefined) {
  if (value === "cold_lora") return "COLD LoRA";
  if (value === "seen_memory") return "SEEN / MEMORY";
  if (value === "registry_resolved") return "REGISTRY RESOLVED";
  if (value === "fallback") return "FALLBACK";
  return "UNKNOWN";
}

function exposureStyle(value: SurpriseBenchmark["exposure"] | undefined) {
  if (value === "cold_lora") return { background: "#e8f7ee", color: "#145c2e" };
  if (value === "seen_memory") return { background: "#edf3ff", color: "#234f9b" };
  if (value === "registry_resolved") return { background: "#f2edff", color: "#55338f" };
  if (value === "fallback") return { background: "#fff0f0", color: "#8a1c1c" };
  return { background: "#fff7df", color: "#765700" };
}

export default function SurpriseBatchScanner() {
  const [accountSession] = useState<StoredAccountSession | null>(() =>
    typeof window === "undefined" ? null : getAccountSession(),
  );
  const [cards, setCards] = useState<SurpriseCard[]>([]);
  const [running, setRunning] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [concurrency, setConcurrency] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previews = useRef(new Set<string>());

  useEffect(() => {
    const urls = previews.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const finished = cards.filter((card) => card.status === "done" && card.result?.benchmark);
  const summary = useMemo(() => {
    const results = finished.map((card) => card.result!.benchmark!);
    const cold = results.filter((row) => row.coldLora);
    const coldLocked = cold.filter((row) => row.registryLocked).length;
    const registryLocked = results.filter((row) => row.registryLocked).length;
    return {
      tested: results.length,
      registryLocked,
      overallRate: results.length ? registryLocked / results.length : 0,
      cold: cold.length,
      coldLocked,
      coldRate: cold.length ? coldLocked / cold.length : 0,
      seen: results.filter((row) => row.seenByMemory).length,
      registryResolved: results.filter((row) => row.exposure === "registry_resolved").length,
      fallback: results.filter((row) => row.candidateFallback).length,
      review: results.filter((row) => !row.registryLocked).length,
      errors: cards.filter((card) => card.status === "error").length,
    };
  }, [cards, finished]);

  function preview(file: File | null) {
    if (!file) return null;
    const url = URL.createObjectURL(file);
    previews.current.add(url);
    return url;
  }

  function revoke(url: string | null) {
    if (!url) return;
    URL.revokeObjectURL(url);
    previews.current.delete(url);
  }

  function validate(file: File) {
    if (!ALLOWED_TYPES.has(file.type.toLowerCase())) {
      return `${file.name}: use JPEG, PNG, or WebP.`;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return `${file.name}: each image must be 12 MB or smaller.`;
    }
    return null;
  }

  function addFiles(files: FileList | File[]) {
    const incoming = Array.from(files);
    if (!incoming.length || running) return;
    setError(null);
    setMessage(null);

    const valid: File[] = [];
    const errors: string[] = [];
    incoming.forEach((file) => {
      const problem = validate(file);
      if (problem) errors.push(problem);
      else valid.push(file);
    });

    const existing = cards.flatMap((card) =>
      [card.front, card.back]
        .filter((file): file is File => Boolean(file))
        .map(instaCompDropFileSignature),
    );
    const paired = pairInstaCompDropFiles(valid, existing);
    const slots = Math.max(0, MAX_BATCH_CARDS - cards.length);
    const accepted = paired.pairs.slice(0, slots);
    const added: SurpriseCard[] = accepted.map((pair) => ({
      id: id(),
      pairKey: pair.pairKey,
      pairing: pair.pairing,
      front: pair.front,
      back: pair.back,
      frontPreview: preview(pair.front),
      backPreview: preview(pair.back),
      status: pair.front && pair.back ? "queued" : "incomplete",
      result: null,
      error: null,
    }));
    setCards((current) => [...current, ...added]);

    const notes: string[] = [];
    if (added.length) notes.push(`Added ${added.length} card${added.length === 1 ? "" : "s"}.`);
    if (paired.duplicateCount) notes.push(`Skipped ${paired.duplicateCount} duplicate image${paired.duplicateCount === 1 ? "" : "s"}.`);
    if (paired.pairs.length > accepted.length) notes.push(`SURPRISE is capped at ${MAX_BATCH_CARDS} cards per batch.`);
    setMessage(notes.join(" ") || null);
    if (errors.length) setError(errors.join(" "));
  }

  function swap(cardId: string) {
    if (running) return;
    setCards((current) =>
      current.map((card) =>
        card.id === cardId
          ? {
              ...card,
              front: card.back,
              back: card.front,
              frontPreview: card.backPreview,
              backPreview: card.frontPreview,
              status: card.front && card.back ? "queued" : "incomplete",
              result: null,
              error: null,
            }
          : card,
      ),
    );
  }

  function remove(cardId: string) {
    if (running) return;
    const card = cards.find((value) => value.id === cardId);
    if (card) {
      revoke(card.frontPreview);
      revoke(card.backPreview);
    }
    setCards((current) => current.filter((value) => value.id !== cardId));
  }

  function clear() {
    if (running) return;
    cards.forEach((card) => {
      revoke(card.frontPreview);
      revoke(card.backPreview);
    });
    setCards([]);
    setMessage(null);
    setError(null);
  }

  async function execute(card: SurpriseCard) {
    if (!card.front || !card.back) throw new Error("Both front and back are required.");
    if (card.front.size + card.back.size > MAX_TOTAL_BYTES) {
      throw new Error("Front + back must total 20 MB or less.");
    }
    const form = new FormData();
    form.append("frontImage", card.front);
    form.append("backImage", card.back);
    const headers: HeadersInit = {};
    if (accountSession?.access_token) headers.Authorization = `Bearer ${accountSession.access_token}`;
    const response = await fetch("/api/instacomp/surprise", {
      method: "POST",
      body: form,
      headers,
      cache: "no-store",
      credentials: "same-origin",
    });
    const raw = await response.text();
    let data: SurpriseResponse;
    try {
      data = JSON.parse(raw) as SurpriseResponse;
    } catch {
      throw new Error(`SURPRISE returned ${response.status} without valid JSON: ${raw.slice(0, 250)}`);
    }
    if (!response.ok || !data.ok) {
      throw new Error([data.error, data.details].filter(Boolean).join(" — ") || `SURPRISE failed (${response.status}).`);
    }
    return data;
  }

  async function run() {
    if (running) return;
    const ready = cards.filter((card) => card.front && card.back);
    if (!ready.length) {
      setError("Add at least one complete front/back card pair first.");
      return;
    }
    setRunning(true);
    setError(null);
    setMessage(`SURPRISE started: ${ready.length} card${ready.length === 1 ? "" : "s"}. No teacher, sold comps, or outside AI council.`);
    setCards((current) =>
      current.map((card) =>
        ready.some((value) => value.id === card.id)
          ? { ...card, status: "queued", result: null, error: null }
          : card,
      ),
    );

    await runInstaCompBatchQueue({
      items: ready,
      concurrency,
      worker: async (card) => {
        setCards((current) =>
          current.map((value) =>
            value.id === card.id ? { ...value, status: "scanning" } : value,
          ),
        );
        return execute(card);
      },
      onOutcome: (outcome) => {
        setCards((current) =>
          current.map((value) => {
            if (value.id !== outcome.item.id) return value;
            if (outcome.status === "fulfilled") {
              return { ...value, status: "done", result: outcome.value, error: null };
            }
            return {
              ...value,
              status: "error",
              result: null,
              error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
            };
          }),
        );
      },
    });

    setRunning(false);
    setMessage("SURPRISE batch complete. Results below are Mac-local only; seen/memory cards are separated from cold LoRA cards.");
  }

  return (
    <div>
      <section style={panel}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: 1.5, color: "#8a1c1c" }}>SURPRISE MODE</div>
            <h2 style={{ margin: "4px 0 6px" }}>Blind stack benchmark</h2>
            <p style={{ margin: 0, color: "#555", maxWidth: 760 }}>
              Upload front + back images. This route talks only to the Mac InstaComp engine. It does not run sold comps, pricing, the outside teacher, or the website AI council. Memory hits are labeled separately so they cannot masquerade as cold LoRA performance.
            </p>
          </div>
          <div style={{ fontSize: 12, color: "#555", maxWidth: 300 }}>
            Up to 100 cards · JPEG/PNG/WebP · 12 MB per image · 20 MB per card pair
          </div>
        </div>

        <label
          onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
          onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
          onDragLeave={(event) => { event.preventDefault(); setDragActive(false); }}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            addFiles(event.dataTransfer.files);
          }}
          style={{
            display: "block",
            marginTop: 18,
            padding: 28,
            borderRadius: 14,
            border: `2px dashed ${dragActive ? "#8a1c1c" : "#aaa"}`,
            background: dragActive ? "#fff4f4" : "#fafafa",
            textAlign: "center",
            cursor: running ? "not-allowed" : "pointer",
          }}
        >
          <strong>Drop the entire SURPRISE stack here</strong>
          <div style={{ marginTop: 6, fontSize: 13, color: "#666" }}>
            Names ending in front/back pair automatically; otherwise files pair in drop order.
          </div>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={running}
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.currentTarget.value = "";
            }}
            style={{ marginTop: 14 }}
          />
        </label>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
          <button onClick={run} disabled={running || !cards.some((card) => card.front && card.back)} style={primaryButton}>
            {running ? "SURPRISE RUNNING…" : `RUN SURPRISE (${cards.filter((card) => card.front && card.back).length})`}
          </button>
          <button onClick={clear} disabled={running || !cards.length} style={secondaryButton}>Clear stack</button>
          <label style={{ fontSize: 13 }}>
            Concurrency{" "}
            <select value={concurrency} disabled={running} onChange={(event) => setConcurrency(Number(event.target.value))}>
              <option value={1}>1 — safest</option>
              <option value={2}>2</option>
            </select>
          </label>
        </div>
        {message ? <p style={{ color: "#145c2e", marginBottom: 0 }}>{message}</p> : null}
        {error ? <p style={{ color: "#8a1c1c", marginBottom: 0 }}>{error}</p> : null}
      </section>

      <section style={{ ...panel, marginTop: 18 }}>
        <h2 style={{ marginTop: 0 }}>SURPRISE scoreboard</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10 }}>
          <Metric label="Tested" value={String(summary.tested)} />
          <Metric label="Registry locked" value={`${summary.registryLocked} (${percent(summary.overallRate)})`} />
          <Metric label="Cold LoRA" value={String(summary.cold)} />
          <Metric label="Cold LoRA locked" value={`${summary.coldLocked} (${percent(summary.coldRate)})`} />
          <Metric label="Seen / memory" value={String(summary.seen)} />
          <Metric label="Registry resolved" value={String(summary.registryResolved)} />
          <Metric label="Review / no lock" value={String(summary.review)} />
          <Metric label="Fallback" value={String(summary.fallback)} danger={summary.fallback > 0} />
          <Metric label="Errors" value={String(summary.errors)} danger={summary.errors > 0} />
        </div>
        <p style={{ fontSize: 12, color: "#666", marginBottom: 0 }}>
          “Registry locked” is the system-authoritative pass: exact Registry identity + fingerprint returned by the Mac. A human-known correction still outranks the machine if a physical card proves the system wrong.
        </p>
      </section>

      <section style={{ ...panel, marginTop: 18 }}>
        <h2 style={{ marginTop: 0 }}>Cards</h2>
        {!cards.length ? (
          <p style={{ color: "#666" }}>No SURPRISE cards loaded yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {cards.map((card, index) => {
              const bench = card.result?.benchmark;
              return (
                <article key={card.id} style={{ border: "1px solid #ddd", borderRadius: 12, padding: 12 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "110px 110px minmax(0, 1fr)", gap: 12, alignItems: "start" }}>
                    <Preview label="Front" url={card.frontPreview} />
                    <Preview label="Back" url={card.backPreview} />
                    <div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <strong>#{index + 1}</strong>
                        <span style={{ ...pill, ...exposureStyle(bench?.exposure) }}>{exposureLabel(bench?.exposure)}</span>
                        <span style={{ ...pill, background: card.status === "done" ? "#e8f7ee" : card.status === "error" ? "#fff0f0" : "#f3f3f3" }}>{card.status}</span>
                        {bench?.registryLocked ? <span style={{ ...pill, background: "#e8f7ee", color: "#145c2e" }}>REGISTRY LOCKED</span> : null}
                      </div>
                      <div style={{ marginTop: 8, fontWeight: 800 }}>{identityTitle(card.result?.ai)}</div>
                      <div style={{ fontSize: 12, color: "#666", marginTop: 5 }}>
                        Pair: {card.pairKey} · {card.pairing.replaceAll("_", " ")}
                      </div>
                      {bench ? (
                        <div style={{ fontSize: 12, color: "#555", marginTop: 7 }}>
                          Source: {bench.matchSource} · Provider: {bench.localProvider || "none"} · Registry: {bench.registryOutcome}
                          {bench.registryIdentityId ? ` · ${bench.registryIdentityId}` : ""}
                        </div>
                      ) : null}
                      {card.error ? <div style={{ color: "#8a1c1c", marginTop: 7 }}>{card.error}</div> : null}
                      {!running && card.status !== "done" ? (
                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                          <button onClick={() => swap(card.id)} style={smallButton}>Swap front/back</button>
                          <button onClick={() => remove(card.id)} style={smallButton}>Remove</button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, background: danger ? "#fff0f0" : "#fafafa" }}>
      <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", fontWeight: 800 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 900, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function Preview({ label, url }: { label: string; url: string | null }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>{label}</div>
      {url ? (
        <img src={url} alt={label} style={{ width: 100, height: 140, objectFit: "contain", border: "1px solid #ddd", borderRadius: 8, background: "white" }} />
      ) : (
        <div style={{ width: 100, height: 140, border: "1px dashed #bbb", borderRadius: 8, display: "grid", placeItems: "center", color: "#888", fontSize: 12 }}>Missing</div>
      )}
    </div>
  );
}

const panel: React.CSSProperties = {
  background: "white",
  border: "1px solid #ddd",
  borderRadius: 14,
  padding: 20,
};

const pill: React.CSSProperties = {
  display: "inline-block",
  padding: "4px 8px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 900,
};

const primaryButton: React.CSSProperties = {
  border: 0,
  borderRadius: 9,
  padding: "11px 16px",
  background: "#8a1c1c",
  color: "white",
  fontWeight: 900,
  cursor: "pointer",
};

const secondaryButton: React.CSSProperties = {
  border: "1px solid #aaa",
  borderRadius: 9,
  padding: "10px 14px",
  background: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const smallButton: React.CSSProperties = {
  border: "1px solid #bbb",
  borderRadius: 7,
  padding: "6px 9px",
  background: "white",
  fontSize: 12,
  cursor: "pointer",
};
