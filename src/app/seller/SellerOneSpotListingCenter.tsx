"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { getFreshAccountSession } from "../account/account-session";

const MAX_ROWS = 20;
const MIN_JUDGMENTS = 8;
const TARGET_JUDGMENTS = 10;

type Scan = {
  ok: boolean;
  scanId: string | null;
  ai: {
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
    conditionGuess: string | null;
    confidence: number;
  };
  stats?: { suggestedPrice?: number | null; median?: number | null };
  soldStats?: { suggestedPrice?: number | null; median?: number | null };
  soldComps?: Array<{ title: string; price: number; url: string; source?: string }>;
  marketValueComps?: Array<{ title: string; price: number; url: string; source?: string }>;
  review?: { trustedForPricing?: boolean; reviewReasons?: string[] };
  consensus?: { trustedForIdentity?: boolean; reviewReasons?: string[] };
  ocrDiagnostics?: {
    aiCouncil?: {
      completedReaders?: number;
      attempts?: Array<{ label: string; status: string; message?: string | null }>;
    };
  };
};

type AiRow = {
  id: string;
  front: File;
  back: File | null;
  frontPreview: string;
  backPreview: string | null;
  status: "queued" | "scanning" | "ready" | "creating" | "created" | "error";
  passA: Scan | null;
  passB: Scan | null;
  title: string;
  price: string;
  quantity: string;
  verified: boolean;
  manualOverride: boolean;
  judgments: number;
  exactComps: number;
  reasons: string[];
  error: string | null;
  editUrl: string | null;
};

type EbayRow = {
  id: string;
  source_item_id: string;
  title: string;
  quantity: number;
  price: number | null;
  image_url: string | null;
  stage_status: string;
  item_condition: string | null;
  metadata?: Record<string, unknown> | null;
};

function normalized(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fileStem(name: string) {
  return name.replace(/\.[^.]+$/, "").trim();
}

function pairFiles(files: File[]) {
  const images = files.filter((file) =>
    ["image/jpeg", "image/png", "image/webp"].includes(file.type.toLowerCase()),
  );
  const named = new Map<string, { front?: File; back?: File }>();
  const unknown: File[] = [];

  images.forEach((file) => {
    const stem = fileStem(file.name);
    const match = stem.match(/^(.*?)[-_.\s]+(front|back|obverse|reverse|f|b)$/i);
    if (!match) {
      unknown.push(file);
      return;
    }
    const key = match[1].trim().toLowerCase();
    const group = named.get(key) || {};
    if (/^(front|obverse|f)$/i.test(match[2])) group.front = file;
    else group.back = file;
    named.set(key, group);
  });

  const pairs: Array<{ front: File; back: File | null }> = [];
  named.forEach((group) => {
    if (group.front) pairs.push({ front: group.front, back: group.back || null });
  });
  for (let index = 0; index < unknown.length; index += 2) {
    pairs.push({ front: unknown[index], back: unknown[index + 1] || null });
  }
  return pairs.slice(0, MAX_ROWS);
}

function priceFrom(scan: Scan) {
  return (
    scan.soldStats?.suggestedPrice ||
    scan.stats?.suggestedPrice ||
    scan.soldStats?.median ||
    scan.stats?.median ||
    null
  );
}

function uniqueComps(a: Scan, b: Scan) {
  const map = new Map<string, { title: string; price: number; url: string }>();
  [...(a.soldComps || []), ...(a.marketValueComps || []), ...(b.soldComps || []), ...(b.marketValueComps || [])].forEach(
    (comp) => map.set(`${normalized(comp.title)}|${Number(comp.price).toFixed(2)}|${comp.url}`, comp),
  );
  return Array.from(map.values());
}

function titleFrom(scan: Scan, fallback: string) {
  const ai = scan.ai;
  const values = [
    ai.year,
    ai.brand,
    ai.setName,
    ai.player,
    ai.isRookie ? "Rookie Card" : null,
    ai.parallel && !/^base$/i.test(ai.parallel) ? ai.parallel : null,
    ai.isAuto ? "Autograph" : null,
    ai.isRelic ? "Relic" : null,
    ai.cardNumber ? `#${String(ai.cardNumber).replace(/^#/, "")}` : null,
    ai.serialNumber,
  ];
  const seen = new Set<string>();
  const title = values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ");
  return title || fileStem(fallback) || "Unidentified Collectible";
}

function evaluate(a: Scan, b: Scan, hasBack: boolean) {
  const fields: Array<[string, unknown, unknown]> = [
    ["player", a.ai.player, b.ai.player],
    ["year", a.ai.year, b.ai.year],
    ["brand", a.ai.brand, b.ai.brand],
    ["set", a.ai.setName, b.ai.setName],
    ["card number", a.ai.cardNumber, b.ai.cardNumber],
    ["parallel", a.ai.parallel, b.ai.parallel],
    ["serial", a.ai.serialNumber, b.ai.serialNumber],
    ["autograph", a.ai.isAuto, b.ai.isAuto],
    ["relic", a.ai.isRelic, b.ai.isRelic],
  ];
  const disagreements = fields.filter(([, left, right]) => normalized(left) !== normalized(right));
  const judgments =
    2 +
    Number(a.ocrDiagnostics?.aiCouncil?.completedReaders || 0) +
    Number(b.ocrDiagnostics?.aiCouncil?.completedReaders || 0);
  const comps = uniqueComps(a, b);
  const confidence = Math.min(Number(a.ai.confidence || 0), Number(b.ai.confidence || 0));
  const reasons: string[] = [];
  if (!hasBack) reasons.push("Back image required for green approval");
  if (judgments < MIN_JUDGMENTS) reasons.push(`${judgments}/${TARGET_JUDGMENTS} AI judgments completed`);
  if (a.consensus?.trustedForIdentity !== true || b.consensus?.trustedForIdentity !== true)
    reasons.push("An AI council did not trust the exact identity");
  if (a.review?.trustedForPricing !== true || b.review?.trustedForPricing !== true)
    reasons.push("An InstaComp™ pass did not trust pricing");
  if (confidence < 0.9) reasons.push(`Minimum confidence ${Math.round(confidence * 100)}%`);
  if (!comps.length) reasons.push("No exact comp survived the match filters");
  if (disagreements.length) reasons.push(`${disagreements.length} core identity disagreement(s)`);
  return { verified: reasons.length === 0, reasons, judgments, exactComps: comps.length };
}

function money(value: number | null | undefined) {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export default function SellerOneSpotListingCenter() {
  const [token, setToken] = useState<string | null>(null);
  const [rows, setRows] = useState<AiRow[]>([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [ebayBusy, setEbayBusy] = useState(false);
  const [ebayRows, setEbayRows] = useState<EbayRow[]>([]);
  const [ebaySummary, setEbaySummary] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void (async () => {
      const session = await getFreshAccountSession(5 * 60, true);
      setToken(session?.access_token || null);
    })();
  }, []);

  const counts = useMemo(
    () => ({
      total: rows.length,
      verified: rows.filter((row) => row.verified).length,
      review: rows.filter((row) => row.status === "ready" && !row.verified).length,
      drafts: rows.filter((row) => row.status === "created").length,
    }),
    [rows],
  );

  function authHeaders(json = false): HeadersInit {
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  function addFiles(files: File[]) {
    const pairs = pairFiles(files);
    if (!pairs.length) {
      setNotice("Drop JPEG, PNG, or WebP images. Use front then back, or name files front/back.");
      return;
    }
    const created = pairs.map<AiRow>((pair, index) => ({
      id: `${Date.now()}-${index}-${pair.front.name}`,
      front: pair.front,
      back: pair.back,
      frontPreview: URL.createObjectURL(pair.front),
      backPreview: pair.back ? URL.createObjectURL(pair.back) : null,
      status: "queued",
      passA: null,
      passB: null,
      title: "",
      price: "",
      quantity: "1",
      verified: false,
      manualOverride: false,
      judgments: 0,
      exactComps: 0,
      reasons: [],
      error: null,
      editUrl: null,
    }));
    setRows(created);
    setNotice(`${created.length} item(s) loaded. Start AI + InstaComp™ when ready.`);
  }

  async function runPass(row: AiRow, label: string) {
    const form = new FormData();
    form.append("frontImage", row.front);
    if (row.back) form.append("backImage", row.back);
    form.append("aiCouncilTier", "courtroom");
    form.append("accuracyPassLabel", label);
    const response = await fetch("/api/instacomp/scan", {
      method: "POST",
      headers: authHeaders(),
      body: form,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) throw new Error(data?.error || `${label} failed`);
    return data as Scan;
  }

  async function scanOne(row: AiRow) {
    setRows((current) => current.map((item) => (item.id === row.id ? { ...item, status: "scanning", error: null } : item)));
    try {
      const [passA, passB] = await Promise.all([
        runPass(row, "Seller council A"),
        runPass(row, "Seller council B"),
      ]);
      const evidence = evaluate(passA, passB, Boolean(row.back));
      const selected = Number(passB.ai.confidence || 0) > Number(passA.ai.confidence || 0) ? passB : passA;
      const aPrice = priceFrom(passA);
      const bPrice = priceFrom(passB);
      const suggested = aPrice && bPrice ? (aPrice + bPrice) / 2 : aPrice || bPrice;
      setRows((current) =>
        current.map((item) =>
          item.id === row.id
            ? {
                ...item,
                status: "ready",
                passA,
                passB,
                title: titleFrom(selected, row.front.name),
                price: suggested ? suggested.toFixed(2) : "",
                verified: evidence.verified,
                judgments: evidence.judgments,
                exactComps: evidence.exactComps,
                reasons: evidence.reasons,
              }
            : item,
        ),
      );
    } catch (error: any) {
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item, status: "error", error: error?.message || "Scan failed" } : item)));
    }
  }

  async function scanAll() {
    if (!token) {
      setNotice("Log in as a seller before scanning.");
      return;
    }
    setBusy(true);
    const targets = rows.filter((row) => row.status === "queued" || row.status === "error");
    let cursor = 0;
    async function worker() {
      while (cursor < targets.length) {
        const row = targets[cursor++];
        await scanOne(row);
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, Math.max(1, targets.length)) }, () => worker()));
    setBusy(false);
    setNotice("AI + InstaComp™ finished. Green rows are evidence-approved; amber rows need your call.");
  }

  async function createDraft(row: AiRow) {
    if (!row.passA || !row.passB || (!row.verified && !row.manualOverride)) return;
    const price = Number(row.price);
    if (!price || price <= 0) {
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item, error: "Enter a positive price" } : item)));
      return;
    }
    const selected = Number(row.passB.ai.confidence || 0) > Number(row.passA.ai.confidence || 0) ? row.passB : row.passA;
    setRows((current) => current.map((item) => (item.id === row.id ? { ...item, status: "creating", error: null } : item)));
    const form = new FormData();
    form.append("frontImage", row.front);
    if (row.back) form.append("backImage", row.back);
    form.append("title", row.title);
    form.append("player", selected.ai.player || "");
    form.append("sport", selected.ai.sport || "Sports Cards");
    form.append("category", "sports_cards");
    form.append("condition", selected.ai.conditionGuess || "Near Mint or Better");
    form.append("serialNumber", selected.ai.serialNumber || "");
    form.append("price", price.toFixed(2));
    form.append("quantity", row.quantity || "1");
    form.append("scanId", selected.scanId || "");
    form.append(
      "scanMetadata",
      JSON.stringify({
        schema: "truely.sellerAccuracyCouncil.v1",
        targetJudgments: TARGET_JUDGMENTS,
        minimumJudgments: MIN_JUDGMENTS,
        verified: row.verified,
        manualOverride: row.manualOverride,
        judgments: row.judgments,
        exactComps: row.exactComps,
        reasons: row.reasons,
        passA: row.passA,
        passB: row.passB,
      }),
    );
    try {
      const response = await fetch("/api/account/seller/quick-list", {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.success) throw new Error(data?.error || "Draft creation failed");
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item, status: "created", editUrl: data.draft.editUrl } : item)));
    } catch (error: any) {
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item, status: "ready", error: error?.message || "Draft creation failed" } : item)));
    }
  }

  async function createAllApproved() {
    setBusy(true);
    for (const row of rows.filter((item) => item.status === "ready" && (item.verified || item.manualOverride))) {
      await createDraft(row);
    }
    setBusy(false);
    setNotice("Approved private seller drafts were created. Nothing was published automatically.");
  }

  async function loadEbayReview() {
    if (!token) return;
    const response = await fetch(
      "/api/account/seller/marketplace-connections/ebay/staged-items?limit=1000&importJobLimit=5",
      { headers: authHeaders() },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "Could not load eBay intake");
    const all = Array.isArray(data.stagedItems) ? (data.stagedItems as EbayRow[]) : [];
    setEbayRows(
      all.filter((row) => {
        const metadata = row.metadata || {};
        return row.stage_status === "needs_review" &&
          (metadata.intake_lane === "autograph_review" ||
            /\b(signed|autograph|autographed|jersey|puck|cd cover|album cover|record cover|memorabilia|game used|game worn)\b/i.test(row.title));
      }),
    );
  }

  async function syncAllEbay() {
    if (!token) {
      setEbaySummary("Log in and connect eBay first.");
      return;
    }
    setEbayBusy(true);
    setEbaySummary("Reading eBay inventory into private staging...");
    try {
      let first = true;
      let hasMore = true;
      let batches = 0;
      let staged = 0;
      let skipped = 0;
      while (hasMore && batches < 30) {
        const response = await fetch(
          "/api/account/seller/marketplace-connections/ebay/staged-items",
          {
            method: "POST",
            headers: authHeaders(true),
            body: JSON.stringify({ limit: 50, resetCursor: first }),
          },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || "eBay staging failed");
        staged += Number(data.result?.stagedCount || 0);
        skipped += Number(data.result?.skippedCount || 0);
        hasMore = data.result?.hasMore === true;
        first = false;
        batches += 1;
      }
      const normalizeResponse = await fetch(
        "/api/account/seller/marketplace-connections/ebay/intake-normalize",
        { method: "POST", headers: authHeaders(true), body: "{}" },
      );
      const normalizedData = await normalizeResponse.json().catch(() => ({}));
      if (!normalizeResponse.ok) throw new Error(normalizedData?.error || "Intake classification failed");
      await loadEbayReview();
      setEbaySummary(
        `${batches} batch(es): ${staged} staged, ${skipped} inactive/skipped. ${normalizedData.reviewCount || 0} autograph/memorabilia item(s) await your approval; ${normalizedData.blockedCount || 0} junk/denied item(s) blocked.`,
      );
    } catch (error: any) {
      setEbaySummary(error?.message || "eBay intake failed. Connect/reconnect eBay from Seller Connections.");
    } finally {
      setEbayBusy(false);
    }
  }

  async function decideEbay(row: EbayRow, action: "approve_to_draft" | "deny_forever") {
    if (!token) return;
    setEbayBusy(true);
    try {
      const decisionResponse = await fetch(
        "/api/account/seller/marketplace-connections/ebay/intake-decision",
        {
          method: "POST",
          headers: authHeaders(true),
          body: JSON.stringify({ stagedItemId: row.id, action }),
        },
      );
      const decisionData = await decisionResponse.json().catch(() => ({}));
      if (!decisionResponse.ok) throw new Error(decisionData?.error || "Decision failed");
      if (action === "approve_to_draft") {
        const promoteResponse = await fetch(
          "/api/account/seller/marketplace-connections/ebay/staged-items/promote",
          {
            method: "POST",
            headers: authHeaders(true),
            body: JSON.stringify({ stagedItemId: row.id }),
          },
        );
        const promoteData = await promoteResponse.json().catch(() => ({}));
        if (!promoteResponse.ok) throw new Error(promoteData?.error || "Draft promotion failed");
        setEbaySummary(`${row.title} is now a private seller draft.`);
      } else {
        setEbaySummary(`${row.title} denied forever. Future intake runs will keep it blocked.`);
      }
      await loadEbayReview();
    } catch (error: any) {
      setEbaySummary(error?.message || "Could not save the eBay decision");
    } finally {
      setEbayBusy(false);
    }
  }

  return (
    <section id="seller-listing-center" className="border-t-4 border-neutral-950 bg-[#efe9db] px-4 py-10 text-neutral-950 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="border-4 border-neutral-950 bg-yellow-300 p-6 shadow-[8px_8px_0_#111318]">
          <p className="text-xs font-black uppercase tracking-[0.2em]">Deadline Listing Command Center</p>
          <h2 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">List everything from one spot.</h2>
          <p className="mt-3 max-w-4xl font-bold leading-7">
            Drag cards into the Accuracy Council, run two independent InstaComp™ passes with up to 10 AI judgments, or pull eBay inventory into a private approval queue. Every output is a draft until you activate it.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a href="#ai-listing" className="border-2 border-neutral-950 bg-white px-4 py-3 text-sm font-black">AI Drag + Drop</a>
            <a href="#ebay-intake" className="border-2 border-neutral-950 bg-neutral-950 px-4 py-3 text-sm font-black text-white">eBay Intake</a>
            <a href="/seller/inventory" className="border-2 border-neutral-950 bg-white px-4 py-3 text-sm font-black">Private Drafts</a>
          </div>
        </header>

        <section id="ai-listing" className="border-2 border-neutral-950 bg-white p-5 shadow-[5px_5px_0_#111318]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-violet-700">Accuracy Council + InstaComp™</p>
              <h3 className="mt-1 text-3xl font-black">Drag front and back. AI does the grunt work.</h3>
              <p className="mt-2 max-w-3xl text-sm font-semibold text-neutral-600">
                Two full scans per card. Target: 10 judgments; green approval requires at least 8 completed judgments, exact comps, trusted identity/pricing, 90% confidence, and no core disagreement.
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs font-black">
              <Metric label="Loaded" value={counts.total} />
              <Metric label="Green" value={counts.verified} />
              <Metric label="Review" value={counts.review} />
              <Metric label="Drafts" value={counts.drafts} />
            </div>
          </div>

          <div
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault();
              setDragging(false);
              addFiles(Array.from(event.dataTransfer.files));
            }}
            onClick={() => fileRef.current?.click()}
            className={`mt-5 cursor-pointer border-4 border-dashed p-8 text-center transition ${dragging ? "border-violet-600 bg-violet-100" : "border-neutral-950 bg-neutral-50"}`}
          >
            <p className="text-2xl font-black">Drop card photos here</p>
            <p className="mt-2 text-sm font-semibold text-neutral-600">Name files Player-front / Player-back, or upload front then back. Up to {MAX_ROWS} cards per run.</p>
            <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => addFiles(Array.from(event.target.files || []))} />
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" disabled={busy || !rows.length} onClick={() => void scanAll()} className="border-2 border-neutral-950 bg-violet-600 px-5 py-3 font-black text-white disabled:opacity-40">
              {busy ? "Working..." : "Run AI + InstaComp™"}
            </button>
            <button type="button" disabled={busy || !rows.some((row) => row.status === "ready" && (row.verified || row.manualOverride))} onClick={() => void createAllApproved()} className="border-2 border-neutral-950 bg-emerald-500 px-5 py-3 font-black disabled:opacity-40">
              Create Approved Drafts
            </button>
            <button type="button" onClick={() => setRows([])} className="border-2 border-neutral-950 bg-white px-5 py-3 font-black">Clear</button>
          </div>
          {notice ? <p className="mt-4 border-2 border-neutral-950 bg-yellow-100 px-4 py-3 text-sm font-bold">{notice}</p> : null}

          <div className="mt-5 space-y-4">
            {rows.map((row) => (
              <article key={row.id} className="grid gap-4 border-2 border-neutral-950 bg-white p-4 lg:grid-cols-[180px_minmax(0,1fr)_220px]">
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                  <img src={row.frontPreview} alt="Front" className="aspect-[4/5] w-full border object-contain" />
                  {row.backPreview ? <img src={row.backPreview} alt="Back" className="aspect-[4/5] w-full border object-contain" /> : <div className="flex aspect-[4/5] items-center justify-center border bg-amber-50 p-3 text-center text-xs font-bold">Back missing</div>}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`border px-2 py-1 text-xs font-black uppercase ${row.status === "created" || row.verified ? "border-emerald-300 bg-emerald-100" : row.status === "error" ? "border-rose-300 bg-rose-100" : "border-amber-300 bg-amber-100"}`}>
                      {row.status === "ready" ? (row.verified ? "Accuracy verified" : "Review required") : row.status}
                    </span>
                    {row.passA ? <span className="text-xs font-bold">{row.judgments}/{TARGET_JUDGMENTS} AI judgments · {row.exactComps} exact comp(s)</span> : null}
                  </div>
                  <label className="mt-3 block text-xs font-black uppercase">Listing title</label>
                  <input value={row.title} onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, title: event.target.value } : item))} className="mt-1 w-full border-2 border-neutral-950 px-3 py-2 font-bold" />
                  {row.reasons.length ? <ul className="mt-3 space-y-1 text-xs font-semibold text-amber-900">{row.reasons.map((reason) => <li key={reason}>• {reason}</li>)}</ul> : null}
                  {row.error ? <p className="mt-3 text-sm font-bold text-rose-700">{row.error}</p> : null}
                  {!row.verified && row.status === "ready" ? (
                    <label className="mt-3 flex items-start gap-2 text-sm font-bold">
                      <input type="checkbox" checked={row.manualOverride} onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, manualOverride: event.target.checked } : item))} />
                      I reviewed this amber row and approve creating a private draft.
                    </label>
                  ) : null}
                </div>
                <div>
                  <label className="block text-xs font-black uppercase">Price</label>
                  <input type="number" min="0.01" step="0.01" value={row.price} onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, price: event.target.value } : item))} className="mt-1 w-full border-2 border-neutral-950 px-3 py-2 text-xl font-black" />
                  <label className="mt-3 block text-xs font-black uppercase">Quantity</label>
                  <input type="number" min="1" max="999" value={row.quantity} onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, quantity: event.target.value } : item))} className="mt-1 w-full border-2 border-neutral-950 px-3 py-2 font-bold" />
                  {row.status === "created" && row.editUrl ? (
                    <a href={row.editUrl} className="mt-4 block border-2 border-neutral-950 bg-emerald-500 px-3 py-3 text-center font-black">Open Private Draft</a>
                  ) : (
                    <button type="button" disabled={row.status !== "ready" || (!row.verified && !row.manualOverride)} onClick={() => void createDraft(row)} className="mt-4 w-full border-2 border-neutral-950 bg-neutral-950 px-3 py-3 font-black text-white disabled:opacity-30">Create Private Draft</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="ebay-intake" className="border-2 border-neutral-950 bg-white p-5 shadow-[5px_5px_0_#111318]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-700">eBay King Mode Intake</p>
              <h3 className="mt-1 text-3xl font-black">Cards flow. Signed memorabilia waits for your command.</h3>
              <p className="mt-2 max-w-3xl text-sm font-semibold text-neutral-600">
                Sports cards remain in the existing sync lane. Signed jerseys, pucks, CD/album covers, photos, balls, bats, helmets, sticks, and memorabilia are held here. Pants, shoes, watches, and automotive parts are blocked.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={ebayBusy} onClick={() => void syncAllEbay()} className="border-2 border-neutral-950 bg-blue-600 px-5 py-3 font-black text-white disabled:opacity-40">{ebayBusy ? "Syncing..." : "Sync All eBay Now"}</button>
              <button type="button" disabled={ebayBusy || !token} onClick={() => void loadEbayReview().catch((error) => setEbaySummary(error.message))} className="border-2 border-neutral-950 bg-white px-5 py-3 font-black">Refresh Review</button>
              <a href="/seller/marketplaces" className="border-2 border-neutral-950 bg-white px-5 py-3 font-black">Connect / Advanced</a>
            </div>
          </div>
          {ebaySummary ? <p className="mt-4 border-2 border-neutral-950 bg-blue-50 px-4 py-3 text-sm font-bold">{ebaySummary}</p> : null}

          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ebayRows.map((row) => {
              const metadata = row.metadata || {};
              return (
                <article key={row.id} className="border-2 border-neutral-950 bg-[#f7f3e8] p-3 shadow-[3px_3px_0_#111318]">
                  {row.image_url ? <img src={row.image_url} alt={row.title} className="aspect-square w-full border bg-white object-contain" /> : <div className="flex aspect-square items-center justify-center border bg-white font-bold">No image</div>}
                  <p className="mt-3 text-xs font-black uppercase text-blue-700">Approval required · {String(metadata.category_hint || "memorabilia")}</p>
                  <h4 className="mt-1 line-clamp-3 text-lg font-black">{row.title}</h4>
                  <div className="mt-3 flex items-end justify-between gap-3">
                    <p className="text-2xl font-black">{money(row.price)}</p>
                    <p className="text-xs font-bold">QTY {row.quantity}</p>
                  </div>
                  <p className="mt-2 text-xs font-semibold text-neutral-600">{String(metadata.intake_reason || "Autograph or memorabilia review")}</p>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button type="button" disabled={ebayBusy} onClick={() => void decideEbay(row, "approve_to_draft")} className="border-2 border-neutral-950 bg-emerald-500 px-3 py-3 text-sm font-black">Approve to Draft</button>
                    <button type="button" disabled={ebayBusy} onClick={() => void decideEbay(row, "deny_forever")} className="border-2 border-neutral-950 bg-rose-600 px-3 py-3 text-sm font-black text-white">Deny Forever</button>
                  </div>
                </article>
              );
            })}
          </div>
          {!ebayRows.length ? <div className="mt-5 border-2 border-dashed border-neutral-400 p-6 text-center font-bold text-neutral-600">No autograph or memorabilia items are waiting. Run Sync All eBay Now or refresh the review queue.</div> : null}
        </section>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-16 border-2 border-neutral-950 bg-white px-2 py-2">
      <p className="text-[10px] uppercase text-neutral-500">{label}</p>
      <p className="text-xl">{value}</p>
    </div>
  );
}
