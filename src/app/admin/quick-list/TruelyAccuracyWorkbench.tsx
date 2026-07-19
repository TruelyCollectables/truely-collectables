"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { normalizeInstaCompListingSerial } from "../../../lib/instacomp-listing-serial";

type AiIdentity = {
  player: string | null;
  year: string | null;
  brand: string | null;
  setName: string | null;
  cardNumber: string | null;
  parallel: string | null;
  serialNumber: string | null;
  gradingCompany?: string | null;
  gradeValue?: string | null;
  certificationNumber?: string | null;
  team: string | null;
  sport: string | null;
  isRookie: boolean;
  isAuto: boolean;
  isRelic: boolean;
  conditionGuess: string | null;
  confidence: number;
  notes: string | null;
};

type CompEvidence = {
  title: string;
  price: number;
  url: string;
  source: string;
  sourceLabel: string;
  sourceCategory: "sold" | "marketplace" | "auction" | "pricing" | "reference" | "broad";
  matchScore: number;
  flags: string[];
};

type SourceCoverage = {
  label: string;
  status: "included" | "registered" | "not_configured" | "no_matches" | "error";
  category: "sold" | "marketplace" | "auction" | "pricing" | "reference" | "broad";
  includedInMarketValue: boolean;
  resultCount: number;
  message: string | null;
};

type CouncilAttempt = {
  provider: string;
  label: string;
  model: string;
  status: "completed" | "not_configured" | "error" | "skipped";
  durationMs: number | null;
  message: string | null;
};

type AccuracyScanResponse = {
  ok: boolean;
  scanId: string | null;
  ai: AiIdentity;
  searchQuery: string;
  stats: {
    low: number | null;
    median: number | null;
    average: number | null;
    high: number | null;
    suggestedPrice: number | null;
  };
  soldStats: {
    low: number | null;
    median: number | null;
    average: number | null;
    high: number | null;
    suggestedPrice: number | null;
  };
  marketValueComps?: CompEvidence[];
  soldComps?: CompEvidence[];
  sourceCoverage?: SourceCoverage[];
  review?: {
    status: "trusted_for_pricing" | "review_required";
    trustedForPricing: boolean;
    reviewReasons: string[];
    identityReviewReasons: string[];
    pricingReviewReasons: string[];
  };
  consensus?: {
    status: "consensus_confirmed" | "review_required";
    trustedForIdentity: boolean;
    reviewReasons: string[];
    fieldDecisions?: Array<{
      field: string;
      status: string;
      value: string | boolean | null;
      conflictingValues: string[];
      reason: string;
    }>;
  };
  catalogEvidence?: {
    status: "catalog_confirmed" | "review_required";
    catalogConfirmed: boolean;
    sourceAttribution?: {
      sourceLabel: string;
      catalogId: string;
    } | null;
  } | null;
  ocrDiagnostics?: {
    provider?: string | null;
    checkedImages?: number;
    extractedSerialNumber?: string | null;
    speedLane?: "fast_lane" | "escalated_multi_ai" | null;
    aiCouncil?: {
      tier: string;
      desiredReaders: number;
      completedReaders: number;
      attempts: CouncilAttempt[];
    };
  };
};

type RowStatus =
  | "queued"
  | "scanning"
  | "ready"
  | "drafting"
  | "created"
  | "error";

type BenchmarkVerdict = "ungraded" | "correct" | "wrong";

type VerificationSummary = {
  status: "verified" | "review";
  highRisk: boolean;
  reasons: string[];
  disagreements: string[];
  aiJudgmentsCompleted: number;
  aiJudgmentsTarget: number;
  completedProviderLabels: string[];
  unavailableProviderLabels: string[];
  exactCompCount: number;
  compSources: string[];
  catalogConfirmed: boolean;
  minimumConfidence: number;
  priceSpreadPercent: number | null;
  combinedSuggestedPrice: number | null;
};

type AccuracyRow = {
  id: string;
  front: File;
  back: File | null;
  frontPreview: string;
  backPreview: string | null;
  pairingMethod: "filename" | "upload_order" | "front_only";
  status: RowStatus;
  passA: AccuracyScanResponse | null;
  passB: AccuracyScanResponse | null;
  verification: VerificationSummary | null;
  title: string;
  rawSerial: string | null;
  listingSerial: string | null;
  price: string;
  quantity: string;
  manualOverride: boolean;
  benchmarkVerdict: BenchmarkVerdict;
  error: string | null;
  elapsedMs: number | null;
  legacyProductId: number | null;
  editUrl: string | null;
};

type ImageCandidate = {
  file: File;
  side: "front" | "back" | "unknown";
  key: string;
  index: number;
};

type ImagePair = {
  front: File;
  back: File | null;
  pairingMethod: AccuracyRow["pairingMethod"];
};

const MAX_ROWS = 100;
const ROW_CONCURRENCY = 8;
const DRAFT_CONCURRENCY = 3;
const AI_JUDGMENT_TARGET = 10;
const MINIMUM_AI_JUDGMENTS = 8;
const TARGET_BENCHMARK_CARDS = 100;
const TARGET_ACCURACY_PERCENT = 98;

function money(value: number | null | undefined) {
  return value == null || !Number.isFinite(Number(value))
    ? "—"
    : Number(value).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
      });
}

function cleanFileBase(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim();
}

function classifyImage(file: File, index: number): ImageCandidate {
  const base = cleanFileBase(file.name);
  const front = base.match(/^(.*?)(?:[-_.\s]+)(front|obverse|f)$/i);
  const back = base.match(/^(.*?)(?:[-_.\s]+)(back|reverse|b)$/i);

  if (front) {
    return {
      file,
      side: "front",
      key: front[1].trim().toLowerCase() || `row-${index}`,
      index,
    };
  }

  if (back) {
    return {
      file,
      side: "back",
      key: back[1].trim().toLowerCase() || `row-${index}`,
      index,
    };
  }

  return { file, side: "unknown", key: `unknown-${index}`, index };
}

function pairImages(files: File[]) {
  const candidates = files.map(classifyImage);
  const named = new Map<
    string,
    { fronts: ImageCandidate[]; backs: ImageCandidate[] }
  >();
  const unknown: ImageCandidate[] = [];

  for (const candidate of candidates) {
    if (candidate.side === "unknown") {
      unknown.push(candidate);
      continue;
    }

    const group = named.get(candidate.key) || { fronts: [], backs: [] };
    group[candidate.side === "front" ? "fronts" : "backs"].push(candidate);
    named.set(candidate.key, group);
  }

  const pairs: Array<ImagePair & { index: number }> = [];
  let skippedBackOnly = 0;
  let pairedByOrder = 0;

  for (const group of named.values()) {
    group.fronts.sort((a, b) => a.index - b.index);
    group.backs.sort((a, b) => a.index - b.index);

    group.fronts.forEach((front, index) => {
      const back = group.backs[index] || null;
      pairs.push({
        front: front.file,
        back: back?.file || null,
        pairingMethod: back ? "filename" : "front_only",
        index: Math.min(front.index, back?.index ?? front.index),
      });
    });

    skippedBackOnly += Math.max(0, group.backs.length - group.fronts.length);
  }

  unknown.sort((a, b) => a.index - b.index);

  for (let index = 0; index < unknown.length; index += 2) {
    const front = unknown[index];
    const back = unknown[index + 1] || null;
    if (back) pairedByOrder += 1;

    pairs.push({
      front: front.file,
      back: back?.file || null,
      pairingMethod: back ? "upload_order" : "front_only",
      index: front.index,
    });
  }

  return {
    pairs: pairs
      .sort((a, b) => a.index - b.index)
      .map(({ index: _index, ...pair }) => pair),
    skippedBackOnly,
    pairedByOrder,
  };
}

function normalizedText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[™®]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedParallel(value: unknown) {
  const normalized = normalizedText(value);
  return normalized === "base" ? "base" : normalized;
}

function normalizedSerial(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\bone\s+of\s+one\b/g, "1/1")
    .replace(/\s+of\s+/g, "/")
    .replace(/\s+/g, "")
    .replace(/^#/, "");
}

function fieldDisagreements(a: AccuracyScanResponse, b: AccuracyScanResponse) {
  const fields: Array<{
    label: string;
    left: unknown;
    right: unknown;
    normalize?: (value: unknown) => string;
  }> = [
    { label: "player", left: a.ai.player, right: b.ai.player },
    { label: "year", left: a.ai.year, right: b.ai.year },
    { label: "brand", left: a.ai.brand, right: b.ai.brand },
    { label: "set/product", left: a.ai.setName, right: b.ai.setName },
    { label: "card number", left: a.ai.cardNumber, right: b.ai.cardNumber },
    {
      label: "parallel/refractor",
      left: a.ai.parallel,
      right: b.ai.parallel,
      normalize: normalizedParallel,
    },
    {
      label: "serial number",
      left: a.ai.serialNumber,
      right: b.ai.serialNumber,
      normalize: normalizedSerial,
    },
    { label: "team", left: a.ai.team, right: b.ai.team },
    { label: "sport", left: a.ai.sport, right: b.ai.sport },
    { label: "rookie status", left: a.ai.isRookie, right: b.ai.isRookie },
    { label: "autograph status", left: a.ai.isAuto, right: b.ai.isAuto },
    { label: "relic status", left: a.ai.isRelic, right: b.ai.isRelic },
    {
      label: "grading company",
      left: a.ai.gradingCompany,
      right: b.ai.gradingCompany,
    },
    { label: "grade", left: a.ai.gradeValue, right: b.ai.gradeValue },
    {
      label: "grading certification",
      left: a.ai.certificationNumber,
      right: b.ai.certificationNumber,
    },
  ];

  return fields.flatMap((field) => {
    const normalize = field.normalize || normalizedText;
    const left = normalize(field.left);
    const right = normalize(field.right);
    return left === right
      ? []
      : [`${field.label}: “${String(field.left ?? "unknown")}” vs “${String(field.right ?? "unknown")}”`];
  });
}

function scanSuggestedPrice(scan: AccuracyScanResponse) {
  const candidates = [
    scan.soldStats?.suggestedPrice,
    scan.stats?.suggestedPrice,
    scan.soldStats?.median,
    scan.stats?.median,
  ];

  return (
    candidates.find(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value) && value > 0,
    ) || null
  );
}

function uniqueComps(scans: AccuracyScanResponse[]) {
  const seen = new Set<string>();
  const comps: CompEvidence[] = [];

  scans
    .flatMap((scan) => [
      ...(scan.soldComps || []),
      ...(scan.marketValueComps || []),
    ])
    .forEach((comp) => {
      const key = `${normalizedText(comp.sourceLabel || comp.source)}|${normalizedText(
        comp.title,
      )}|${Number(comp.price || 0).toFixed(2)}|${comp.url || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      comps.push(comp);
    });

  return comps;
}

function completedCouncilAttempts(scan: AccuracyScanResponse) {
  return (scan.ocrDiagnostics?.aiCouncil?.attempts || []).filter(
    (attempt) => attempt.status === "completed",
  );
}

function unavailableCouncilAttempts(scan: AccuracyScanResponse) {
  return (scan.ocrDiagnostics?.aiCouncil?.attempts || []).filter(
    (attempt) => attempt.status === "not_configured" || attempt.status === "error",
  );
}

function isHighRiskIdentity(ai: AiIdentity) {
  const parallel = normalizedParallel(ai.parallel);
  return Boolean(
    ai.serialNumber ||
      ai.isAuto ||
      ai.isRelic ||
      ai.gradingCompany ||
      (parallel && parallel !== "base"),
  );
}

function verificationSummary(
  passA: AccuracyScanResponse,
  passB: AccuracyScanResponse,
  hasBack: boolean,
): VerificationSummary {
  const disagreements = fieldDisagreements(passA, passB);
  const highRisk = isHighRiskIdentity(passA.ai) || isHighRiskIdentity(passB.ai);
  const completedA = completedCouncilAttempts(passA);
  const completedB = completedCouncilAttempts(passB);
  const unavailable = [
    ...unavailableCouncilAttempts(passA),
    ...unavailableCouncilAttempts(passB),
  ];
  const aiJudgmentsCompleted =
    2 +
    Number(passA.ocrDiagnostics?.aiCouncil?.completedReaders || completedA.length) +
    Number(passB.ocrDiagnostics?.aiCouncil?.completedReaders || completedB.length);
  const comps = uniqueComps([passA, passB]);
  const compSources = Array.from(
    new Set(
      comps
        .map((comp) => comp.sourceLabel || comp.source)
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  const priceA = scanSuggestedPrice(passA);
  const priceB = scanSuggestedPrice(passB);
  const priceSpreadPercent =
    priceA && priceB
      ? (Math.abs(priceA - priceB) / Math.max(priceA, priceB)) * 100
      : null;
  const combinedSuggestedPrice =
    priceA && priceB
      ? Math.round(((priceA + priceB) / 2) * 100) / 100
      : priceA || priceB || null;
  const minimumConfidence = Math.min(
    Number(passA.ai.confidence || 0),
    Number(passB.ai.confidence || 0),
  );
  const catalogConfirmed = Boolean(
    passA.catalogEvidence?.catalogConfirmed || passB.catalogEvidence?.catalogConfirmed,
  );
  const reasons: string[] = [];

  if (!hasBack) reasons.push("Back image is required for accuracy approval.");
  if (disagreements.length) {
    reasons.push(`${disagreements.length} critical identity field${disagreements.length === 1 ? " disagrees" : "s disagree"} between the two independent passes.`);
  }
  if (aiJudgmentsCompleted < MINIMUM_AI_JUDGMENTS) {
    reasons.push(
      `Only ${aiJudgmentsCompleted}/${AI_JUDGMENT_TARGET} AI judgments completed; at least ${MINIMUM_AI_JUDGMENTS} are required for approval.`,
    );
  }
  if (
    passA.consensus?.trustedForIdentity !== true ||
    passB.consensus?.trustedForIdentity !== true
  ) {
    reasons.push("At least one AI council did not trust the exact card identity.");
  }
  if (
    passA.review?.trustedForPricing !== true ||
    passB.review?.trustedForPricing !== true
  ) {
    reasons.push("At least one InstaComp™ pass did not trust its pricing match.");
  }
  const confidenceFloor = highRisk ? 0.93 : 0.9;
  if (minimumConfidence < confidenceFloor) {
    reasons.push(
      `Minimum pass confidence was ${Math.round(minimumConfidence * 100)}%; this card requires ${Math.round(confidenceFloor * 100)}%.`,
    );
  }
  if (!comps.length) {
    reasons.push("No exact-card comp survived the InstaComp™ match filters.");
  }
  const spreadLimit = highRisk ? 15 : 20;
  if (priceSpreadPercent !== null && priceSpreadPercent > spreadLimit) {
    reasons.push(
      `The two pricing passes differ by ${priceSpreadPercent.toFixed(1)}%; limit is ${spreadLimit}% for this card.`,
    );
  }

  return {
    status: reasons.length ? "review" : "verified",
    highRisk,
    reasons,
    disagreements,
    aiJudgmentsCompleted,
    aiJudgmentsTarget: AI_JUDGMENT_TARGET,
    completedProviderLabels: Array.from(
      new Set([...completedA, ...completedB].map((attempt) => attempt.label)),
    ),
    unavailableProviderLabels: Array.from(
      new Set(unavailable.map((attempt) => `${attempt.label}: ${attempt.status}`)),
    ),
    exactCompCount: comps.length,
    compSources,
    catalogConfirmed,
    minimumConfidence,
    priceSpreadPercent,
    combinedSuggestedPrice,
  };
}

function stripExactSerial(value: string | null | undefined) {
  return String(value || "")
    .replace(/(?:#\s*)?\d+\s*(?:\/|\bof\b)\s*\d+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueTitleParts(values: Array<string | null | undefined>) {
  const seen = new Set<string>();
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function listingTitle(scan: AccuracyScanResponse, fallbackName: string) {
  const ai = scan.ai;
  const serial = normalizeInstaCompListingSerial(ai.serialNumber);
  const parallel = stripExactSerial(ai.parallel);
  const parts = uniqueTitleParts([
    ai.year,
    ai.brand,
    ai.setName,
    ai.player,
    ai.isRookie ? "Rookie Card" : null,
    parallel && !/^base$/i.test(parallel) ? parallel : null,
    ai.isAuto ? "Autograph" : null,
    ai.isRelic ? "Relic" : null,
    ai.gradingCompany && ai.gradeValue
      ? `${ai.gradingCompany} ${ai.gradeValue}`
      : ai.gradingCompany,
    ai.cardNumber ? `#${String(ai.cardNumber).replace(/^#/, "")}` : null,
    serial,
  ]);

  return parts.join(" ") || cleanFileBase(fallbackName) || "Unidentified Sports Card";
}

function scanQualityScore(scan: AccuracyScanResponse) {
  return (
    Number(scan.ai.confidence || 0) * 10 +
    (scan.consensus?.trustedForIdentity ? 4 : 0) +
    (scan.review?.trustedForPricing ? 3 : 0) +
    (scan.catalogEvidence?.catalogConfirmed ? 2 : 0) +
    uniqueComps([scan]).length
  );
}

function preferredPass(a: AccuracyScanResponse, b: AccuracyScanResponse) {
  return scanQualityScore(b) > scanQualityScore(a) ? b : a;
}

function priceWithMultiplier(value: number | null, multiplier: number) {
  if (!value) return "";
  return (Math.round(value * multiplier * 100) / 100).toFixed(2);
}

async function runAccuracyPass(row: AccuracyRow, passLabel: string) {
  const formData = new FormData();
  formData.append("frontImage", row.front);
  if (row.back) formData.append("backImage", row.back);
  formData.append("aiCouncilTier", "courtroom");
  formData.append("accuracyPassLabel", passLabel);

  const response = await fetch("/api/instacomp/scan", {
    method: "POST",
    body: formData,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || data?.message || `${passLabel} failed.`);
  }

  return data as AccuracyScanResponse;
}

export default function TruelyAccuracyWorkbench() {
  const [rows, setRows] = useState<AccuracyRow[]>([]);
  const [running, setRunning] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const draftingRef = useRef(false);
  const previewUrlsRef = useRef<Set<string>>(new Set());

  const counts = useMemo(() => {
    const graded = rows.filter((row) => row.benchmarkVerdict !== "ungraded");
    const correct = graded.filter((row) => row.benchmarkVerdict === "correct").length;
    const accuracy = graded.length ? (correct / graded.length) * 100 : null;

    return {
      total: rows.length,
      queued: rows.filter((row) => row.status === "queued").length,
      scanning: rows.filter((row) => row.status === "scanning").length,
      verified: rows.filter((row) => row.verification?.status === "verified").length,
      review: rows.filter((row) => row.verification?.status === "review").length,
      created: rows.filter((row) => row.status === "created").length,
      errors: rows.filter((row) => row.status === "error").length,
      graded: graded.length,
      correct,
      wrong: graded.length - correct,
      accuracy,
    };
  }, [rows]);

  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    if (running || drafting || !rows.some((row) => row.status === "queued")) {
      return;
    }

    const timer = window.setTimeout(() => void scanRows(), 150);
    return () => window.clearTimeout(timer);
  }, [drafting, rows, running]);

  function updateRow(
    rowId: string,
    updater: (row: AccuracyRow) => AccuracyRow,
  ) {
    setRows((current) =>
      current.map((row) => (row.id === rowId ? updater(row) : row)),
    );
  }

  function addFiles(fileList: FileList | File[]) {
    const imageFiles = Array.from(fileList).filter((file) =>
      ["image/jpeg", "image/png", "image/webp"].includes(file.type.toLowerCase()),
    );

    if (!imageFiles.length) {
      setGlobalError("Drop JPEG, PNG, or WebP card images only.");
      return;
    }

    const { pairs, skippedBackOnly, pairedByOrder } = pairImages(imageFiles);
    const accepted = pairs.slice(0, Math.max(0, MAX_ROWS - rows.length));

    if (!accepted.length) {
      setGlobalError(`Accuracy mode holds up to ${MAX_ROWS} cards at once.`);
      return;
    }

    const now = Date.now();
    const nextRows = accepted.map<AccuracyRow>((pair, index) => {
      const frontPreview = URL.createObjectURL(pair.front);
      const backPreview = pair.back ? URL.createObjectURL(pair.back) : null;
      previewUrlsRef.current.add(frontPreview);
      if (backPreview) previewUrlsRef.current.add(backPreview);

      return {
        id: `${now}-${index}-${pair.front.name}-${pair.front.size}`,
        front: pair.front,
        back: pair.back,
        frontPreview,
        backPreview,
        pairingMethod: pair.pairingMethod,
        status: "queued",
        passA: null,
        passB: null,
        verification: null,
        title: "",
        rawSerial: null,
        listingSerial: null,
        price: "",
        quantity: "1",
        manualOverride: false,
        benchmarkVerdict: "ungraded",
        error: null,
        elapsedMs: null,
        legacyProductId: null,
        editUrl: null,
      };
    });

    setRows((current) => [...current, ...nextRows]);
    setGlobalError(null);
    setNotice(
      [
        `Added ${nextRows.length} card${nextRows.length === 1 ? "" : "s"}.`,
        "Two independent courtroom councils will start automatically.",
        pairedByOrder
          ? `Paired ${pairedByOrder} by upload order; use front then back.`
          : null,
        skippedBackOnly
          ? `Skipped ${skippedBackOnly} back-only image${skippedBackOnly === 1 ? "" : "s"}.`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  async function scanOneRow(row: AccuracyRow) {
    const startedAt = performance.now();
    updateRow(row.id, (current) => ({
      ...current,
      status: "scanning",
      error: null,
      elapsedMs: null,
      passA: null,
      passB: null,
      verification: null,
      manualOverride: false,
      benchmarkVerdict: "ungraded",
    }));

    try {
      const [passA, passB] = await Promise.all([
        runAccuracyPass(row, "Independent council A"),
        runAccuracyPass(row, "Independent council B"),
      ]);
      const verification = verificationSummary(passA, passB, Boolean(row.back));
      const preferred = preferredPass(passA, passB);
      const rawSerial =
        normalizedSerial(passA.ai.serialNumber) === normalizedSerial(passB.ai.serialNumber)
          ? passA.ai.serialNumber || passB.ai.serialNumber || null
          : null;
      const listingSerial = normalizeInstaCompListingSerial(rawSerial);
      const suggested = verification.combinedSuggestedPrice;

      updateRow(row.id, (current) => ({
        ...current,
        status: "ready",
        passA,
        passB,
        verification,
        title: listingTitle(preferred, row.front.name),
        rawSerial,
        listingSerial,
        price:
          suggested && verification.exactCompCount > 0
            ? suggested.toFixed(2)
            : current.price,
        error: null,
        elapsedMs: Math.round(performance.now() - startedAt),
      }));
    } catch (error: any) {
      updateRow(row.id, (current) => ({
        ...current,
        status: "error",
        error: error?.message || "Truely Accuracy Council failed.",
        elapsedMs: Math.round(performance.now() - startedAt),
      }));
    }
  }

  async function scanRows(rowIds?: Set<string>) {
    if (runningRef.current || draftingRef.current) return;

    const targets = rows.filter(
      (row) =>
        (row.status === "queued" || row.status === "error") &&
        (!rowIds || rowIds.has(row.id)),
    );

    if (!targets.length) {
      setGlobalError("No queued or failed rows are waiting for accuracy scanning.");
      return;
    }

    runningRef.current = true;
    setRunning(true);
    setGlobalError(null);
    setNotice(
      `Running two independent AI councils on ${targets.length} card${targets.length === 1 ? "" : "s"} with ${Math.min(
        ROW_CONCURRENCY,
        targets.length,
      )} card workers (${Math.min(ROW_CONCURRENCY, targets.length) * 2} simultaneous council requests).`,
    );
    let cursor = 0;

    async function worker() {
      while (cursor < targets.length) {
        const row = targets[cursor];
        cursor += 1;
        await scanOneRow(row);
      }
    }

    try {
      await Promise.all(
        Array.from(
          { length: Math.min(ROW_CONCURRENCY, targets.length) },
          () => worker(),
        ),
      );
      setNotice(
        "Accuracy councils finished. Green rows passed the evidence gates; amber rows show exactly what needs human review.",
      );
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  async function createDraft(row: AccuracyRow) {
    if (!row.passA || !row.passB || !row.verification || row.status !== "ready") {
      return;
    }

    const price = Number(row.price);
    const allowed =
      row.verification.status === "verified" || row.manualOverride;

    if (!allowed) {
      updateRow(row.id, (current) => ({
        ...current,
        error: "This row needs review. Check Approve reviewed row before creating its draft.",
      }));
      return;
    }

    if (!Number.isFinite(price) || price <= 0) {
      updateRow(row.id, (current) => ({
        ...current,
        error: "Enter a price greater than zero before creating the draft.",
      }));
      return;
    }

    const preferred = preferredPass(row.passA, row.passB);
    updateRow(row.id, (current) => ({
      ...current,
      status: "drafting",
      error: null,
    }));

    try {
      const compactPass = (scan: AccuracyScanResponse) => ({
        scanId: scan.scanId,
        ai: scan.ai,
        stats: scan.stats,
        soldStats: scan.soldStats,
        review: scan.review || null,
        consensus: scan.consensus || null,
        catalogEvidence: scan.catalogEvidence || null,
        council: scan.ocrDiagnostics?.aiCouncil || null,
        sourceCoverage: scan.sourceCoverage || [],
        compEvidence: uniqueComps([scan]).slice(0, 12).map((comp) => ({
          title: comp.title,
          price: comp.price,
          source: comp.sourceLabel || comp.source,
          category: comp.sourceCategory,
          matchScore: comp.matchScore,
          flags: comp.flags,
          url: comp.url,
        })),
      });
      const formData = new FormData();
      formData.append("frontImage", row.front);
      if (row.back) formData.append("backImage", row.back);
      formData.append("title", row.title.trim());
      formData.append("player", preferred.ai.player || "");
      formData.append("sport", preferred.ai.sport || "Sports Cards");
      formData.append(
        "condition",
        preferred.ai.conditionGuess || "Near Mint or Better",
      );
      formData.append("serialNumber", row.listingSerial || "");
      formData.append("price", price.toFixed(2));
      formData.append("quantity", row.quantity || "1");
      formData.append("scanId", preferred.scanId || "");
      formData.append(
        "scanMetadata",
        JSON.stringify({
          schema: "truely.accuracyCouncil.v1",
          scope: "truely_collectables_only",
          benchmarkTarget: {
            cards: TARGET_BENCHMARK_CARDS,
            accuracyPercent: TARGET_ACCURACY_PERCENT,
          },
          verification: row.verification,
          manualOverride: row.manualOverride,
          pairingMethod: row.pairingMethod,
          elapsedMs: row.elapsedMs,
          rawSerialNumber: row.rawSerial,
          normalizedListingSerial: row.listingSerial,
          passA: compactPass(row.passA),
          passB: compactPass(row.passB),
        }),
      );

      const response = await fetch("/api/admin/quick-list", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Accuracy mode could not create this draft.");
      }

      updateRow(row.id, (current) => ({
        ...current,
        status: "created",
        error: null,
        legacyProductId: Number(data.draft.legacyProductId),
        editUrl: String(data.draft.editUrl || ""),
      }));
    } catch (error: any) {
      updateRow(row.id, (current) => ({
        ...current,
        status: "ready",
        error: error?.message || "Accuracy draft creation failed.",
      }));
    }
  }

  async function createApprovedDrafts() {
    if (runningRef.current || draftingRef.current) return;

    const targets = rows.filter(
      (row) =>
        row.status === "ready" &&
        row.passA &&
        row.passB &&
        row.verification &&
        (row.verification.status === "verified" || row.manualOverride) &&
        Number(row.price) > 0,
    );

    if (!targets.length) {
      setGlobalError("No verified or manually approved priced rows are ready to draft.");
      return;
    }

    draftingRef.current = true;
    setDrafting(true);
    setGlobalError(null);
    let cursor = 0;

    async function worker() {
      while (cursor < targets.length) {
        const row = targets[cursor];
        cursor += 1;
        await createDraft(row);
      }
    }

    try {
      await Promise.all(
        Array.from(
          { length: Math.min(DRAFT_CONCURRENCY, targets.length) },
          () => worker(),
        ),
      );
      setNotice("Approved Truely Collectables inventory drafts were created.");
    } finally {
      draftingRef.current = false;
      setDrafting(false);
    }
  }

  function removeRow(rowId: string) {
    setRows((current) =>
      current.filter((row) => {
        if (row.id !== rowId) return true;
        URL.revokeObjectURL(row.frontPreview);
        previewUrlsRef.current.delete(row.frontPreview);
        if (row.backPreview) {
          URL.revokeObjectURL(row.backPreview);
          previewUrlsRef.current.delete(row.backPreview);
        }
        return false;
      }),
    );
  }

  function clearAll() {
    rows.forEach((row) => {
      URL.revokeObjectURL(row.frontPreview);
      if (row.backPreview) URL.revokeObjectURL(row.backPreview);
    });
    previewUrlsRef.current.clear();
    setRows([]);
    setNotice(null);
    setGlobalError(null);
  }

  function dropFiles(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(event.dataTransfer.files);
  }

  const benchmarkComplete = counts.graded >= TARGET_BENCHMARK_CARDS;
  const benchmarkPassed =
    benchmarkComplete &&
    counts.accuracy !== null &&
    counts.accuracy >= TARGET_ACCURACY_PERCENT;

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric label="Cards" value={String(counts.total)} />
        <Metric label="Scanning" value={String(counts.queued + counts.scanning)} />
        <Metric label="Accuracy verified" value={String(counts.verified)} tone="green" />
        <Metric label="Needs review" value={String(counts.review)} tone="amber" />
        <Metric label="Drafted" value={String(counts.created)} />
        <Metric
          label={`Benchmark ${counts.graded}/${TARGET_BENCHMARK_CARDS}`}
          value={counts.accuracy === null ? "—" : `${counts.accuracy.toFixed(1)}%`}
          tone={benchmarkPassed ? "green" : benchmarkComplete ? "rose" : "neutral"}
        />
      </section>

      <section className="rounded-3xl border border-violet-200 bg-violet-50 p-5 text-sm font-bold leading-6 text-violet-950">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-700">
          Truely Collectables accuracy mode
        </p>
        <p className="mt-2">
          Each card runs through two independent courtroom councils. Maximum evidence is ten AI judgments: two primary OpenAI reads plus skeptical OpenAI, Gemini, Groq, and optional local Ollama witnesses on each pass. The screen reports the actual count—never a fake ten. OCR, checklist evidence, and exact-comp filters are additional referees, not counted as AI votes.
        </p>
        <p className="mt-2">
          The 98% figure is a benchmark target, not a claim. Mark every test row Correct or Wrong; the score becomes meaningful after 100 graded cards. Autograph detection identifies an autograph card or visible signature—it does not authenticate who physically signed it.
        </p>
      </section>

      <section className="rounded-3xl border border-neutral-300 bg-white p-5 shadow-sm">
        <div
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={dropFiles}
          className={`rounded-3xl border-2 border-dashed px-6 py-12 text-center transition ${
            dragging
              ? "border-violet-600 bg-violet-50"
              : "border-neutral-300 bg-neutral-50"
          }`}
        >
          <p className="text-2xl font-black">Drop front and back card photos</p>
          <p className="mx-auto mt-2 max-w-3xl text-sm font-semibold leading-6 text-neutral-600">
            Best pairing: card-001-front.jpg and card-001-back.jpg. Unnamed files pair in upload order: front, back, front, back. Both sides are required for a green accuracy approval.
          </p>
          <label className="mt-5 inline-flex cursor-pointer rounded-xl bg-neutral-950 px-6 py-3 text-sm font-black text-white hover:bg-neutral-800">
            Choose card images
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                if (event.target.files) addFiles(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void scanRows()}
            disabled={running || drafting || !rows.length}
            className="rounded-xl bg-violet-700 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "Accuracy councils running..." : "Scan queued / retry failed"}
          </button>
          <button
            type="button"
            onClick={() => void createApprovedDrafts()}
            disabled={running || drafting || !rows.length}
            className="rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {drafting ? "Creating drafts..." : "Create approved drafts"}
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={running || drafting || !rows.length}
            className="rounded-xl border border-neutral-300 px-5 py-3 text-sm font-black disabled:cursor-not-allowed disabled:opacity-50"
          >
            Clear batch
          </button>
        </div>

        {notice ? (
          <p className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-950">
            {notice}
          </p>
        ) : null}
        {globalError ? (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-950">
            {globalError}
          </p>
        ) : null}
      </section>

      {rows.length ? (
        <section className="space-y-4">
          {rows.map((row, index) => {
            const preferred =
              row.passA && row.passB ? preferredPass(row.passA, row.passB) : null;
            const suggested = row.verification?.combinedSuggestedPrice || null;
            const verified = row.verification?.status === "verified";
            const canDraft =
              row.status === "ready" &&
              Boolean(row.passA && row.passB) &&
              (verified || row.manualOverride) &&
              Number(row.price) > 0;

            return (
              <article
                key={row.id}
                className={`rounded-3xl border bg-white p-5 shadow-sm ${
                  verified
                    ? "border-emerald-300"
                    : row.verification
                      ? "border-amber-300"
                      : "border-neutral-200"
                }`}
              >
                <div className="grid gap-5 xl:grid-cols-[150px_minmax(0,1fr)_300px]">
                  <div>
                    <div className="grid grid-cols-2 gap-2">
                      <ImagePreview src={row.frontPreview} label="Front" />
                      {row.backPreview ? (
                        <ImagePreview src={row.backPreview} label="Back" />
                      ) : (
                        <div className="flex aspect-[5/7] items-center justify-center rounded-xl border border-dashed border-amber-300 bg-amber-50 p-2 text-center text-xs font-black text-amber-900">
                          Back required
                        </div>
                      )}
                    </div>
                    <p className="mt-2 text-center text-xs font-bold text-neutral-500">
                      Row {index + 1} · {row.pairingMethod.replaceAll("_", " ")}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={row.status} />
                      {row.verification ? (
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${
                            verified
                              ? "bg-emerald-100 text-emerald-900"
                              : "bg-amber-100 text-amber-950"
                          }`}
                        >
                          {verified ? "Accuracy verified" : "Review required"}
                        </span>
                      ) : null}
                      {row.verification?.highRisk ? (
                        <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-violet-900">
                          High-risk identity
                        </span>
                      ) : null}
                    </div>

                    <input
                      value={row.title}
                      onChange={(event) =>
                        updateRow(row.id, (current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                      disabled={!row.passA || row.status === "created"}
                      placeholder="AI title appears after both councils finish"
                      className="mt-3 w-full rounded-xl border border-neutral-300 px-4 py-3 text-base font-black disabled:bg-neutral-100"
                    />

                    {preferred ? (
                      <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold text-neutral-700">
                        <Chip>{preferred.ai.player || "Player unknown"}</Chip>
                        <Chip>{preferred.ai.year || "Year unknown"}</Chip>
                        <Chip>{preferred.ai.setName || "Set unknown"}</Chip>
                        <Chip>#{preferred.ai.cardNumber || "?"}</Chip>
                        <Chip>{preferred.ai.parallel || "Parallel unknown"}</Chip>
                        {row.listingSerial ? <Chip>{row.listingSerial}</Chip> : null}
                        {preferred.ai.isAuto ? <Chip>Autograph</Chip> : null}
                        {preferred.ai.isRelic ? <Chip>Relic</Chip> : null}
                      </div>
                    ) : null}

                    {row.verification ? (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                        <EvidenceBox
                          label="AI judgments"
                          value={`${row.verification.aiJudgmentsCompleted}/${row.verification.aiJudgmentsTarget}`}
                        />
                        <EvidenceBox
                          label="Minimum confidence"
                          value={`${Math.round(row.verification.minimumConfidence * 100)}%`}
                        />
                        <EvidenceBox
                          label="Exact comps"
                          value={String(row.verification.exactCompCount)}
                        />
                        <EvidenceBox
                          label="Price agreement"
                          value={
                            row.verification.priceSpreadPercent === null
                              ? "One price set"
                              : `${row.verification.priceSpreadPercent.toFixed(1)}% spread`
                          }
                        />
                      </div>
                    ) : null}

                    {row.verification?.completedProviderLabels.length ? (
                      <p className="mt-3 text-xs font-semibold leading-5 text-neutral-600">
                        <strong>AI witnesses:</strong>{" "}
                        {row.verification.completedProviderLabels.join(", ")}
                      </p>
                    ) : null}
                    {row.verification?.compSources.length ? (
                      <p className="mt-1 text-xs font-semibold leading-5 text-neutral-600">
                        <strong>Comp evidence:</strong>{" "}
                        {row.verification.compSources.join(", ")}
                      </p>
                    ) : null}
                    {row.verification?.catalogConfirmed ? (
                      <p className="mt-1 text-xs font-black text-emerald-800">
                        Checklist/catalog referee confirmed at least one pass.
                      </p>
                    ) : null}

                    {row.verification?.reasons.length ? (
                      <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
                        <p className="font-black">Why this row needs review</p>
                        <ul className="mt-2 list-disc space-y-1 pl-5">
                          {row.verification.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                        {row.verification.unavailableProviderLabels.length ? (
                          <p className="mt-3 text-xs">
                            Unavailable witnesses: {row.verification.unavailableProviderLabels.join(", ")}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {row.error ? (
                      <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-950">
                        {row.error}
                      </p>
                    ) : null}

                    {row.status === "created" && row.editUrl ? (
                      <a
                        href={row.editUrl}
                        className="mt-3 inline-flex rounded-xl bg-neutral-950 px-4 py-2 text-sm font-black text-white"
                      >
                        Open inventory draft
                      </a>
                    ) : null}
                  </div>

                  <div className="space-y-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                    <div>
                      <label className="text-xs font-black uppercase tracking-wide text-neutral-600">
                        Price
                      </label>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={row.price}
                        onChange={(event) =>
                          updateRow(row.id, (current) => ({
                            ...current,
                            price: event.target.value,
                          }))
                        }
                        disabled={!row.passA || row.status === "created"}
                        className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-xl font-black"
                      />
                      <p className="mt-1 text-xs font-bold text-neutral-500">
                        Council suggestion: {money(suggested)}
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {[
                          ["Comp", 1],
                          ["+5%", 1.05],
                          ["+10%", 1.1],
                          ["-5%", 0.95],
                        ].map(([label, multiplier]) => (
                          <button
                            key={String(label)}
                            type="button"
                            disabled={!suggested || row.status === "created"}
                            onClick={() =>
                              updateRow(row.id, (current) => ({
                                ...current,
                                price: priceWithMultiplier(
                                  suggested,
                                  Number(multiplier),
                                ),
                              }))
                            }
                            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-black disabled:opacity-40"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <label className="block text-xs font-black uppercase tracking-wide text-neutral-600">
                      Quantity
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={row.quantity}
                        onChange={(event) =>
                          updateRow(row.id, (current) => ({
                            ...current,
                            quantity: event.target.value,
                          }))
                        }
                        disabled={row.status === "created"}
                        className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-base font-black"
                      />
                    </label>

                    {row.verification?.status === "review" ? (
                      <label className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-950">
                        <input
                          type="checkbox"
                          checked={row.manualOverride}
                          onChange={(event) =>
                            updateRow(row.id, (current) => ({
                              ...current,
                              manualOverride: event.target.checked,
                            }))
                          }
                        />
                        I reviewed the images, identity, serial, parallel, and comp evidence. Approve this row anyway.
                      </label>
                    ) : null}

                    <button
                      type="button"
                      disabled={!canDraft || drafting}
                      onClick={() => void createDraft(row)}
                      className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {row.status === "drafting"
                        ? "Creating draft..."
                        : row.status === "created"
                          ? "Draft created"
                          : "Create inventory draft"}
                    </button>

                    <div className="border-t border-neutral-200 pt-4">
                      <p className="text-xs font-black uppercase tracking-wide text-neutral-600">
                        100-card accuracy test
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            updateRow(row.id, (current) => ({
                              ...current,
                              benchmarkVerdict: "correct",
                            }))
                          }
                          className={`rounded-lg px-3 py-2 text-xs font-black ${
                            row.benchmarkVerdict === "correct"
                              ? "bg-emerald-700 text-white"
                              : "border border-emerald-300 bg-white text-emerald-800"
                          }`}
                        >
                          Correct
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateRow(row.id, (current) => ({
                              ...current,
                              benchmarkVerdict: "wrong",
                            }))
                          }
                          className={`rounded-lg px-3 py-2 text-xs font-black ${
                            row.benchmarkVerdict === "wrong"
                              ? "bg-rose-700 text-white"
                              : "border border-rose-300 bg-white text-rose-800"
                          }`}
                        >
                          Wrong
                        </button>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={running || drafting || row.status === "created"}
                        onClick={() => void scanRows(new Set([row.id]))}
                        className="flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-black disabled:opacity-40"
                      >
                        Run again
                      </button>
                      <button
                        type="button"
                        disabled={running || drafting}
                        onClick={() => removeRow(row.id)}
                        className="flex-1 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-black text-rose-800 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>

                    {row.elapsedMs !== null ? (
                      <p className="text-center text-xs font-bold text-neutral-500">
                        Two-pass time: {(row.elapsedMs / 1000).toFixed(1)} seconds
                      </p>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      <section
        className={`rounded-3xl border p-5 text-sm font-bold ${
          benchmarkPassed
            ? "border-emerald-300 bg-emerald-50 text-emerald-950"
            : benchmarkComplete
              ? "border-rose-300 bg-rose-50 text-rose-950"
              : "border-neutral-200 bg-white text-neutral-700"
        }`}
      >
        <p className="text-xs font-black uppercase tracking-[0.16em]">
          Accuracy benchmark
        </p>
        <p className="mt-2 text-lg font-black">
          {counts.graded}/{TARGET_BENCHMARK_CARDS} graded · {counts.correct} correct · {counts.wrong} wrong · {counts.accuracy === null ? "No score yet" : `${counts.accuracy.toFixed(2)}% accuracy`}
        </p>
        <p className="mt-1">
          {benchmarkPassed
            ? "The first 100-card benchmark met the 98% target. Repeat with a harder mixed lot before advertising the number."
            : benchmarkComplete
              ? "The benchmark did not reach 98%. Wrong rows should become new regression tests before increasing speed."
              : "Grade every scanned card against the physical card and checklist. Autos, serials, refractors, prizms, relics, inserts, and graded cards must be represented in the 100-card lot."}
        </p>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "green" | "amber" | "rose";
}) {
  const tones = {
    neutral: "border-neutral-200 bg-white",
    green: "border-emerald-200 bg-emerald-50",
    amber: "border-amber-200 bg-amber-50",
    rose: "border-rose-200 bg-rose-50",
  };

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${tones[tone]}`}>
      <p className="text-xs font-black uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}

function ImagePreview({ src, label }: { src: string; label: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-neutral-200 bg-neutral-100">
      {/* Quick List uses local object URLs, so next/image is intentionally not used. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={label} className="aspect-[5/7] h-full w-full object-contain" />
      <span className="absolute bottom-1 left-1 rounded bg-black/75 px-2 py-1 text-[10px] font-black uppercase text-white">
        {label}
      </span>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1">
      {children}
    </span>
  );
}

function EvidenceBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
      <p className="text-[10px] font-black uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-black">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: RowStatus }) {
  const labels: Record<RowStatus, string> = {
    queued: "Queued",
    scanning: "Two councils scanning",
    ready: "Review ready",
    drafting: "Creating draft",
    created: "Draft created",
    error: "Scan failed",
  };
  const tones: Record<RowStatus, string> = {
    queued: "bg-neutral-100 text-neutral-800",
    scanning: "bg-blue-100 text-blue-900",
    ready: "bg-violet-100 text-violet-900",
    drafting: "bg-blue-100 text-blue-900",
    created: "bg-emerald-100 text-emerald-900",
    error: "bg-rose-100 text-rose-900",
  };

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${tones[status]}`}>
      {labels[status]}
    </span>
  );
}
