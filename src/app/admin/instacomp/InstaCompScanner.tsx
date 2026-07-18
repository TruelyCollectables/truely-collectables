"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getFreshAccountSession } from "@/src/app/account/account-session";
import { buildInstaCompDraftTitle } from "@/src/lib/instacomp-draft-title";
import { gradingLookupUrl } from "@/src/lib/grading-cert";
import {
  instaCompBatchRowActionLabel,
  type InstaCompBatchRowAction,
} from "@/src/lib/instacomp-row-actions";
import {
  instaCompBatchRowRemovalBlockedReason,
  instaCompBatchRowRemovalLabel,
} from "@/src/lib/instacomp-row-removal";
import { planInstaCompSelectedQuantityMerge } from "@/src/lib/instacomp-row-merge";

type AiResult = {
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
  certificationLookupUrl?: string | null;
  gradingEvidence?: string | null;
  team: string | null;
  sport: string | null;
  isRookie: boolean;
  isAuto: boolean;
  isRelic: boolean;
  conditionGuess: string | null;
  confidence: number;
  notes: string | null;
};

type ActiveComp = {
  title: string;
  price: number;
  currency: string;
  url: string;
  imageUrl: string | null;
  source: string;
  sourceLabel: string;
  sourceCategory: "sold" | "marketplace" | "auction" | "pricing" | "reference" | "broad";
  matchScore: number;
  flags: string[];
  soldAt?: string | null;
  listedAt?: string | null;
  observedAt?: string | null;
};

type SourceCoverageItem = {
  label: string;
  status: "included" | "registered" | "not_configured" | "no_matches" | "error";
  category: "sold" | "marketplace" | "auction" | "pricing" | "reference" | "broad";
  includedInMarketValue: boolean;
  resultCount: number;
  message: string | null;
};

type ExternalSearchDiagnostics = {
  provider: "serpapi" | "google_cse" | null;
  providerLabel: string | null;
  cacheStatus: "hit" | "miss" | "disabled" | "not_configured" | "error";
  cacheHit: boolean;
  externalRequestAttempted: boolean;
  paidSearchUsed: boolean;
  requestedLimit: number;
  returnedSearchItems: number;
  includedCompCount: number;
  registeredSourceCount: number;
  cacheTtlDays: number;
  cacheExpiresAt: string | null;
  cacheHitCountBeforeScan: number | null;
};

type ProviderResult = {
  source: string;
  label: string;
  status: "live" | "not_configured" | "error" | "no_matches";
  message: string | null;
  results: ActiveComp[];
  searchUrl?: string;
  diagnostics?: {
    externalSearch?: ExternalSearchDiagnostics;
  };
};

type ConsensusResult = {
  schema: "tcos.instacomp.multiScannerConsensus.v1";
  status: "consensus_confirmed" | "review_required";
  trustedForIdentity: boolean;
  councilReadiness?: {
    status: "ready" | "warning" | "review_required";
    speedLane: string;
    councilMode: string;
    independentReaderCount: number;
    presentReaderKinds: string[];
    requiredReaderKinds: string[];
    missingReaderKinds: string[];
    reasons: string[];
    explanation: string;
  };
  reviewReasons: string[];
  reasonTrail: string[];
  suggestedQuestion: string | null;
  readerSummaries: Array<{
    readerId: string;
    label: string;
    kind: string;
    confidence: number | null;
    knownFieldCount: number;
    evidence: string[];
  }>;
  fieldDecisions: Array<{
    field: string;
    status:
      | "agreed"
      | "single_reader"
      | "specific_variant_over_base"
      | "positive_marker_over_negative_default"
      | "weighted_reader_choice"
      | "catalog_referee"
      | "review_required";
    value: string | boolean | null;
    sources: string[];
    conflictingValues: string[];
    reason: string;
  }>;
  catalogReferee: {
    status: "catalog_confirmed" | "review_required" | "not_available";
    sourceLabel: string | null;
    catalogId: string | null;
    matchExplanation: string | null;
  };
};

type CatalogEvidenceResult = {
  schema: "tcos.instacomp.catalogEvidence.v1";
  status: "catalog_confirmed" | "review_required";
  operatorState: "ready_for_exact_comps" | "needs_operator_review";
  catalogConfirmed: boolean;
  selectedMatch: {
    catalogId: string;
    sourceLabel: string;
    score: number;
    matchedEvidence: string[];
    mismatchedEvidence: string[];
    identity: {
      player?: string | null;
      year?: string | null;
      setName?: string | null;
      cardNumber?: string | null;
      parallel?: string | null;
      variation?: string | null;
    };
  } | null;
  reviewReasons: string[];
  suggestedQuestion: string | null;
  operatorAction: string;
  safeUseBoundary: string;
  sourceAttribution: {
    sourceLabel: string;
    catalogId: string;
  } | null;
  actionPermissions: {
    exactCompSearchAllowed: boolean;
    trustedForExactComps: boolean;
    publicListingClaimAllowed: boolean;
    autoPriceAllowed: boolean;
    tradeValueRecommendationAllowed: boolean;
  };
};

type ScanResponse = {
  ok: boolean;
  scanId: string | null;
  ai: AiResult;
  ocrDiagnostics?: {
    paddleOcrConfigured: boolean;
    googleVisionConfigured: boolean;
    provider: string | null;
    checkedImages: number;
    speedLane?: "fast_lane" | "escalated_multi_ai" | null;
    councilMode?: "fast_lane_council" | "full_council" | null;
    consensusRiskTier?: "low" | "medium" | "high" | null;
    scannerPlan?: string[];
    secondaryVisionRan?: boolean | null;
    secondaryVisionReasons?: string[];
    aiCouncil?: {
      tier: string;
      desiredReaders: number;
      completedReaders: number;
      attempts: {
        provider: string;
        label: string;
        model: string;
        status: "completed" | "not_configured" | "error" | "skipped";
        durationMs: number | null;
        message: string | null;
      }[];
    };
    extractedSerialNumber: string | null;
    serialVisionMode?: "adaptive" | "always" | "off" | string | null;
    serialVisionSkipped?: boolean | null;
    serialVisionCheckedImages?: number | null;
    serialVisionSerialNumber?: string | null;
    serialVisionEvidence?: string | null;
    gradingCompany?: string | null;
    gradeValue?: string | null;
    certificationNumber?: string | null;
    certificationLookupUrl?: string | null;
    gradingEvidence?: string | null;
    textExcerpt: string | null;
  };
  searchQuery: string;
  backupQueries: string[];
  links: {
    ebaySoldUrl: string;
    ebayActiveUrl: string;
    one30pointUrl: string;
    comcUrl: string;
    myslabsUrl: string;
    pwccUrl: string;
    goldinUrl: string;
    fanaticsUrl: string;
    sportlotsUrl: string;
    mercariUrl: string;
    facebookMarketplaceUrl: string;
    googleShoppingUrl: string;
    broadCardMarketUrl: string;
  };
  providers: ProviderResult[];
  sourceCoverage: SourceCoverageItem[];
  activeComps: ActiveComp[];
  marketValueComps: ActiveComp[];
  soldComps: ActiveComp[];
  remainingCards: ActiveComp[];
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
  note: string;
  consensus?: ConsensusResult;
  catalogEvidence?: CatalogEvidenceResult | null;
  review?: {
    status: "trusted_for_pricing" | "review_required";
    trustedForPricing: boolean;
    reviewReasons: string[];
    identityReviewReasons: string[];
    pricingReviewReasons: string[];
  };
  queue?: {
    jobId: string;
    itemId: string;
    status: "completed" | "review_required";
    reviewReasons: string[];
  };
  operatorCorrections?: OperatorCorrectionSnapshot | null;
};

type OperatorCorrectionSnapshot = {
  savedAt: string;
  savedFrom: "admin_instacomp";
  customTitle: string;
  customSerialNumber: string;
  customQuantity: string;
  customPrice: string;
  operatorMarkedWrong: boolean;
  operatorNeedsMoreInfo: boolean;
  listingPrice: number | null;
  priceSource: "manual" | "instacomp_market" | "missing";
};

type BatchCardStatus = "queued" | "scanning" | "done" | "error";
type DraftListingStatus = "idle" | "drafting" | "created" | "error";
type TradeHandoffStatus = "idle" | "adding" | "created" | "error";
type ActiveBatchCardAction = {
  cardId: string;
  action: Exclude<InstaCompBatchRowAction, null>;
};
type AiCouncilTier =
  | "adaptive"
  | "basic"
  | "mid"
  | "pro"
  | "dealer"
  | "high_end"
  | "courtroom";
type BatchCardFilter =
  | "all"
  | "selected"
  | "problems"
  | "draftable"
  | "ready"
  | "ready_review"
  | "clean"
  | "clean_ready"
  | "clean_fix"
  | "review"
  | "review_fix"
  | "fix"
  | "errors"
  | "draft_errors"
  | "drafted"
  | "active";
type BatchCardSort =
  | "original"
  | "status"
  | "title"
  | "market_high"
  | "market_low"
  | "confidence_low"
  | "confidence_high";

type BatchCard = {
  id: string;
  file: File;
  backFile: File | null;
  originalFile?: File | null;
  originalBackFile?: File | null;
  frontRotationDegrees?: number;
  backRotationDegrees?: number;
  previewUrl: string;
  backPreviewUrl: string | null;
  status: BatchCardStatus;
  selected: boolean;
  operatorMarkedWrong?: boolean;
  operatorNeedsMoreInfo?: boolean;
  result: ScanResponse | null;
  marketPrice: number | null;
  customTitle: string;
  customSerialNumber: string;
  customQuantity: string;
  customPrice: string;
  error: string | null;
  draftStatus: DraftListingStatus;
  draftError: string | null;
  draftInventoryItemId: string | null;
  draftLegacyProductId: number | null;
  draftSku: string | null;
  draftDuplicateAlert?: DraftDuplicateAlert | null;
  tradeStatus: TradeHandoffStatus;
  tradeError: string | null;
  tradeCollectionItemId: string | null;
  persistentClientId?: string;
  persistentJobId?: string | null;
  persistentItemId?: string | null;
  knowledgeEntryId?: string | null;
  knowledgeSavedAt?: string | null;
  knowledgeTrustStatus?: "learning" | "tcos_trusted" | "needs_review" | string | null;
  knowledgeConfirmedCount?: number | null;
  frontStoragePath?: string | null;
  backStoragePath?: string | null;
  pairingConfidence?: number | null;
  pairingMethod?: "filename" | "upload_order" | "front_only";
  scanQueuedAt?: string | null;
  scanStartedAt?: string | null;
  scanCompletedAt?: string | null;
  scanElapsedMs?: number | null;
};

type PersistentJobBinding = {
  jobId: string;
  itemId: string;
  clientItemId: string;
  frontStoragePath: string;
  backStoragePath: string | null;
};

type PersistentJobSummary = {
  id: string;
  client_batch_id?: string;
  status: string;
  total_items: number;
  uploaded_items: number;
  processed_items: number;
  completed_items: number;
  review_required_items: number;
  failed_items: number;
  drafted_items: number;
};

type PersistentClaimedItem = {
  id: string;
  job_id: string;
  client_item_id: string;
  lease_token: string;
  leaseToken?: string;
};

type BatchCardViewItem = {
  card: BatchCard;
  index: number;
};

type DraftListingResponse = {
  success: boolean;
  createdCount: number;
  existingCount?: number;
  errorCount: number;
  createdItems: Array<{
    clientId: string | null;
    scanId: string | null;
    legacyProductId: number | null;
    inventoryItemId: string | null;
    title: string;
    sku: string | null;
    price: number;
    frontImageUrl?: string | null;
    backImageUrl?: string | null;
    alreadyExisted?: boolean;
    metadataWarning?: string;
    duplicateAlert?: DraftDuplicateAlert | null;
  }>;
  errors: Array<{
    clientId: string | null;
    scanId: string | null;
    title: string | null;
    error: string;
  }>;
};

type DraftDuplicateAlert = {
  message: string;
  matchedPrice: number | null;
  requestedPrice: number;
  priceMatched: boolean;
  mergeUrl: string;
  matches: Array<{
    legacyProductId: number;
    title: string;
    sku: string | null;
    price: number;
    quantity: number;
    ebayItemId: string | null;
  }>;
};

type TradeItemResponse = {
  success: boolean;
  alreadyExisted?: boolean;
  collectionItemId: string | null;
  title: string;
  error?: string;
};

type BatchImageSide = "front" | "back" | "unknown";

type BatchImageCandidate = {
  file: File;
  side: BatchImageSide;
  pairKey: string;
  originalIndex: number;
};

type BatchPair = {
  front: BatchImageCandidate;
  back: BatchImageCandidate | null;
  sortIndex: number;
  pairingConfidence: number | null;
  pairingMethod: "filename" | "upload_order" | "front_only";
};

type InstaCompScannerProps = {
  testMode?: boolean;
};

type TestScanFixture = {
  slug: string;
  label: string;
  backLabel?: string;
  color: string;
  ai: AiResult;
  marketPrice: number | null;
  noComps?: boolean;
  scanError?: string;
  customQuantity?: string;
  customPrice?: string;
  initialDraftStatus?: DraftListingStatus;
  initialDraftError?: string | null;
  draftInventoryItemId?: string | null;
  draftLegacyProductId?: number | null;
  draftSku?: string | null;
  selected?: boolean;
  draftCreateError?: string;
};

type TestModelCheck = {
  label: string;
  expected: string;
  actual: string;
  pass: boolean;
};

type TestModelCheckScenario = "completed_matrix" | "scan_cycle" | "draft_cycle";

type TestModelRunRecord = {
  id: string;
  ranAt: string;
  label: string;
  scenario: TestModelCheckScenario;
  passed: number;
  failed: number;
  total: number;
  rowCount: number;
  problemRows: number;
  scanFailures: number;
  draftFailures: number;
  reviewRows: number;
  fixRows: number;
};

const MAX_BATCH_CARDS = 500;
const MAX_SCAN_IMAGE_BYTES = 900_000;
const MAX_PERSISTENT_SOURCE_IMAGE_BYTES = 1_200_000;
const MAX_SCAN_IMAGE_DIMENSION = 2600;
const MAX_PERSISTENT_IMAGE_DIMENSION = 2600;
const MAX_DETAIL_CROP_BYTES = 180_000;
const MAX_SCAN_REQUEST_BYTES = 3_750_000;
const DRAFT_UPLOAD_CONCURRENCY = 2;
const INSTACOMP_JOB_ITEM_CHUNK_SIZE = 50;
const INSTACOMP_BATCH_DEFAULT_CONCURRENCY = 6;
const INSTACOMP_BATCH_MAX_CONCURRENCY = 10;
const INSTACOMP_JOB_UPLOAD_CONCURRENCY = 10;
const INSTACOMP_JOB_CLAIM_CHUNK_SIZE = 5;
const INSTACOMP_RATE_LIMIT_RETRY_SECONDS = 60;
const INSTACOMP_FINAL_TRIAL_TARGET_CARDS = 100;
const INSTACOMP_FINAL_TRIAL_TARGET_AVERAGE_SECONDS = 15;
const INSTACOMP_FINAL_TRIAL_TARGET_P95_SECONDS = 45;
const INSTACOMP_LAST_JOB_STORAGE_KEY = "tcos-instacomp-last-job-v1";
const ACTIVE_INSTACOMP_JOB_STATUSES = new Set([
  "uploading",
  "queued",
  "processing",
  "cancelling",
]);
const EMPTY_CARD_PREVIEW =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='560' viewBox='0 0 400 560'%3E%3Crect width='400' height='560' fill='%23e5e7eb'/%3E%3Ctext x='200' y='280' text-anchor='middle' fill='%236b7280' font-family='Arial' font-size='24'%3ERecovered card%3C/text%3E%3C/svg%3E";
const TEST_MODEL_LATENCY_MS = 120;
const TEST_MODEL_RUN_LEDGER_STORAGE_KEY = "instacomp-test-run-ledger-v1";
const PRICE_BUTTONS = [
  { label: "Comp", multiplier: 1 },
  { label: "+5%", multiplier: 1.05 },
  { label: "+10%", multiplier: 1.1 },
  { label: "+20%", multiplier: 1.2 },
  { label: "-5%", multiplier: 0.95 },
  { label: "-10%", multiplier: 0.9 },
];
const AI_COUNCIL_TIER_OPTIONS: Array<{
  value: AiCouncilTier;
  label: string;
  description: string;
}> = [
  {
    value: "adaptive",
    label: "Adaptive",
    description: "Extra AI only when risk/uncertainty says it is worth it.",
  },
  {
    value: "mid",
    label: "Mid: +1 AI",
    description: "Primary reader plus one extra AI witness.",
  },
  {
    value: "pro",
    label: "Pro: +2 AI",
    description: "Primary reader plus two extra AI witnesses.",
  },
  {
    value: "high_end",
    label: "High-End Fast: +3 AI",
    description: "Primary reader plus up to three fast cloud witnesses.",
  },
  {
    value: "courtroom",
    label: "Max: 5-AI + Local",
    description: "Primary reader plus cloud witnesses and local Ollama. Strongest but slowest.",
  },
  {
    value: "basic",
    label: "Basic",
    description: "Primary reader and checklist/OCR only.",
  },
];
const LOW_CONFIDENCE_THRESHOLD = 0.85;

async function fetchWithFreshAccountSession(
  input: RequestInfo | URL,
  init: RequestInit = {},
) {
  async function send(forceRefresh: boolean) {
    const session = await getFreshAccountSession(5 * 60, forceRefresh);
    const headers = new Headers(init.headers);

    if (session?.access_token) {
      headers.set("Authorization", `Bearer ${session.access_token}`);
    } else {
      headers.delete("Authorization");
    }

    return {
      response: await fetch(input, { ...init, headers }),
      canRefresh: Boolean(session?.refresh_token),
    };
  }

  let attempt = await send(false);

  if (attempt.response.status === 401 && attempt.canRefresh) {
    attempt = await send(true);
  }

  return attempt.response;
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    error instanceof Error && error.name === "AbortError"
  );
}

function throwIfAborted(signal: AbortSignal | null | undefined) {
  if (signal?.aborted) {
    throw new DOMException("InstaComp™ row scan was ended by the operator.", "AbortError");
  }
}

const BATCH_FILTER_LABELS: Record<BatchCardFilter, string> = {
  all: "All",
  selected: "Selected",
  problems: "Problems",
  draftable: "Draftable",
  ready: "Ready",
  ready_review: "Ready Needs Review",
  clean: "Clean",
  clean_ready: "Clean Ready",
  clean_fix: "Clean Needs Fix",
  review: "Needs Review",
  review_fix: "Review Needs Fix",
  fix: "Needs Fix",
  errors: "Errors",
  draft_errors: "Draft Errors",
  drafted: "Drafted",
  active: "Queued / Scanning",
};
const BATCH_SORT_LABELS: Record<BatchCardSort, string> = {
  original: "Original Order",
  status: "Status",
  title: "Title A-Z",
  market_high: "Market High-Low",
  market_low: "Market Low-High",
  confidence_low: "Confidence Low-High",
  confidence_high: "Confidence High-Low",
};

const TEST_SCAN_FIXTURES: TestScanFixture[] = [
  {
    slug: "test-01-clean-ready",
    label: "Clean Ready",
    backLabel: "Clean Ready Back",
    color: "#0f766e",
    marketPrice: 42.5,
    ai: {
      player: "Shohei Ohtani",
      year: "2023",
      brand: "Topps",
      setName: "Chrome",
      cardNumber: "17",
      parallel: "Refractor",
      serialNumber: null,
      team: "Angels",
      sport: "Baseball",
      isRookie: false,
      isAuto: false,
      isRelic: false,
      conditionGuess: "Near Mint",
      confidence: 0.96,
      notes: "High-confidence paired test card.",
    },
  },
  {
    slug: "test-02-front-only-review",
    label: "Front Only Review",
    color: "#2563eb",
    marketPrice: 18.75,
    ai: {
      player: "Victor Wembanyama",
      year: "2023",
      brand: "Panini",
      setName: "Prizm",
      cardNumber: "136",
      parallel: "Base",
      serialNumber: null,
      team: "Spurs",
      sport: "Basketball",
      isRookie: true,
      isAuto: false,
      isRelic: false,
      conditionGuess: "Near Mint",
      confidence: 0.92,
      notes: "Front-only fixture should need review.",
    },
  },
  {
    slug: "test-03-low-confidence-review",
    label: "Low Confidence",
    backLabel: "Low Confidence Back",
    color: "#7c3aed",
    marketPrice: 31.25,
    ai: {
      player: "CJ Stroud",
      year: "2023",
      brand: "Panini",
      setName: "Donruss Optic",
      cardNumber: "244",
      parallel: "Holo",
      serialNumber: null,
      team: "Texans",
      sport: "Football",
      isRookie: true,
      isAuto: false,
      isRelic: false,
      conditionGuess: "Near Mint",
      confidence: 0.48,
      notes: "Low-confidence fixture should stay ready but reviewed.",
    },
  },
  {
    slug: "test-04-no-comps-fix-review",
    label: "No Comps Fix",
    backLabel: "No Comps Back",
    color: "#b91c1c",
    marketPrice: null,
    noComps: true,
    ai: {
      player: "Mystery Prospect",
      year: "2024",
      brand: "Unlisted",
      setName: "Test Set",
      cardNumber: "999",
      parallel: "Unknown Parallel",
      serialNumber: null,
      team: "Unknown",
      sport: "Baseball",
      isRookie: false,
      isAuto: false,
      isRelic: false,
      conditionGuess: "Review Needed",
      confidence: 0.71,
      notes: "No comps fixture should need price and review.",
    },
  },
  {
    slug: "test-05-clean-quantity-fix",
    label: "Clean Quantity Fix",
    backLabel: "Quantity Fix Back",
    color: "#ca8a04",
    marketPrice: 88,
    customQuantity: "0",
    ai: {
      player: "Mickey Mantle",
      year: "1965",
      brand: "Topps",
      setName: "Baseball",
      cardNumber: "350",
      parallel: "Base",
      serialNumber: null,
      team: "Yankees",
      sport: "Baseball",
      isRookie: false,
      isAuto: false,
      isRelic: false,
      conditionGuess: "Excellent",
      confidence: 0.94,
      notes: "Clean fixture with quantity set to zero.",
    },
  },
  {
    slug: "test-06-scan-failure",
    label: "Scan Failure",
    color: "#4b5563",
    marketPrice: null,
    scanError: "Test model scan failure for retry/export checks.",
    selected: false,
    ai: {
      player: null,
      year: null,
      brand: null,
      setName: null,
      cardNumber: null,
      parallel: null,
      serialNumber: null,
      team: null,
      sport: null,
      isRookie: false,
      isAuto: false,
      isRelic: false,
      conditionGuess: null,
      confidence: 0.1,
      notes: "Intentional scan failure.",
    },
  },
  {
    slug: "test-07-existing-draft-error",
    label: "Draft Error",
    backLabel: "Draft Error Back",
    color: "#dc2626",
    marketPrice: 26,
    initialDraftStatus: "error",
    initialDraftError: "Simulated existing draft image upload failure.",
    ai: {
      player: "Connor Bedard",
      year: "2023",
      brand: "Upper Deck",
      setName: "Young Guns",
      cardNumber: "451",
      parallel: "Base",
      serialNumber: null,
      team: "Blackhawks",
      sport: "Hockey",
      isRookie: true,
      isAuto: false,
      isRelic: false,
      conditionGuess: "Near Mint",
      confidence: 0.9,
      notes: "Starts with a draft error to test clearing/retry.",
    },
  },
  {
    slug: "test-08-already-drafted",
    label: "Already Drafted",
    backLabel: "Already Drafted Back",
    color: "#15803d",
    marketPrice: 64,
    initialDraftStatus: "created",
    draftInventoryItemId: "test-inventory-existing",
    draftLegacyProductId: 990001,
    draftSku: "TEST-EXISTING-001",
    selected: false,
    ai: {
      player: "Simone Biles",
      year: "2024",
      brand: "Topps",
      setName: "Chrome Olympics",
      cardNumber: "1",
      parallel: "Gold",
      serialNumber: "07/50",
      team: "USA",
      sport: "Gymnastics",
      isRookie: false,
      isAuto: false,
      isRelic: false,
      conditionGuess: "Near Mint",
      confidence: 0.97,
      notes: "Already-created fixture for cleanup controls.",
    },
  },
  {
    slug: "test-09-draft-create-error",
    label: "Draft Create Error",
    backLabel: "Draft Create Back",
    color: "#ea580c",
    marketPrice: 55.25,
    draftCreateError: "Simulated draft API validation failure.",
    ai: {
      player: "Lionel Messi",
      year: "2022",
      brand: "Panini",
      setName: "World Cup",
      cardNumber: "10",
      parallel: "Silver",
      serialNumber: null,
      team: "Argentina",
      sport: "Soccer",
      isRookie: false,
      isAuto: false,
      isRelic: false,
      conditionGuess: "Near Mint",
      confidence: 0.93,
      notes: "Ready fixture that intentionally fails test draft creation.",
    },
  },
];

function money(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";

  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function confidenceLabel(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value * 100)}%`;
}

function waitForTestModel(ms = TEST_MODEL_LATENCY_MS) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function escapeSvgText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function testImageFile(name: string, label: string, color: string) {
  const safeLabel = escapeSvgText(label);
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="672" viewBox="0 0 480 672">
  <rect width="480" height="672" rx="28" fill="${color}"/>
  <rect x="28" y="28" width="424" height="616" rx="22" fill="white" opacity="0.94"/>
  <rect x="54" y="54" width="372" height="424" rx="16" fill="${color}" opacity="0.18"/>
  <text x="240" y="255" text-anchor="middle" font-family="Arial, sans-serif" font-size="42" font-weight="800" fill="#111">TCOS</text>
  <text x="240" y="315" text-anchor="middle" font-family="Arial, sans-serif" font-size="28" font-weight="800" fill="#111">${safeLabel}</text>
  <text x="240" y="545" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#444">InstaComp™ Test Model</text>
</svg>`.trim();

  return new File([svg], name, {
    type: "image/svg+xml",
    lastModified: 1760000000000,
  });
}

function testFixtureForFile(file: File) {
  const fileName = file.name.toLowerCase();

  return (
    TEST_SCAN_FIXTURES.find((fixture) => fileName.includes(fixture.slug)) ||
    testFallbackFixtureForFile(file)
  );
}

function titleCaseFromFileName(fileName: string) {
  return cleanRotationFileBaseName(batchFileBaseName(fileName))
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function testFallbackFixtureForFile(file: File): TestScanFixture {
  const label = titleCaseFromFileName(file.name) || "Uploaded Test Card";
  const slug =
    batchFileBaseName(file.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "uploaded-test-card";

  return {
    slug: `upload-${slug}`,
    label,
    color: "#64748b",
    marketPrice: null,
    noComps: true,
    ai: {
      player: label,
      year: null,
      brand: "Test Upload",
      setName: "File-Based Review",
      cardNumber: null,
      parallel: null,
      serialNumber: null,
      team: null,
      sport: null,
      isRookie: false,
      isAuto: false,
      isRelic: false,
      conditionGuess: "Review Needed",
      confidence: 0.1,
      notes:
        "Test mode does not identify arbitrary real cards. Use /admin/instacomp for live OpenAI recognition.",
    },
  };
}

function testComp(
  fixture: TestScanFixture,
  index: number,
  category: ActiveComp["sourceCategory"],
  source: string,
  sourceLabel: string,
  multiplier: number
): ActiveComp {
  const price = fixture.marketPrice
    ? Math.round(fixture.marketPrice * multiplier * 100) / 100
    : 0;
  const title = [
    fixture.ai.year,
    fixture.ai.brand,
    fixture.ai.setName,
    fixture.ai.player,
    fixture.ai.parallel,
    fixture.ai.cardNumber ? `#${fixture.ai.cardNumber}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    title: `${title || fixture.label} test comp ${index}`,
    price,
    currency: "USD",
    url: `https://example.test/instacomp/${fixture.slug}/${source}/${index}`,
    imageUrl: null,
    source,
    sourceLabel,
    sourceCategory: category,
    matchScore: Math.max(0.72, Math.round((0.98 - index * 0.04) * 100) / 100),
    flags: ["test-fixture", category],
  };
}

function testStats(value: number | null, spread = 0.2) {
  if (!value) {
    return {
      low: null,
      median: null,
      average: null,
      high: null,
      suggestedPrice: null,
    };
  }

  return {
    low: Math.round(value * (1 - spread) * 100) / 100,
    median: value,
    average: Math.round(value * 1.03 * 100) / 100,
    high: Math.round(value * (1 + spread) * 100) / 100,
    suggestedPrice: value,
  };
}

function testLinks(query: string) {
  const encoded = encodeURIComponent(query);

  return {
    ebaySoldUrl: `https://www.ebay.com/sch/i.html?_nkw=${encoded}&LH_Sold=1&LH_Complete=1`,
    ebayActiveUrl: `https://www.ebay.com/sch/i.html?_nkw=${encoded}`,
    one30pointUrl: `https://130point.com/sales/?search=${encoded}`,
    comcUrl: `https://www.comc.com/Cards,sr,=${encoded}`,
    myslabsUrl: `https://www.myslabs.com/search/?q=${encoded}`,
    pwccUrl: `https://www.pwccmarketplace.com/items?search=${encoded}`,
    goldinUrl: `https://goldin.co/search?q=${encoded}`,
    fanaticsUrl: `https://collectibles.fanatics.com/search?q=${encoded}`,
    sportlotsUrl: `https://www.sportlots.com/search?search=${encoded}`,
    mercariUrl: `https://www.mercari.com/search/?keyword=${encoded}`,
    facebookMarketplaceUrl: `https://www.facebook.com/marketplace/search/?query=${encoded}`,
    googleShoppingUrl: `https://www.google.com/search?tbm=shop&q=${encoded}`,
    broadCardMarketUrl: `https://www.google.com/search?q=${encoded}`,
  };
}

function testScanResponse(fixture: TestScanFixture, hasBackImage: boolean): ScanResponse {
  const query =
    [
      fixture.ai.year,
      fixture.ai.brand,
      fixture.ai.setName,
      fixture.ai.player,
      fixture.ai.parallel,
      fixture.ai.cardNumber,
    ]
      .filter(Boolean)
      .join(" ") || fixture.label;
  const soldComps =
    fixture.noComps || !fixture.marketPrice
      ? []
      : [
          testComp(fixture, 1, "sold", "ebay_sold", "eBay Sold", 0.9),
          testComp(fixture, 2, "sold", "130point", "130point", 1.05),
        ];
  const pricingComps =
    fixture.noComps || !fixture.marketPrice
      ? []
      : [testComp(fixture, 3, "pricing", "pricecharting", "PriceCharting", 1)];
  const remainingCards =
    fixture.noComps || !fixture.marketPrice
      ? []
      : [
          testComp(fixture, 4, "marketplace", "myslabs", "MySlabs", 1.12),
          testComp(fixture, 5, "auction", "goldin", "Goldin", 1.2),
        ];
  const marketValueComps = [...soldComps, ...pricingComps];
  const providerResults = [...marketValueComps, ...remainingCards];
  const sourceCoverage: SourceCoverageItem[] = [
    {
      label: "eBay Sold",
      status: soldComps.length ? "included" : "no_matches",
      category: "sold",
      includedInMarketValue: soldComps.length > 0,
      resultCount: soldComps.length,
      message: fixture.noComps
        ? "Test fixture intentionally has no sold comps."
        : null,
    },
    {
      label: "PriceCharting",
      status: pricingComps.length ? "included" : "registered",
      category: "pricing",
      includedInMarketValue: pricingComps.length > 0,
      resultCount: pricingComps.length,
      message: null,
    },
    {
      label: "MySlabs",
      status: remainingCards.length ? "registered" : "no_matches",
      category: "marketplace",
      includedInMarketValue: false,
      resultCount: remainingCards.filter((comp) => comp.source === "myslabs")
        .length,
      message: null,
    },
    {
      label: "Goldin",
      status: remainingCards.length ? "registered" : "no_matches",
      category: "auction",
      includedInMarketValue: false,
      resultCount: remainingCards.filter((comp) => comp.source === "goldin")
        .length,
      message: null,
    },
  ];

  return {
    ok: true,
    scanId: `test-scan-${fixture.slug}`,
    ai: {
      ...fixture.ai,
      notes: [
        fixture.ai.notes,
        hasBackImage ? "Back image present." : "Front-only test scan.",
      ]
        .filter(Boolean)
        .join(" "),
    },
    searchQuery: query,
    backupQueries: [`${query} sold`, `${query} comps`, `${query} checklist`],
    links: testLinks(query),
    providers: [
      {
        source: "external_comp_search",
        label: "Test External Search",
        status: providerResults.length ? "live" : "no_matches",
        message: "Deterministic test provider; no external request was made.",
        results: providerResults,
        searchUrl: `https://example.test/instacomp/search?q=${encodeURIComponent(
          query
        )}`,
        diagnostics: {
          externalSearch: {
            provider: "serpapi",
            providerLabel: "Test SerpApi",
            cacheStatus: "hit",
            cacheHit: true,
            externalRequestAttempted: false,
            paidSearchUsed: false,
            requestedLimit: 15,
            returnedSearchItems: providerResults.length,
            includedCompCount: marketValueComps.length,
            registeredSourceCount: sourceCoverage.length,
            cacheTtlDays: 7,
            cacheExpiresAt: new Date(
              Date.now() + 7 * 24 * 60 * 60 * 1000
            ).toISOString(),
            cacheHitCountBeforeScan: 12,
          },
        },
      },
    ],
    sourceCoverage,
    activeComps: remainingCards,
    marketValueComps,
    soldComps,
    remainingCards,
    stats: testStats(fixture.marketPrice),
    soldStats: testStats(
      fixture.marketPrice
        ? Math.round(fixture.marketPrice * 0.95 * 100) / 100
        : null
    ),
    note: fixture.noComps
      ? "Test model: no comps returned."
      : "Test model: deterministic comps returned from local fixtures.",
  };
}

async function runTestInstaCompScan(front: File, back?: File | null) {
  const fixture = testFixtureForFile(front);

  await waitForTestModel();

  if (fixture.scanError) {
    throw new Error(fixture.scanError);
  }

  return testScanResponse(fixture, Boolean(back));
}

function testDraftCreateErrorForCard(card: BatchCard) {
  return testFixtureForFile(card.file).draftCreateError || null;
}

function testModelCheck(
  label: string,
  expected: number | string,
  actual: number | string,
  pass = String(expected) === String(actual)
): TestModelCheck {
  return {
    label,
    expected: String(expected),
    actual: String(actual),
    pass,
  };
}

function expectedTestModelScenarioCounts(scenario: TestModelCheckScenario) {
  if (scenario === "draft_cycle") {
    return {
      done: 8,
      failed: 1,
      draftable: 4,
      ready: 2,
      clean: 2,
      cleanReady: 1,
      review: 5,
      fix: 2,
      reviewFix: 1,
      cleanFix: 1,
      draftError: 1,
      drafted: 4,
      paired: 7,
    };
  }

  if (scenario === "scan_cycle") {
    return {
      done: 8,
      failed: 1,
      draftable: 8,
      ready: 6,
      clean: 5,
      cleanReady: 4,
      review: 4,
      fix: 2,
      reviewFix: 1,
      cleanFix: 1,
      draftError: 0,
      drafted: 0,
      paired: 7,
    };
  }

  return {
    done: 8,
    failed: 1,
    draftable: 7,
    ready: 5,
    clean: 3,
    cleanReady: 2,
    review: 5,
    fix: 2,
    reviewFix: 1,
    cleanFix: 1,
    draftError: 1,
    drafted: 1,
    paired: 7,
  };
}

function buildTestModelSmokeChecks(
  cards: BatchCard[],
  scenario: TestModelCheckScenario = "completed_matrix"
) {
  const expected = expectedTestModelScenarioCounts(scenario);
  const loadedFixtureSlugs = new Set(
    cards.map((card) => testFixtureForFile(card.file).slug)
  );
  const allFixturesLoaded = TEST_SCAN_FIXTURES.every((fixture) =>
    loadedFixtureSlugs.has(fixture.slug)
  );
  const draftableCards = cards.filter(isDraftableBatchCard);
  const readyCards = draftableCards.filter(
    (card) => draftReadinessErrors(card).length === 0
  );
  const cleanCards = draftableCards.filter(
    (card) => batchCardReviewWarnings(card).length === 0
  );
  const cleanReadyCards = cleanCards.filter(
    (card) => draftReadinessErrors(card).length === 0
  );
  const reviewCards = cards.filter(
    (card) => batchCardReviewWarnings(card).length > 0
  );
  const fixCards = draftableCards.filter(
    (card) => draftReadinessErrors(card).length > 0
  );
  const reviewFixCards = draftableCards.filter(
    (card) =>
      batchCardReviewWarnings(card).length > 0 &&
      draftReadinessErrors(card).length > 0
  );
  const cleanFixCards = cleanCards.filter(
    (card) => draftReadinessErrors(card).length > 0
  );

  return [
    testModelCheck(
      "Fixtures",
      TEST_SCAN_FIXTURES.length,
      cards.length,
      cards.length === TEST_SCAN_FIXTURES.length && allFixturesLoaded
    ),
    testModelCheck(
      "Completed",
      expected.done,
      cards.filter((card) => card.status === "done").length
    ),
    testModelCheck(
      "Failed",
      expected.failed,
      cards.filter((card) => card.status === "error").length
    ),
    testModelCheck("Draftable", expected.draftable, draftableCards.length),
    testModelCheck("Ready", expected.ready, readyCards.length),
    testModelCheck("Clean", expected.clean, cleanCards.length),
    testModelCheck("Clean Ready", expected.cleanReady, cleanReadyCards.length),
    testModelCheck("Review", expected.review, reviewCards.length),
    testModelCheck("Fix", expected.fix, fixCards.length),
    testModelCheck("Review Fix", expected.reviewFix, reviewFixCards.length),
    testModelCheck("Clean Fix", expected.cleanFix, cleanFixCards.length),
    testModelCheck(
      "Draft Error",
      expected.draftError,
      cards.filter((card) => card.draftStatus === "error").length
    ),
    testModelCheck(
      "Drafted",
      expected.drafted,
      cards.filter((card) => card.draftStatus === "created").length
    ),
    testModelCheck("Paired", expected.paired, cards.filter((card) => card.backFile).length),
  ];
}

function isTestModelCheckScenario(value: unknown): value is TestModelCheckScenario {
  return (
    value === "completed_matrix" ||
    value === "scan_cycle" ||
    value === "draft_cycle"
  );
}

function cleanStoredTestModelRunRecords(value: unknown): TestModelRunRecord[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((record): record is Record<string, unknown> =>
      Boolean(record && typeof record === "object")
    )
    .map((record) => ({
      id: String(record.id || `stored-${Date.now()}`),
      ranAt: String(record.ranAt || new Date().toISOString()),
      label: String(record.label || "Stored Test Run"),
      scenario: isTestModelCheckScenario(record.scenario)
        ? record.scenario
        : "completed_matrix",
      passed: Number(record.passed) || 0,
      failed: Number(record.failed) || 0,
      total: Number(record.total) || 0,
      rowCount: Number(record.rowCount) || 0,
      problemRows: Number(record.problemRows) || 0,
      scanFailures: Number(record.scanFailures) || 0,
      draftFailures: Number(record.draftFailures) || 0,
      reviewRows: Number(record.reviewRows) || 0,
      fixRows: Number(record.fixRows) || 0,
    }))
    .slice(0, 12);
}

function summarizeTestModelRunRecords(records: TestModelRunRecord[]) {
  return records.reduce(
    (totals, record) => ({
      runs: totals.runs + 1,
      passedChecks: totals.passedChecks + record.passed,
      failedChecks: totals.failedChecks + record.failed,
      rowsTested: totals.rowsTested + record.rowCount,
      problemRows: totals.problemRows + record.problemRows,
      scanFailures: totals.scanFailures + record.scanFailures,
      draftFailures: totals.draftFailures + record.draftFailures,
      reviewRows: totals.reviewRows + record.reviewRows,
      fixRows: totals.fixRows + record.fixRows,
    }),
    {
      runs: 0,
      passedChecks: 0,
      failedChecks: 0,
      rowsTested: 0,
      problemRows: 0,
      scanFailures: 0,
      draftFailures: 0,
      reviewRows: 0,
      fixRows: 0,
    }
  );
}

function testFixtureCoverageTags(fixture: TestScanFixture) {
  const tags = [
    fixture.backLabel ? "paired_images" : "front_only_review",
    fixture.marketPrice ? "priced" : "missing_price_fix",
  ];

  if (fixture.scanError) tags.push("scan_failure");
  if (fixture.noComps) tags.push("no_comps_review");
  if (fixture.customQuantity === "0") tags.push("quantity_fix");
  if (fixture.initialDraftStatus === "error") tags.push("existing_draft_error");
  if (fixture.initialDraftStatus === "created") tags.push("already_drafted");
  if (fixture.draftCreateError) tags.push("draft_create_error");
  if (fixture.ai.confidence < LOW_CONFIDENCE_THRESHOLD) {
    tags.push("low_confidence_review");
  }
  if (fixture.ai.isRookie) tags.push("rookie_card");
  if (fixture.ai.serialNumber) tags.push("serial_number");

  return tags;
}

function sourceStatusLabel(status: SourceCoverageItem["status"]) {
  if (status === "included") return "Included in value";
  if (status === "registered") return "Registered source";
  if (status === "not_configured") return "Not configured";
  if (status === "no_matches") return "No matches";
  return "Error";
}

function externalSearchDiagnostics(result: ScanResponse | null) {
  return (
    result?.providers?.find((provider) => provider.source === "external_comp_search")
      ?.diagnostics?.externalSearch || null
  );
}

function externalSearchCacheLabel(diagnostics: ExternalSearchDiagnostics | null) {
  if (!diagnostics) return "Not reported";
  if (diagnostics.cacheStatus === "hit") return "Cache hit";
  if (diagnostics.cacheStatus === "miss") return "Cache miss";
  if (diagnostics.cacheStatus === "disabled") return "Cache disabled";
  if (diagnostics.cacheStatus === "not_configured") return "Not configured";
  return "Error";
}

function externalSearchRequestLabel(diagnostics: ExternalSearchDiagnostics | null) {
  if (!diagnostics) return "Not reported";
  if (diagnostics.cacheHit) return "No external request";
  if (diagnostics.externalRequestAttempted) return "External request used";
  return "No external request";
}

function exportTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function exportCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

function csvCell(value: unknown) {
  return `"${exportCell(value).replace(/"/g, '""')}"`;
}

function downloadTextFile(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function sourceCoverageSummary(result: ScanResponse | null) {
  return (
    result?.sourceCoverage
      ?.map(
        (source) =>
          `${source.label}:${source.status}:${source.resultCount}${
            source.includedInMarketValue ? ":included" : ""
          }`
      )
      .join("; ") || ""
  );
}

function topRemainingMatches(result: ScanResponse | null) {
  return (
    result?.remainingCards?.slice(0, 5).map((comp) => ({
      title: comp.title,
      price: comp.price,
      source: comp.sourceLabel || comp.source,
      category: comp.sourceCategory,
      matchScore: comp.matchScore,
      url: comp.url,
    })) || []
  );
}

function visibleMarketplaceMatches(result: ScanResponse) {
  return uniqueComps([
    ...primaryCompComps(result),
    ...(result.remainingCards || []),
    ...(result.activeComps || []),
  ]);
}

function compGuidanceLabel(comp: ActiveComp) {
  return comp.flags?.find(
    (flag) =>
      flag.startsWith("serial adjusted") ||
      flag.startsWith("same print run")
  );
}

function compPriceBasisLabel(comp: ActiveComp) {
  if (isHistoricalSoldComp(comp)) return "historical sold comp - not priced";
  if (comp.sourceCategory === "sold") return "sold comp";
  if (comp.flags?.includes("serial #")) return "exact serial";
  if (comp.flags?.includes("numbered run")) return "same print run";
  if (compGuidanceLabel(comp)?.startsWith("serial adjusted")) {
    return "serial-adjusted guidance";
  }
  if (comp.sourceCategory === "marketplace") return "active listing";
  if (comp.sourceCategory === "pricing") return "pricing guidance";

  return sourceCategoryLabels[comp.sourceCategory] || "reference";
}

const CURRENT_SOLD_COMP_MAX_AGE_DAYS = 45;

function compEventDate(comp: ActiveComp) {
  const rawDate =
    comp.sourceCategory === "sold"
      ? comp.soldAt || null
      : comp.listedAt || comp.observedAt || null;
  if (!rawDate) return null;

  const parsed = new Date(rawDate);

  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function compAgeDays(comp: ActiveComp) {
  const date = compEventDate(comp);
  if (!date) return null;

  return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
}

function isHistoricalSoldComp(comp: ActiveComp) {
  if (comp.sourceCategory !== "sold") return false;

  const ageDays = compAgeDays(comp);

  return ageDays !== null && ageDays > CURRENT_SOLD_COMP_MAX_AGE_DAYS;
}

function compFreshnessLabel(comp: ActiveComp) {
  const ageDays = compAgeDays(comp);

  if (isHistoricalSoldComp(comp)) {
    return `Historical sale ${ageDays}d old - shown, not priced`;
  }

  if (comp.sourceCategory === "sold" && ageDays !== null) {
    return `Current sale ${ageDays}d old`;
  }

  if (comp.sourceCategory === "sold") {
    return "Sold date unknown";
  }

  return null;
}

function marketPricingExplanation(result: ScanResponse) {
  const marketComps = currentMarketValueComps(result);
  const soldComps = result.soldComps || [];
  const currentSoldComps = soldComps.filter(
    (comp) => isUsableMarketComp(comp) && !isHistoricalSoldComp(comp)
  );
  const historicalSoldComps = soldComps.filter(isHistoricalSoldComp);
  const activeComps = marketComps.filter(
    (comp) => comp.sourceCategory === "marketplace"
  );
  const adjustedComps = marketComps.filter(
    (comp) =>
      comp.sourceCategory === "pricing" &&
      compGuidanceLabel(comp)?.startsWith("serial adjusted")
  );
  const sameRunGuidance = marketComps.filter(
    (comp) =>
      comp.sourceCategory === "pricing" &&
      compGuidanceLabel(comp)?.startsWith("same print run")
  );
  const basis =
    currentSoldComps.length > 0
      ? `${currentSoldComps.length} current sold comp${
          currentSoldComps.length === 1 ? "" : "s"
        }${
          historicalSoldComps.length
            ? ` / ${historicalSoldComps.length} historical`
            : ""
        }`
    : activeComps.length > 0
      ? "active listings"
      : adjustedComps.length > 0
          ? "serial-adjusted guidance"
          : sameRunGuidance.length > 0
            ? "same-run pricing guidance"
            : marketComps.length > 0
              ? "market guidance"
              : "no usable comps";

  return {
    basis,
    marketComps,
    soldComps,
    currentSoldComps,
    historicalSoldComps,
    activeComps,
    adjustedComps,
    sameRunGuidance,
  };
}

function batchExportRows(items: BatchCardViewItem[]) {
  return items.map(({ card, index }, exportIndex) => {
    const result = card.result;
    const ai = result?.ai;
    const external = externalSearchDiagnostics(result);
    const aiTitle = cardResultTitle(result, card.file.name);
    const title = draftTitleForCard(card);

    return {
      row: index + 1,
      exportRow: exportIndex + 1,
      clientId: card.id,
      status: card.status,
      reviewWarnings: batchCardReviewWarnings(card).join("; "),
      draftReady: draftReadinessErrors(card).length === 0,
      draftReadinessErrors: draftReadinessErrors(card).join("; "),
      selectedForDraft: card.selected && isDraftableBatchCard(card),
      operatorMarkedWrong: Boolean(card.operatorMarkedWrong),
      operatorNeedsMoreInfo: Boolean(card.operatorNeedsMoreInfo),
      frontFileName: card.file.name,
      backFileName: card.backFile?.name || "",
      pairedImages: Boolean(card.backFile),
      scanId: result?.scanId || "",
      title,
      aiTitle,
      titleOverride: card.customTitle.trim(),
      player: ai?.player || "",
      year: ai?.year || "",
      brand: ai?.brand || "",
      setName: ai?.setName || "",
      cardNumber: ai?.cardNumber || "",
      parallel: ai?.parallel || "",
      serialNumber: ai?.serialNumber || "",
      team: ai?.team || "",
      sport: ai?.sport || "",
      rookie: ai?.isRookie || false,
      autograph: ai?.isAuto || false,
      relic: ai?.isRelic || false,
      conditionGuess: ai?.conditionGuess || "",
      confidence: ai?.confidence ?? "",
      aiNotes: ai?.notes || "",
      searchQuery: result?.searchQuery || "",
      marketLow: result ? effectiveMarketStats(result).low ?? "" : "",
      marketMedian: result ? effectiveMarketStats(result).median ?? "" : "",
      marketAverage: result ? effectiveMarketStats(result).average ?? "" : "",
      marketHigh: result ? effectiveMarketStats(result).high ?? "" : "",
      marketSuggested: result
        ? effectiveMarketStats(result).suggestedPrice ?? ""
        : "",
      soldLow: result?.soldStats?.low ?? "",
      soldMedian: result?.soldStats?.median ?? "",
      soldAverage: result?.soldStats?.average ?? "",
      soldHigh: result?.soldStats?.high ?? "",
      quantity: draftQuantityForCard(card),
      listingPrice: draftListingPriceForCard(card) ?? "",
      listingPriceSource: draftPriceHandoffForCard(card).source,
      draftStatus: card.draftStatus,
      draftSku: card.draftSku || "",
      draftInventoryItemId: card.draftInventoryItemId || "",
      draftLegacyProductId: card.draftLegacyProductId || "",
      tradeStatus: card.tradeStatus,
      tradeCollectionItemId: card.tradeCollectionItemId || "",
      error: card.error || "",
      draftError: card.draftError || "",
      tradeError: card.tradeError || "",
      externalProvider: external?.providerLabel || "",
      externalCacheStatus: external?.cacheStatus || "",
      externalRequestAttempted: external?.externalRequestAttempted ?? "",
      paidSearchUsed: external?.paidSearchUsed ?? "",
      externalSearchItems: external?.returnedSearchItems ?? "",
      externalIncludedComps: external?.includedCompCount ?? "",
      externalCacheHitsBeforeScan: external?.cacheHitCountBeforeScan ?? "",
      externalCacheExpiresAt: external?.cacheExpiresAt || "",
      marketValueCompCount: result
        ? effectiveMarketValueComps(result).length
        : "",
      soldCompCount: result?.soldComps?.length ?? "",
      remainingMatchCount: result?.remainingCards?.length ?? "",
      sourceCoverage: sourceCoverageSummary(result),
      topRemainingMatches: topRemainingMatches(result),
    };
  });
}

function downloadBatchCsv(items: BatchCardViewItem[], fileName: string) {
  const rows = batchExportRows(items);

  if (!rows.length) return;

  const headers = Object.keys(rows[0]) as Array<keyof (typeof rows)[number]>;
  const csv = [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");

  downloadTextFile(fileName, csv, "text/csv;charset=utf-8");
}

function exportBatchCsv(items: BatchCardViewItem[], fileScope: "all" | "view") {
  downloadBatchCsv(
    items,
    `instacomp-batch-${fileScope}-${exportTimestamp()}.csv`
  );
}

function exportBatchReportCsv(items: BatchCardViewItem[], reportScope: string) {
  downloadBatchCsv(items, `instacomp-${reportScope}-${exportTimestamp()}.csv`);
}

function batchJsonPayload(items: BatchCardViewItem[], fileScope: "all" | "view") {
  const cards = items.map(({ card }) => card);
  const rows = batchExportRows(items);

  return {
    exportedAt: new Date().toISOString(),
    scope: fileScope,
    totals: {
      cards: cards.length,
      queued: cards.filter((card) => card.status === "queued").length,
      scanning: cards.filter((card) => card.status === "scanning").length,
      done: cards.filter((card) => card.status === "done").length,
      failed: cards.filter((card) => card.status === "error").length,
      paired: cards.filter((card) => card.backFile).length,
      selectedForDraft: cards.filter(
        (card) => card.selected && isDraftableBatchCard(card)
      ).length,
      operatorMarkedWrong: cards.filter((card) => card.operatorMarkedWrong)
        .length,
      operatorNeedsMoreInfo: cards.filter((card) => card.operatorNeedsMoreInfo)
        .length,
      operatorMarkedCorrect: cards.filter(
        (card) =>
          card.status === "done" &&
          !card.operatorMarkedWrong &&
          !card.operatorNeedsMoreInfo
      ).length,
      draftable: cards.filter(isDraftableBatchCard).length,
      draftsCreated: cards.filter((card) => card.draftStatus === "created")
        .length,
      paidSearches: cards.filter(
        (card) => externalSearchDiagnostics(card.result)?.paidSearchUsed
      ).length,
      cacheHits: cards.filter(
        (card) => externalSearchDiagnostics(card.result)?.cacheHit
      ).length,
    },
    cards: rows,
  };
}

function exportBatchJson(items: BatchCardViewItem[], fileScope: "all" | "view") {
  const payload = batchJsonPayload(items, fileScope);

  downloadTextFile(
    `instacomp-batch-${fileScope}-${exportTimestamp()}.json`,
    JSON.stringify(payload, null, 2),
    "application/json;charset=utf-8"
  );
}

function serialRunFromSerialNumber(value: string | null | undefined) {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .replace(/[｜⁄]/g, "/")
    .replace(/\bof\b/gi, "/")
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[^0-9/]+/g, "")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "");
  const parts = cleaned.split("/").filter(Boolean);

  if (parts.length < 2) return "";

  const denominator = Number.parseInt(parts[parts.length - 1], 10);

  return Number.isFinite(denominator) && denominator > 0
    ? `/${denominator}`
    : "";
}

function trialCardIdForBatchIndex(index: number) {
  return `trial-card-${String(index + 1).padStart(3, "0")}`;
}

function secondsFromElapsedMs(value: number | null | undefined) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return null;
  return Number((Number(value) / 1000).toFixed(2));
}

function percentileElapsedMs(values: number[], percentile: number) {
  if (!values.length) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))];
}

function instacompTrialSpeedGate(items: BatchCardViewItem[]) {
  const trialRows = items.filter(
    ({ card }) => card.status === "done" && Boolean(card.result?.ai)
  );
  const elapsedRows = trialRows
    .map(({ card, index }) => ({
      trialCardId: trialCardIdForBatchIndex(index),
      elapsedMs:
        Number.isFinite(Number(card.scanElapsedMs)) &&
        Number(card.scanElapsedMs) > 0
          ? Number(card.scanElapsedMs)
          : null,
    }))
    .filter(
      (row): row is { trialCardId: string; elapsedMs: number } =>
        row.elapsedMs !== null && Number.isFinite(row.elapsedMs)
    );
  const elapsedValues = elapsedRows.map((row) => row.elapsedMs);
  const averageElapsedMs =
    elapsedValues.length > 0
      ? elapsedValues.reduce((sum, value) => sum + value, 0) /
        elapsedValues.length
      : null;
  const p95ElapsedMs = percentileElapsedMs(elapsedValues, 95);
  const slowestRows = elapsedRows
    .slice()
    .sort((left, right) => right.elapsedMs - left.elapsedMs)
    .slice(0, 3)
    .map((row) => ({
      trialCardId: row.trialCardId,
      seconds: secondsFromElapsedMs(row.elapsedMs),
    }));
  const timingComplete =
    trialRows.length > 0 && elapsedRows.length === trialRows.length;
  const averageSeconds = secondsFromElapsedMs(averageElapsedMs);
  const p95Seconds = secondsFromElapsedMs(p95ElapsedMs);
  const averagePass =
    averageSeconds !== null &&
    averageSeconds <= INSTACOMP_FINAL_TRIAL_TARGET_AVERAGE_SECONDS;
  const p95Pass =
    p95Seconds !== null &&
    p95Seconds <= INSTACOMP_FINAL_TRIAL_TARGET_P95_SECONDS;
  const readyToExport =
    trialRows.length >= INSTACOMP_FINAL_TRIAL_TARGET_CARDS &&
    timingComplete &&
    averagePass &&
    p95Pass;

  return {
    targetCards: INSTACOMP_FINAL_TRIAL_TARGET_CARDS,
    targetAverageSeconds: INSTACOMP_FINAL_TRIAL_TARGET_AVERAGE_SECONDS,
    targetP95Seconds: INSTACOMP_FINAL_TRIAL_TARGET_P95_SECONDS,
    resultRows: trialRows.length,
    rowsWithTiming: elapsedRows.length,
    timingComplete,
    averageSeconds,
    p95Seconds,
    averagePass,
    p95Pass,
    readyToExport,
    slowestRows,
  };
}

function instacompTrialCatalogEvidenceSummary(result: ScanResponse) {
  const catalogEvidence = result.catalogEvidence || null;
  if (!catalogEvidence) return null;

  return {
    schema: catalogEvidence.schema,
    status: catalogEvidence.status,
    operatorState: catalogEvidence.operatorState,
    catalogConfirmed: catalogEvidence.catalogConfirmed,
    sourceLabel:
      catalogEvidence.sourceAttribution?.sourceLabel ||
      catalogEvidence.selectedMatch?.sourceLabel ||
      null,
    catalogId:
      catalogEvidence.sourceAttribution?.catalogId ||
      catalogEvidence.selectedMatch?.catalogId ||
      null,
    matchScore: catalogEvidence.selectedMatch?.score ?? null,
    identity: catalogEvidence.selectedMatch?.identity || null,
    matchedEvidence: catalogEvidence.selectedMatch?.matchedEvidence || [],
    mismatchedEvidence: catalogEvidence.selectedMatch?.mismatchedEvidence || [],
    reviewReasons: catalogEvidence.reviewReasons,
    suggestedQuestion: catalogEvidence.suggestedQuestion,
    operatorAction: catalogEvidence.operatorAction,
    safeUseBoundary: catalogEvidence.safeUseBoundary,
    actionPermissions: catalogEvidence.actionPermissions,
  };
}

function instacompTrialResultRows(items: BatchCardViewItem[]) {
  return items
    .filter(({ card }) => card.status === "done" && card.result?.ai)
    .map(({ card, index }) => {
      const result = card.result as ScanResponse;
      const ai = result.ai;

      return {
        trialCardId: trialCardIdForBatchIndex(index),
        sourceClientId: card.persistentClientId || card.id,
        sourceRow: index + 1,
        frontFileName: card.file.name,
        backFileName: card.backFile?.name || "",
        scanId: result.scanId,
        timing: {
          queuedAt: card.scanQueuedAt || null,
          startedAt: card.scanStartedAt || null,
          completedAt: card.scanCompletedAt || null,
          elapsedMs: card.scanElapsedMs ?? null,
        },
        scanElapsedMs: card.scanElapsedMs ?? null,
        consensus: result.consensus || null,
        review: result.review || null,
        catalogEvidence: instacompTrialCatalogEvidenceSummary(result),
        operatorReview: {
          markedWrong: Boolean(card.operatorMarkedWrong || card.operatorNeedsMoreInfo),
          needsMoreInfo: Boolean(card.operatorNeedsMoreInfo),
          markedCorrect: !card.operatorMarkedWrong && !card.operatorNeedsMoreInfo,
          reviewMode: card.operatorNeedsMoreInfo
            ? "operator_needs_more_info"
            : "operator_wrong_checkbox",
        },
        actual: {
          player: ai.player || "",
          year: ai.year || "",
          brand: ai.brand || "",
          setName: ai.setName || "",
          cardNumber: ai.cardNumber || "",
          parallel: ai.parallel || "",
          variation: "",
          serialNumber: ai.serialNumber || "",
          serialRun: serialRunFromSerialNumber(ai.serialNumber),
          team: ai.team || "",
          sport: ai.sport || "",
          isRookie: ai.isRookie,
          isAuto: ai.isAuto,
          isRelic: ai.isRelic,
        },
      };
    });
}

function instacompTrialResultsPayload(items: BatchCardViewItem[]) {
  const cards = instacompTrialResultRows(items);
  const timedRows = cards.filter((card) => Number(card.timing?.elapsedMs) > 0);

  return {
    schema: "tcos.instacompTrialResults.v1",
    exportedAt: new Date().toISOString(),
    source: "admin_instacomp_batch_export",
    instructions:
      "Save this as instacomp-trial-results.local.json next to instacomp-trial-manifest.local.json, then run npm run instacomp:trial:score.",
    summary: {
      exportedCards: cards.length,
      sourceRows: items.length,
      consensusReviewRequired: cards.filter(
        (card) => card.consensus?.status === "review_required"
      ).length,
      missingConsensus: cards.filter((card) => !card.consensus).length,
      catalogConfirmed: cards.filter(
        (card) => card.catalogEvidence?.catalogConfirmed === true
      ).length,
      catalogReviewRequired: cards.filter(
        (card) => card.catalogEvidence?.status === "review_required"
      ).length,
      missingCatalogEvidence: cards.filter((card) => !card.catalogEvidence).length,
      operatorMarkedWrong: cards.filter((card) => card.operatorReview.markedWrong)
        .length,
      operatorNeedsMoreInfo: cards.filter(
        (card) => card.operatorReview.needsMoreInfo
      ).length,
      operatorMarkedCorrect: cards.filter(
        (card) => card.operatorReview.markedCorrect
      ).length,
      operatorReviewAccuracyPercent:
        cards.length > 0
          ? Number(
              (
                (cards.filter((card) => card.operatorReview.markedCorrect)
                  .length /
                  cards.length) *
                100
              ).toFixed(2)
            )
          : null,
      rowsWithTiming: timedRows.length,
      averageElapsedMs:
        timedRows.length > 0
          ? Math.round(
              timedRows.reduce(
                (sum, card) => sum + (Number(card.timing?.elapsedMs) || 0),
                0
              ) / timedRows.length
            )
          : null,
    },
    cards,
  };
}

function draftListingItemsForCards(cards: BatchCard[]) {
  return cards.map((card, index) => {
    const draftPrice = draftPriceHandoffForCard(card);

    return {
      uploadIndex: String(index),
      clientId: card.persistentClientId || card.id,
      persistentJobId: card.persistentJobId || null,
      persistentItemId: card.persistentItemId || null,
      tradeCollectionItemId: card.tradeCollectionItemId || null,
      scanId: card.result?.scanId || null,
      fileName: card.file.name,
      backFileName: card.backFile?.name || null,
      hasBackImage: Boolean(card.backFile),
      title: draftTitleForCard(card),
      price: draftPrice.price ?? 0,
      priceSource: draftPrice.source,
      marketPrice: marketPriceForCard(card),
      quantity: draftQuantityForCard(card),
      searchQuery: card.result?.searchQuery || null,
      ai: card.result?.ai || null,
      stats: card.result ? effectiveMarketStats(card.result) : null,
      soldStats: card.result?.soldStats || null,
      sourceCoverage: card.result?.sourceCoverage || [],
      externalSearch: externalSearchDiagnostics(card.result),
    };
  });
}

function tradeItemForCard(card: BatchCard) {
  return {
    clientId: card.persistentClientId || card.id,
    persistentJobId: card.persistentJobId || null,
    persistentItemId: card.persistentItemId || null,
    scanId: card.result?.scanId || null,
    fileName: card.file.name,
    hasBackImage: Boolean(card.backFile),
    title: draftTitleForCard(card),
    marketPrice: marketPriceForCard(card),
    searchQuery: card.result?.searchQuery || null,
    ai: card.result?.ai || null,
    stats: card.result ? effectiveMarketStats(card.result) : null,
    soldStats: card.result?.soldStats || null,
  };
}

function shortDateTime(value: string | null | undefined) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function cardResultTitle(result: ScanResponse | null, fallback: string) {
  fallback = cleanRotationFileName(fallback);
  if (!result) return fallback;
  return buildInstaCompDraftTitle(result.ai, fallback);
}

function gradingSummary(ai: AiResult | null | undefined) {
  const parts = [
    ai?.gradingCompany || null,
    ai?.gradeValue ? `Grade ${ai.gradeValue}` : null,
    ai?.certificationNumber ? `Cert ${ai.certificationNumber}` : null,
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : null;
}

function certificationLookupHref(ai: AiResult | null | undefined) {
  return (
    ai?.certificationLookupUrl ||
    gradingLookupUrl(ai?.gradingCompany, ai?.certificationNumber)
  );
}

function draftTitleForCard(card: BatchCard) {
  return card.customTitle.trim() || cardResultTitle(card.result, card.file.name);
}

function quantityMergeIdentityKeyForCard(card: BatchCard) {
  const ai = card.result?.ai;
  const catalogIdentity =
    card.result?.catalogEvidence?.selectedMatch?.identity || null;
  const identityParts = [
    catalogIdentity?.year || ai?.year,
    catalogIdentity?.player || ai?.player,
    ai?.brand,
    catalogIdentity?.setName || ai?.setName,
    catalogIdentity?.cardNumber || ai?.cardNumber,
    catalogIdentity?.parallel || ai?.parallel,
    catalogIdentity?.variation,
    ai?.serialNumber,
    ai?.gradingCompany,
    ai?.gradeValue,
    ai?.certificationNumber,
  ]
    .map((part) => String(part || "").trim())
    .filter(Boolean);

  if (identityParts.length >= 2) {
    return identityParts.join(" | ");
  }

  const draftTitle = draftTitleForCard(card);

  return draftTitle.trim() ? draftTitle : null;
}

function selectedQuantityMergeIdentityKeyForCard(card: BatchCard) {
  return card.customTitle.trim() ? null : quantityMergeIdentityKeyForCard(card);
}

function sellerInventoryInstaCompDraftHref(search?: string | null) {
  const params = new URLSearchParams({
    status: "draft",
    source: "instacomp",
  });

  if (search?.trim()) {
    params.set("search", search.trim());
  }

  return `/seller/inventory?${params.toString()}`;
}

function tcosCardSearchQuery(result: ScanResponse | null, fallback: string) {
  return cardResultTitle(result, fallback).replace(/\s+/g, " ").trim();
}

function tcosBuySearchHref(query: string) {
  const params = new URLSearchParams();

  if (query.trim()) params.set("q", query.trim());

  return `/shop${params.toString() ? `?${params.toString()}` : ""}`;
}

function tcosTradeSearchHref(query: string) {
  const params = new URLSearchParams();

  if (query.trim()) params.set("q", query.trim());

  return `/trade${params.toString() ? `?${params.toString()}` : ""}`;
}

function draftQuantityForCard(card: BatchCard) {
  const parsed = Number(card.customQuantity);

  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : 1;
}

function roundedPositiveMoney(value: number | null | undefined) {
  if (value === null || value === undefined) return null;

  const price = Number(value);

  if (!Number.isFinite(price) || price <= 0) return null;

  return Math.round(price * 100) / 100;
}

function waitForMs(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function isDatabaseConnectionPressureText(value: unknown) {
  return /\b(too many connections|remaining connection slots|too many clients|connection limit|database.*overload|pool.*timeout|db.*connection)\b/i.test(
    String(value || "")
  );
}

function isOpenAIRateLimitText(value: unknown) {
  return /\b(rate[_\s-]?limit[_\s-]?exceeded|rate limit reached|tokens per min|requests per min|TPM|RPM)\b/i.test(
    String(value || "")
  );
}

function isDatabaseConnectionPressureError(value: unknown) {
  const error = value as
    | {
        message?: unknown;
        code?: unknown;
        status?: unknown;
        details?: unknown;
      }
    | null
    | undefined;

  return (
    isDatabaseConnectionPressureText(error?.message) ||
    isDatabaseConnectionPressureText(error?.details) ||
    (String(error?.code || "") === "INSTACOMP_JOB_DATABASE_ERROR" &&
      Number(error?.status || 0) >= 500)
  );
}

function isOpenAIRateLimitError(value: unknown) {
  const error = value as
    | {
        message?: unknown;
        code?: unknown;
        status?: unknown;
        details?: unknown;
      }
    | null
    | undefined;

  return (
    isOpenAIRateLimitText(error?.message) ||
    isOpenAIRateLimitText(error?.details) ||
    String(error?.code || "").toLowerCase() === "rate_limit_exceeded" ||
    Number(error?.status || 0) === 429
  );
}

function databasePressureBackoffMs(attempt: number) {
  return Math.min(20_000, 2_500 * 2 ** attempt);
}

function isUsableMarketComp(comp: ActiveComp) {
  if (!["sold", "marketplace", "pricing"].includes(comp.sourceCategory)) {
    return false;
  }

  if (roundedPositiveMoney(comp.price) === null) return false;

  const flags = comp.flags || [];

  return (
    !flags.includes("excluded") &&
    !flags.includes("guidance comp") &&
    !flags.includes("not used for pricing")
  );
}

function uniqueComps(comps: ActiveComp[]) {
  const seen = new Set<string>();

  return comps.filter((comp) => {
    const key = `${comp.source}|${comp.url}|${comp.title}|${comp.price}`;

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function providerMarketComps(result: ScanResponse | null | undefined) {
  if (!result?.providers?.length) return [];

  return uniqueComps(
    result.providers
      .flatMap((provider) => provider.results || [])
      .filter(isUsableMarketComp)
  );
}

function effectiveMarketValueComps(result: ScanResponse | null | undefined) {
  if (!result) return [];

  const directComps = (result.marketValueComps || []).filter(isUsableMarketComp);

  return directComps.length ? directComps : providerMarketComps(result);
}

function currentMarketValueComps(result: ScanResponse | null | undefined) {
  return effectiveMarketValueComps(result).filter(
    (comp) => !isHistoricalSoldComp(comp)
  );
}

function statsFromComps(comps: ActiveComp[]) {
  const prices = comps
    .map((comp) => roundedPositiveMoney(comp.price))
    .filter((price): price is number => price !== null)
    .sort((left, right) => left - right);

  if (!prices.length) {
    return {
      low: null,
      median: null,
      average: null,
      high: null,
      suggestedPrice: null,
    };
  }

  const middle = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 0
      ? (prices[middle - 1] + prices[middle]) / 2
      : prices[middle];
  const average =
    prices.reduce((total, price) => total + price, 0) / prices.length;

  return {
    low: roundedPositiveMoney(prices[0]),
    median: roundedPositiveMoney(median),
    average: roundedPositiveMoney(average),
    high: roundedPositiveMoney(prices[prices.length - 1]),
    suggestedPrice: roundedPositiveMoney(median || average),
  };
}

function effectiveMarketStats(result: ScanResponse | null | undefined) {
  const currentStats = statsFromComps(currentMarketValueComps(result));

  if (roundedPositiveMoney(currentStats.suggestedPrice) !== null) {
    return currentStats;
  }

  return statsFromComps([]);
}

function primaryCompComps(result: ScanResponse | null | undefined) {
  if (!result) return [];

  const soldComps = (result.soldComps || []).filter(isUsableMarketComp);
  const currentSoldComps = soldComps.filter(
    (comp) => !isHistoricalSoldComp(comp)
  );

  if (currentSoldComps.length) return uniqueComps(currentSoldComps);

  return uniqueComps(currentMarketValueComps(result));
}

function primaryCompStats(result: ScanResponse | null | undefined) {
  return statsFromComps(primaryCompComps(result));
}

function primaryCompEvidenceComps(result: ScanResponse | null | undefined) {
  if (!result) return [];

  return uniqueComps([
    ...(result.soldComps || []).filter(isUsableMarketComp),
    ...primaryCompComps(result),
    ...effectiveMarketValueComps(result),
  ]);
}

function primaryCompPriceForCard(card: BatchCard) {
  return (
    roundedPositiveMoney(primaryCompStats(card.result).suggestedPrice) ??
    marketPriceForCard(card)
  );
}

function compPriceBasisForResult(result: ScanResponse | null | undefined) {
  if (!result) return "No comps";

  const soldComps = (result.soldComps || []).filter(isUsableMarketComp);
  const currentSoldComps = soldComps.filter(
    (comp) => !isHistoricalSoldComp(comp)
  );
  const historicalSoldComps = soldComps.filter(isHistoricalSoldComp);

  if (currentSoldComps.length) {
    return `${currentSoldComps.length} current sold comp${
      currentSoldComps.length === 1 ? "" : "s"
    }${
      historicalSoldComps.length
        ? ` / ${historicalSoldComps.length} historical`
        : ""
    }`;
  }

  const comps = primaryCompComps(result);

  if (comps.length) {
    return `${comps.length} current usable comp${comps.length === 1 ? "" : "s"}`;
  }

  if (historicalSoldComps.length) {
    return `${historicalSoldComps.length} historical sold comp${
      historicalSoldComps.length === 1 ? "" : "s"
    } - not priced`;
  }

  return "No usable comps";
}

function marketPriceForCard(card: BatchCard) {
  return (
    roundedPositiveMoney(card.marketPrice) ??
    roundedPositiveMoney(effectiveMarketStats(card.result).suggestedPrice) ??
    roundedPositiveMoney(card.result?.soldStats.suggestedPrice)
  );
}

function draftPriceHandoffForCard(card: BatchCard) {
  const rawPrice = card.customPrice.trim();

  if (rawPrice) {
    return {
      price: roundedPositiveMoney(Number(rawPrice)),
      source: "manual" as const,
    };
  }

  const compPrice = primaryCompPriceForCard(card);

  return {
    price: compPrice,
    source:
      compPrice === null
        ? ("missing" as const)
        : ("instacomp_market" as const),
  };
}

function correctionSnapshotForCard(card: BatchCard): OperatorCorrectionSnapshot {
  const draftPrice = draftPriceHandoffForCard(card);

  return {
    savedAt: new Date().toISOString(),
    savedFrom: "admin_instacomp",
    customTitle: draftTitleForCard(card),
    customSerialNumber: card.customSerialNumber.trim(),
    customQuantity: String(draftQuantityForCard(card)),
    customPrice: card.customPrice.trim(),
    operatorMarkedWrong: Boolean(card.operatorMarkedWrong),
    operatorNeedsMoreInfo: Boolean(card.operatorNeedsMoreInfo),
    listingPrice: draftPrice.price,
    priceSource: draftPrice.source,
  };
}

function scanResultWithOperatorCorrections(card: BatchCard) {
  if (!card.result) return null;

  return {
    ...card.result,
    operatorCorrections: correctionSnapshotForCard(card),
  };
}

function scanResultWithSerialNumber(
  result: ScanResponse | null,
  serialNumber: string | null
) {
  if (!result) return null;

  return {
    ...result,
    ai: {
      ...result.ai,
      serialNumber,
    },
    ocrDiagnostics: result.ocrDiagnostics
      ? {
          ...result.ocrDiagnostics,
          serialVisionSerialNumber: serialNumber,
        }
      : result.ocrDiagnostics,
  };
}

function operatorCorrectionsFromResult(
  result: ScanResponse | null | undefined
): OperatorCorrectionSnapshot | null {
  const corrections = result?.operatorCorrections;

  if (!corrections || typeof corrections !== "object") return null;

  return corrections;
}

function isCorrectionSavableBatchCard(card: BatchCard) {
  return (
    card.status === "done" &&
    Boolean(card.result) &&
    Boolean(card.persistentJobId) &&
    Boolean(card.persistentItemId)
  );
}

function draftListingPriceForCard(card: BatchCard) {
  const handoff = draftPriceHandoffForCard(card);

  if (handoff.price === null) return null;

  return handoff.price;
}

function resetDraftEditsForCard(card: BatchCard) {
  const compPrice = primaryCompPriceForCard(card);

  return {
    ...card,
    customTitle: cardResultTitle(card.result, card.file.name),
    customSerialNumber: card.result?.ai.serialNumber || "",
    customQuantity: "1",
    customPrice: compPrice ? compPrice.toFixed(2) : "",
    draftStatus: card.draftStatus === "error" ? "idle" : card.draftStatus,
    draftError: card.draftStatus === "error" ? null : card.draftError,
  };
}

function draftReadinessErrors(card: BatchCard) {
  const errors: string[] = [];
  const rawQuantity = Number(card.customQuantity);

  if (card.tradeStatus === "created") {
    errors.push("Already available for trade");
  }

  if (!draftTitleForCard(card).trim()) {
    errors.push("Missing draft title");
  }

  if (draftListingPriceForCard(card) === null) {
    errors.push("Missing positive listing price");
  }

  if (!Number.isFinite(rawQuantity) || rawQuantity < 1) {
    errors.push("Quantity must be at least 1");
  }

  return errors;
}

function batchCardReviewWarnings(card: BatchCard) {
  const warnings: string[] = [];
  const hasPairingReview =
    card.backFile &&
    card.pairingConfidence !== null &&
    card.pairingConfidence !== undefined &&
    card.pairingConfidence < 0.6;

  if (card.status === "error") {
    warnings.push("Scan failed");
  }

  if (card.draftStatus === "error") {
    warnings.push("Draft failed");
  }

  if (card.operatorMarkedWrong) {
    warnings.push("Operator marked wrong");
  }

  if (card.operatorNeedsMoreInfo) {
    warnings.push("Operator needs more info");
  }

  if (!card.backFile) {
    warnings.push("Front only");
  }

  if (hasPairingReview) {
    warnings.push("Front/back pairing needs review");
  }

  if (card.status !== "done" || !card.result) {
    return warnings;
  }

  if (card.result.ai.confidence < LOW_CONFIDENCE_THRESHOLD) {
    warnings.push(`Low confidence ${confidenceLabel(card.result.ai.confidence)}`);
  }

  const usableCompCount =
    effectiveMarketValueComps(card.result).length +
    (card.result.soldComps?.length || 0);

  const reviewReasons =
    card.result.queue?.status === "review_required"
      ? card.result.queue.reviewReasons
      : card.result.review?.status === "review_required"
        ? card.result.review.reviewReasons
        : [];

  if (reviewReasons.length) {
    warnings.push(
      ...reviewReasons
        .filter(
          (reason) =>
            (reason !== "front_back_pairing_needs_review" ||
              hasPairingReview) &&
            reason !== "missing_usable_comps"
        )
        .map((reason) => queueReviewReasonLabel(reason))
    );
  }

  if (draftListingPriceForCard(card) === null) {
    warnings.push("No listing price");
  }

  const marketPrice = marketPriceForCard(card);

  if (usableCompCount > 0 && !marketPrice) {
    warnings.push("No market price");
  }

  if (!usableCompCount && !marketPrice) {
    warnings.push("No usable comps");
  }

  return Array.from(new Set(warnings));
}

function queueReviewReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    low_identification_confidence: "Low identification confidence",
    missing_player_or_subject: "Missing player or subject",
    missing_year: "Missing year",
    missing_brand_and_set: "Missing brand/set",
    missing_card_number: "Missing card number",
    parallel_needs_review: "Parallel needs review",
    identity_notes_need_review: "Identity notes need review",
    ocr_variant_signal_not_resolved: "OCR variant signal unresolved",
    front_only_scan: "Front only",
    front_back_pairing_needs_review: "Front/back pairing needs review",
    multi_scanner_consensus_needs_review: "Multi-scanner consensus needs review",
    missing_usable_comps: "Missing usable comps",
    insufficient_exact_comp_evidence: "Insufficient exact comp evidence",
  };

  return labels[reason] || reason.replaceAll("_", " ");
}

function isDraftableBatchCard(card: BatchCard) {
  return (
    card.status === "done" &&
    Boolean(card.result) &&
    card.draftStatus !== "created" &&
    card.draftStatus !== "drafting" &&
    card.tradeStatus !== "created" &&
    card.tradeStatus !== "adding"
  );
}

function isOperatorMarkedProblemBatchCard(card: BatchCard) {
  return (
    card.status === "done" &&
    Boolean(card.result) &&
    Boolean(card.operatorMarkedWrong || card.operatorNeedsMoreInfo)
  );
}

function isTestModelProblemBatchCard(card: BatchCard) {
  return (
    isOperatorMarkedProblemBatchCard(card) ||
    card.status === "error" ||
    card.draftStatus === "error" ||
    batchCardReviewWarnings(card).length > 0 ||
    (isDraftableBatchCard(card) && draftReadinessErrors(card).length > 0)
  );
}

function testModelRunProblemCounts(cards: BatchCard[]) {
  return {
    problemRows: cards.filter(isTestModelProblemBatchCard).length,
    scanFailures: cards.filter((card) => card.status === "error").length,
    draftFailures: cards.filter((card) => card.draftStatus === "error").length,
    reviewRows: cards.filter((card) => batchCardReviewWarnings(card).length > 0)
      .length,
    fixRows: cards.filter(
      (card) => isDraftableBatchCard(card) && draftReadinessErrors(card).length > 0
    ).length,
  };
}

function batchCardMatchesFilter(card: BatchCard, filter: BatchCardFilter) {
  if (filter === "selected") {
    return (
      card.selected &&
      (isDraftableBatchCard(card) ||
        (card.status === "done" && Boolean(card.result)))
    );
  }
  if (filter === "problems") return isTestModelProblemBatchCard(card);
  if (filter === "draftable") return isDraftableBatchCard(card);
  if (filter === "ready") {
    return isDraftableBatchCard(card) && draftReadinessErrors(card).length === 0;
  }
  if (filter === "ready_review") {
    return (
      isDraftableBatchCard(card) &&
      draftReadinessErrors(card).length === 0 &&
      batchCardReviewWarnings(card).length > 0
    );
  }
  if (filter === "clean") {
    return isDraftableBatchCard(card) && batchCardReviewWarnings(card).length === 0;
  }
  if (filter === "clean_ready") {
    return (
      isDraftableBatchCard(card) &&
      batchCardReviewWarnings(card).length === 0 &&
      draftReadinessErrors(card).length === 0
    );
  }
  if (filter === "clean_fix") {
    return (
      isDraftableBatchCard(card) &&
      batchCardReviewWarnings(card).length === 0 &&
      draftReadinessErrors(card).length > 0
    );
  }
  if (filter === "review") return batchCardReviewWarnings(card).length > 0;
  if (filter === "review_fix") {
    return (
      isDraftableBatchCard(card) &&
      batchCardReviewWarnings(card).length > 0 &&
      draftReadinessErrors(card).length > 0
    );
  }
  if (filter === "fix") {
    return isDraftableBatchCard(card) && draftReadinessErrors(card).length > 0;
  }
  if (filter === "errors") return card.status === "error";
  if (filter === "draft_errors") return card.draftStatus === "error";
  if (filter === "drafted") return card.draftStatus === "created";
  if (filter === "active") {
    return card.status === "queued" || card.status === "scanning";
  }

  return true;
}

function batchCardMatchesSearch(card: BatchCard, query: string) {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  if (!terms.length) return true;

  const ai = card.result?.ai;
  const searchableText = [
    draftTitleForCard(card),
    card.file.name,
    card.backFile?.name,
    card.status,
    card.draftStatus,
    card.draftSku,
    ...batchCardReviewWarnings(card),
    ...draftReadinessErrors(card),
    card.error,
    card.draftError,
    card.result?.searchQuery,
    ai?.player,
    ai?.year,
    ai?.brand,
    ai?.setName,
    ai?.cardNumber,
    ai?.parallel,
    ai?.serialNumber,
    ai?.team,
    ai?.sport,
    ai?.conditionGuess,
    ai?.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return terms.every((term) => searchableText.includes(term));
}

function batchCardStatusRank(card: BatchCard) {
  if (card.status === "error") return 0;
  if (card.status === "scanning") return 1;
  if (card.status === "queued") return 2;
  if (card.draftStatus === "error") return 3;
  if (isDraftableBatchCard(card)) return 4;
  if (card.draftStatus === "created") return 5;

  return 6;
}

function compareNullableNumbers(
  left: number | null | undefined,
  right: number | null | undefined,
  direction: "asc" | "desc",
) {
  const leftMissing = left === null || left === undefined || Number.isNaN(left);
  const rightMissing = right === null || right === undefined || Number.isNaN(right);

  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;

  return direction === "asc" ? left - right : right - left;
}

function compareBatchCards(
  left: { card: BatchCard; index: number },
  right: { card: BatchCard; index: number },
  sort: BatchCardSort,
) {
  let result = 0;

  if (sort === "status") {
    result =
      batchCardStatusRank(left.card) - batchCardStatusRank(right.card) ||
      draftTitleForCard(left.card).localeCompare(draftTitleForCard(right.card));
  } else if (sort === "title") {
    result = draftTitleForCard(left.card).localeCompare(draftTitleForCard(right.card));
  } else if (sort === "market_high") {
    result = compareNullableNumbers(
      marketPriceForCard(left.card),
      marketPriceForCard(right.card),
      "desc",
    );
  } else if (sort === "market_low") {
    result = compareNullableNumbers(
      marketPriceForCard(left.card),
      marketPriceForCard(right.card),
      "asc",
    );
  } else if (sort === "confidence_low") {
    result = compareNullableNumbers(
      left.card.result?.ai.confidence,
      right.card.result?.ai.confidence,
      "asc",
    );
  } else if (sort === "confidence_high") {
    result = compareNullableNumbers(
      left.card.result?.ai.confidence,
      right.card.result?.ai.confidence,
      "desc",
    );
  }

  return result || left.index - right.index;
}

function batchFileBaseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "");
}

function cleanRotationFileBaseName(baseName: string) {
  return baseName.replace(/(?:-rotated-(?:left|right)-45)+$/gi, "") || "card";
}

function cleanRotationFileName(fileName: string) {
  const fallback = fileName || "card.jpg";
  const dotIndex = fallback.lastIndexOf(".");
  const baseName = dotIndex > 0 ? fallback.slice(0, dotIndex) : fallback;
  const extension = dotIndex > 0 ? fallback.slice(dotIndex) : ".jpg";

  return `${cleanRotationFileBaseName(baseName)}${extension || ".jpg"}`;
}

function batchFileSignature(file: File | null | undefined) {
  if (!file) return "none";

  return `${file.name.toLowerCase()}-${file.size}-${file.lastModified}`;
}

function batchPairSignature(pair: BatchPair) {
  return `${batchFileSignature(pair.front.file)}|${batchFileSignature(pair.back?.file)}`;
}

function batchCardSignature(card: BatchCard) {
  return `${batchFileSignature(card.file)}|${batchFileSignature(card.backFile)}`;
}

function batchImageCandidate(file: File, originalIndex: number): BatchImageCandidate {
  const baseName = batchFileBaseName(file.name);
  const tokens = baseName
    .toLowerCase()
    .split(/[\s._-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const lastToken = tokens[tokens.length - 1] || "";
  const frontTokens = new Set(["front", "fr", "f", "obverse"]);
  const backTokens = new Set(["back", "bk", "b", "reverse", "rear"]);
  let side: BatchImageSide = "unknown";

  if (tokens.length > 1 && frontTokens.has(lastToken)) {
    side = "front";
  }

  if (tokens.length > 1 && backTokens.has(lastToken)) {
    side = "back";
  }

  const keyTokens = side === "unknown" ? tokens : tokens.slice(0, -1);
  const pairKey = keyTokens.join("-") || baseName.toLowerCase();

  return {
    file,
    side,
    pairKey,
    originalIndex,
  };
}

function buildBatchPairs(files: File[]) {
  const grouped = new Map<
    string,
    { fronts: BatchImageCandidate[]; backs: BatchImageCandidate[] }
  >();
  const unknownCandidates: BatchImageCandidate[] = [];
  const pairs: BatchPair[] = [];
  let skippedBackOnly = 0;
  let orderPairedCount = 0;

  files.forEach((file, originalIndex) => {
    const candidate = batchImageCandidate(file, originalIndex);

    if (candidate.side === "unknown") {
      unknownCandidates.push(candidate);
      return;
    }

    const group = grouped.get(candidate.pairKey) || { fronts: [], backs: [] };

    if (candidate.side === "front") {
      group.fronts.push(candidate);
    } else {
      group.backs.push(candidate);
    }

    grouped.set(candidate.pairKey, group);
  });

  grouped.forEach((group) => {
    const fronts = group.fronts.sort((left, right) => left.originalIndex - right.originalIndex);
    const backs = group.backs.sort((left, right) => left.originalIndex - right.originalIndex);

    fronts.forEach((front, index) => {
      const back = backs[index] || null;

      pairs.push({
        front,
        back,
        sortIndex: Math.min(front.originalIndex, back?.originalIndex ?? front.originalIndex),
        pairingConfidence: back ? 1 : null,
        pairingMethod: back ? "filename" : "front_only",
      });
    });

    skippedBackOnly += Math.max(0, backs.length - fronts.length);
  });

  const unknownByOrder = unknownCandidates.sort(
    (left, right) => left.originalIndex - right.originalIndex,
  );

  for (let index = 0; index < unknownByOrder.length; index += 2) {
    const front = unknownByOrder[index];
    const back = unknownByOrder[index + 1] || null;

    if (back) orderPairedCount += 1;

    pairs.push({
      front,
      back,
      sortIndex: front.originalIndex,
      pairingConfidence: back ? 0.65 : null,
      pairingMethod: back ? "upload_order" : "front_only",
    });
  }

  return {
    pairs: pairs.sort((left, right) => left.sortIndex - right.sortIndex),
    skippedBackOnly,
    orderPairedCount,
  };
}

const sourceCategoryLabels: Record<SourceCoverageItem["category"], string> = {
  sold: "Sold Comps",
  marketplace: "Marketplaces",
  auction: "Auction Houses",
  pricing: "Pricing Guidance",
  reference: "Checklist / Reference",
  broad: "Broad Web",
};

type SerialDetailCropSpec = {
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  enhance?: "contrast" | "invert";
};

const SERIAL_DETAIL_CROP_SPECS: SerialDetailCropSpec[] = [
  { label: "top-right-stamp", x: 0.52, y: 0, width: 0.48, height: 0.24 },
  {
    label: "top-right-stamp-contrast",
    x: 0.52,
    y: 0,
    width: 0.48,
    height: 0.24,
    enhance: "contrast",
  },
  {
    label: "top-right-stamp-inverted",
    x: 0.52,
    y: 0,
    width: 0.48,
    height: 0.24,
    enhance: "invert",
  },
  { label: "top-band", x: 0, y: 0, width: 1, height: 0.28 },
  {
    label: "top-band-contrast",
    x: 0,
    y: 0,
    width: 1,
    height: 0.28,
    enhance: "contrast",
  },
  { label: "right-edge", x: 0.6, y: 0, width: 0.4, height: 0.58 },
  {
    label: "right-edge-contrast",
    x: 0.6,
    y: 0,
    width: 0.4,
    height: 0.58,
    enhance: "contrast",
  },
  { label: "bottom-right-stamp", x: 0.5, y: 0.58, width: 0.5, height: 0.42 },
  {
    label: "bottom-right-stamp-contrast",
    x: 0.5,
    y: 0.58,
    width: 0.5,
    height: 0.42,
    enhance: "contrast",
  },
  { label: "bottom-band", x: 0, y: 0.64, width: 1, height: 0.36 },
  { label: "full-card", x: 0, y: 0, width: 1, height: 1 },
];

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Could not load ${file.name} for detail crops.`));
    };
    image.src = url;
  });
}

async function canvasToJpegFile(
  canvas: HTMLCanvasElement,
  fileName: string,
  options: { initialQuality?: number; maxBytes?: number } = {}
): Promise<File> {
  let quality = options.initialQuality ?? 0.86;
  let blob: Blob | null = null;

  do {
    blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );

    if (!blob || !options.maxBytes || blob.size <= options.maxBytes) break;
    quality -= 0.08;
  } while (quality >= 0.5);

  if (!blob) {
    throw new Error(`Could not create detail crop ${fileName}.`);
  }

  return new File([blob], fileName, { type: "image/jpeg" });
}

const IMAGE_ROTATION_STEP_DEGREES = 45;

function normalizeRotationDegrees(value: number) {
  return ((Math.round(value) % 360) + 360) % 360;
}

function originalRotationFileName(file: File) {
  return cleanRotationFileName(file.name || "card.jpg");
}

function cleanRotationFile(file: File) {
  const cleanName = originalRotationFileName(file);

  if (file.name === cleanName) return file;

  return new File([file], cleanName, {
    type: file.type || "image/jpeg",
    lastModified: file.lastModified,
  });
}

function nextRotationDegrees(current: number | null | undefined, direction: "left" | "right") {
  return normalizeRotationDegrees(
    (current || 0) + (direction === "left" ? -IMAGE_ROTATION_STEP_DEGREES : IMAGE_ROTATION_STEP_DEGREES)
  );
}

async function rotateImageFile(file: File, degrees: number) {
  const normalizedDegrees = normalizeRotationDegrees(degrees);

  if (normalizedDegrees === 0) return cleanRotationFile(file);

  const image = await loadImageElement(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;

  if (!sourceWidth || !sourceHeight) return file;

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) return file;

  const radians = normalizedDegrees * (Math.PI / 180);
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const outputWidth = Math.ceil(sourceWidth * cos + sourceHeight * sin);
  const outputHeight = Math.ceil(sourceWidth * sin + sourceHeight * cos);

  canvas.width = outputWidth;
  canvas.height = outputHeight;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(radians);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, -sourceWidth / 2, -sourceHeight / 2);

  return canvasToJpegFile(canvas, originalRotationFileName(file), {
    initialQuality: 0.92,
  });
}

function enhanceSerialCrop(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  mode: SerialDetailCropSpec["enhance"]
) {
  if (!mode) return;

  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const contrast = 2.35;

  for (let index = 0; index < data.length; index += 4) {
    const gray = Math.round(
      data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
    );
    const contrasted = Math.max(
      0,
      Math.min(255, Math.round((gray - 128) * contrast + 128))
    );
    const value = mode === "invert" ? 255 - contrasted : contrasted;

    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
  }

  context.putImageData(imageData, 0, 0);
}

async function createSerialDetailCrops(file: File, side: "front" | "back") {
  try {
    const image = await loadImageElement(file);
    const crops: File[] = [];
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;

    if (!sourceWidth || !sourceHeight) return crops;

    const cropJobs = SERIAL_DETAIL_CROP_SPECS.map(async (spec) => {
      const sourceX = Math.round(sourceWidth * spec.x);
      const sourceY = Math.round(sourceHeight * spec.y);
      const cropWidth = Math.max(1, Math.round(sourceWidth * spec.width));
      const cropHeight = Math.max(1, Math.round(sourceHeight * spec.height));
      const outputWidth = Math.min(1800, Math.max(cropWidth * 1.75, 1200));
      const outputHeight = Math.round(outputWidth * (cropHeight / cropWidth));
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) return null;

      canvas.width = outputWidth;
      canvas.height = outputHeight;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        image,
        sourceX,
        sourceY,
        cropWidth,
        cropHeight,
        0,
        0,
        outputWidth,
        outputHeight
      );
      enhanceSerialCrop(context, outputWidth, outputHeight, spec.enhance);

      return canvasToJpegFile(
        canvas,
        `${side}-serial-detail-${spec.label}-${file.name || "card"}.jpg`,
        {
          initialQuality: spec.enhance ? 0.8 : 0.84,
          maxBytes: MAX_DETAIL_CROP_BYTES,
        }
      );
    });

    const cropResults = await Promise.all(cropJobs);

    crops.push(...cropResults.filter((crop): crop is File => Boolean(crop)));

    return crops;
  } catch (error) {
    console.warn("InstaComp™ detail crop generation failed:", error);
    return [];
  }
}

const optimizedScanImageCache = new WeakMap<File, Promise<File>>();
const optimizedPersistentImageCache = new WeakMap<File, Promise<File>>();

function optimizedImageName(file: File) {
  const baseName = file.name.replace(/\.[^.]+$/, "") || "card";
  return `${baseName}-instacomp.jpg`;
}

async function optimizeScanImageUncached(file: File) {
  const image = await loadImageElement(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;

  if (!sourceWidth || !sourceHeight) return file;

  const scale = Math.min(
    1,
    MAX_SCAN_IMAGE_DIMENSION / Math.max(sourceWidth, sourceHeight)
  );
  let outputWidth = Math.max(1, Math.round(sourceWidth * scale));
  let outputHeight = Math.max(1, Math.round(sourceHeight * scale));
  let quality = 0.9;
  let optimized: File | null = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!context) return file;

    canvas.width = outputWidth;
    canvas.height = outputHeight;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, outputWidth, outputHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, outputWidth, outputHeight);

    optimized = await canvasToJpegFile(canvas, optimizedImageName(file), {
      initialQuality: quality,
      maxBytes: MAX_SCAN_IMAGE_BYTES,
    });

    if (optimized.size <= MAX_SCAN_IMAGE_BYTES) break;

    const reducedScale = Math.max(
      0.55,
      Math.min(0.86, 1400 / Math.max(outputWidth, outputHeight))
    );
    outputWidth = Math.max(1, Math.round(outputWidth * reducedScale));
    outputHeight = Math.max(1, Math.round(outputHeight * reducedScale));
    quality = Math.max(0.58, quality - 0.06);
  }

  return optimized || file;
}

async function optimizeScanImage(file: File) {
  const cached = optimizedScanImageCache.get(file);

  if (cached) return cached;

  const pending = optimizeScanImageUncached(file).catch((error) => {
    console.warn("InstaComp™ image optimization failed:", error);
    return file;
  });

  optimizedScanImageCache.set(file, pending);
  return pending;
}

async function preparePersistentStorageImage(file: File) {
  const cached = optimizedPersistentImageCache.get(file);

  if (cached) return cached;

  const pending = (async () => {
    const supportedType = ["image/jpeg", "image/png", "image/webp"].includes(
      file.type.toLowerCase(),
    );
    const image = await loadImageElement(file);
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;

    if (
      supportedType &&
      file.size <= MAX_PERSISTENT_SOURCE_IMAGE_BYTES &&
      Math.max(sourceWidth, sourceHeight) <= MAX_PERSISTENT_IMAGE_DIMENSION
    ) {
      return file;
    }

    if (!sourceWidth || !sourceHeight) {
      throw new Error(`Could not read ${file.name} before private upload.`);
    }

    const scale = Math.min(
      1,
      MAX_PERSISTENT_IMAGE_DIMENSION / Math.max(sourceWidth, sourceHeight),
    );
    let outputWidth = Math.max(1, Math.round(sourceWidth * scale));
    let outputHeight = Math.max(1, Math.round(sourceHeight * scale));
    let quality = 0.88;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error(`Could not prepare ${file.name} for private upload.`);
      }

      canvas.width = outputWidth;
      canvas.height = outputHeight;
      context.fillStyle = "#fff";
      context.fillRect(0, 0, outputWidth, outputHeight);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, outputWidth, outputHeight);

      const optimized = await canvasToJpegFile(
        canvas,
        optimizedImageName(file),
        {
          initialQuality: quality,
          maxBytes: MAX_PERSISTENT_SOURCE_IMAGE_BYTES,
        },
      );

      if (optimized.size <= MAX_PERSISTENT_SOURCE_IMAGE_BYTES) {
        return optimized;
      }

      outputWidth = Math.max(1, Math.round(outputWidth * 0.84));
      outputHeight = Math.max(1, Math.round(outputHeight * 0.84));
      quality = Math.max(0.58, quality - 0.05);
    }

    throw new Error(
      `${file.name} could not be reduced below the private-upload limit.`,
    );
  })();

  optimizedPersistentImageCache.set(file, pending);
  return pending;
}

async function sha256File(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

let instaCompUploadClient: SupabaseClient | null = null;

function getInstaCompUploadClient() {
  if (instaCompUploadClient) return instaCompUploadClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase browser upload settings are missing.");
  }

  instaCompUploadClient = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return instaCompUploadClient;
}

export default function InstaCompScanner({
  testMode = false,
}: InstaCompScannerProps) {
  const [frontImage, setFrontImage] = useState<File | null>(null);
  const [backImage, setBackImage] = useState<File | null>(null);
  const [frontOriginalImage, setFrontOriginalImage] = useState<File | null>(null);
  const [backOriginalImage, setBackOriginalImage] = useState<File | null>(null);
  const [frontRotationDegrees, setFrontRotationDegrees] = useState(0);
  const [backRotationDegrees, setBackRotationDegrees] = useState(0);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [backPreview, setBackPreview] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedPrice, setCopiedPrice] = useState<string | null>(null);
  const [batchCards, setBatchCards] = useState<BatchCard[]>([]);
  const [activeBatchCardAction, setActiveBatchCardAction] =
    useState<ActiveBatchCardAction | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchDrafting, setBatchDrafting] = useState(false);
  const [removingBatchCardIds, setRemovingBatchCardIds] = useState<Set<string>>(
    () => new Set()
  );
  const removingBatchCardIdsRef = useRef<Set<string>>(new Set());
  const quantityMergeRunningRef = useRef(false);
  const [batchKnowledgeSaving, setBatchKnowledgeSaving] = useState(false);
  const [batchConcurrency, setBatchConcurrency] = useState(
    INSTACOMP_BATCH_DEFAULT_CONCURRENCY
  );
  const [aiCouncilTier, setAiCouncilTier] =
    useState<AiCouncilTier>("adaptive");
  const [batchFilter, setBatchFilter] = useState<BatchCardFilter>("all");
  const [batchSort, setBatchSort] = useState<BatchCardSort>("original");
  const [batchSearch, setBatchSearch] = useState("");
  const [selectedBatchQuantity, setSelectedBatchQuantity] = useState("1");
  const [selectedBatchFixedPrice, setSelectedBatchFixedPrice] = useState("");
  const [batchPauseRequested, setBatchPauseRequested] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchDraftMessage, setBatchDraftMessage] = useState<string | null>(null);
  const [persistentJob, setPersistentJob] =
    useState<PersistentJobSummary | null>(null);
  const [persistentJobPreparing, setPersistentJobPreparing] = useState(false);
  const [persistentUploadProgress, setPersistentUploadProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [testModelChecks, setTestModelChecks] = useState<TestModelCheck[]>([]);
  const [testModelCheckScenario, setTestModelCheckScenario] =
    useState<TestModelCheckScenario>("completed_matrix");
  const [testModelRunRecords, setTestModelRunRecords] = useState<
    TestModelRunRecord[]
  >([]);
  const [testModelRunRecordsLoaded, setTestModelRunRecordsLoaded] =
    useState(!testMode);
  const batchPauseRequestedRef = useRef(false);
  const databasePressurePauseRef = useRef(false);
  const openAIRateLimitPauseRef = useRef(false);
  const batchPreviewUrlsRef = useRef<string[]>([]);
  const persistentBindingsRef = useRef<Map<string, PersistentJobBinding>>(
    new Map()
  );
  const batchCardAbortControllersRef = useRef<Map<string, AbortController>>(
    new Map()
  );
  const removedBatchCardIdsRef = useRef<Set<string>>(new Set());
  const removedPersistentItemIdsRef = useRef<Set<string>>(new Set());
  const removedPersistentClientIdsRef = useRef<Set<string>>(new Set());
  const serialOverrideByItemIdRef = useRef<Map<string, string | null>>(
    new Map()
  );
  const persistentClientBatchIdRef = useRef<string | null>(null);

  useEffect(() => {
    const previewUrls = batchPreviewUrlsRef.current;
    const abortControllers = batchCardAbortControllersRef.current;

    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
      abortControllers.forEach((controller) => controller.abort());
      abortControllers.clear();
    };
  }, []);

  useEffect(() => {
    if (testMode) return;

    let cancelled = false;

    async function recoverLastPersistentJob() {
      let jobId: string | null = null;

      try {
        jobId = window.localStorage.getItem(INSTACOMP_LAST_JOB_STORAGE_KEY);
      } catch {
        return;
      }

      try {
        async function newestRecoverableJobId() {
          const listResponse = await fetchWithFreshAccountSession(
            "/api/instacomp/jobs?limit=25",
          );
          const listData = await listResponse.json().catch(() => ({}));

          if (!listResponse.ok) return null;

          const recoverable = (Array.isArray(listData.jobs)
            ? listData.jobs
            : []
          ).find((job: any) =>
            [
              "uploading",
              "queued",
              "processing",
              "cancelling",
            ].includes(String(job.status))
          );

          return recoverable?.id || null;
        }

        if (!jobId) {
          jobId = await newestRecoverableJobId();
        }

        if (!jobId) return;

        async function loadPersistentJob(targetJobId: string) {
          const items: any[] = [];
          let afterPosition = -1;
          let jobData: any = null;

          for (let page = 0; page < 20; page += 1) {
            const pageResponse = await fetchWithFreshAccountSession(
              `/api/instacomp/jobs/${targetJobId}?limit=25&afterPosition=${afterPosition}&includeRecovery=true`,
            );
            const pageData = await pageResponse.json().catch(() => ({}));

            if (!pageResponse.ok) {
              return {
                ok: false,
                status: pageResponse.status,
                data: pageData,
              };
            }

            jobData = pageData.job;
            items.push(...(Array.isArray(pageData.items) ? pageData.items : []));

            if (!pageData.hasMore || pageData.nextPosition === null) break;
            afterPosition = Number(pageData.nextPosition);
          }

          return {
            ok: true,
            status: 200,
            data: { job: jobData, items },
          };
        }

        let loaded = await loadPersistentJob(jobId!);

        if (!loaded.ok && loaded.status === 404) {
          const fallbackJobId = await newestRecoverableJobId();

          if (fallbackJobId && fallbackJobId !== jobId) {
            jobId = fallbackJobId;
            loaded = await loadPersistentJob(jobId!);
          }
        }

        if (!loaded.ok) {
          throw new Error(
            loaded.data?.error || "Could not recover the last scan job."
          );
        }

        const data = loaded.data;

        if (cancelled) return;

        let job = data.job as PersistentJobSummary;
        if (
          !["uploading", "queued", "processing", "cancelling"].includes(
            String(job.status)
          )
        ) {
          try {
            window.localStorage.removeItem(INSTACOMP_LAST_JOB_STORAGE_KEY);
          } catch {
            // Local recovery is optional; terminal lots should not block new work.
          }
          return;
        }

        window.localStorage.setItem(INSTACOMP_LAST_JOB_STORAGE_KEY, job.id);
        const returnedItems = Array.isArray(data.items) ? data.items : [];
        const recoveredItems = returnedItems.filter(
          (item: any) => String(item.status) !== "cancelled"
        );
        const hiddenCancelledCount = returnedItems.length - recoveredItems.length;

        if (
          job.status === "uploading" &&
          returnedItems.length === Number(job.total_items)
        ) {
          try {
            for (
              let start = 0;
              start < returnedItems.length;
              start += INSTACOMP_JOB_ITEM_CHUNK_SIZE
            ) {
              const chunk = returnedItems.slice(
                start,
                start + INSTACOMP_JOB_ITEM_CHUNK_SIZE
              );
              const confirmResponse = await fetchWithFreshAccountSession(
                `/api/instacomp/jobs/${job.id}/items`,
                {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    itemIds: chunk.map((item: any) => item.id),
                  }),
                }
              );

              if (!confirmResponse.ok) {
                throw new Error(
                  "One or more card images did not finish uploading before the interruption."
                );
              }
            }

            const queueResponse = await fetchWithFreshAccountSession(
              `/api/instacomp/jobs/${job.id}`,
              {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ status: "queued" }),
              }
            );
            const queueData = await queueResponse.json().catch(() => ({}));

            if (!queueResponse.ok) {
              throw new Error(
                queueData?.error || "Could not resume the uploaded scan job."
              );
            }

            job = queueData.job as PersistentJobSummary;
          } catch (error: any) {
            setBatchError(
              `${error?.message || "Upload recovery is incomplete"} Clear this saved lot and reselect the original images to start a clean replacement job.`
            );
          }
        } else if (
          job.status === "uploading" &&
          returnedItems.length < Number(job.total_items)
        ) {
          setBatchError(
            `Recovered ${returnedItems.length}/${job.total_items} registered rows. The interruption happened before every row was registered; clear this saved lot and reselect the original images.`
          );
        }

        const bindings = new Map<string, PersistentJobBinding>();
        const recoveredCards = recoveredItems.map(
          (item: any): BatchCard => {
            const cardId = `persistent-${item.id}`;
            const storedResult =
              item.result_payload &&
              typeof item.result_payload === "object" &&
              item.result_payload.ok
                ? (item.result_payload as ScanResponse)
                : null;
            const isDone = ["completed", "review_required"].includes(
              String(item.status)
            );
            const isFailed = ["failed", "retry_wait"].includes(
              String(item.status)
            );
            const frontFile = new File(
              [],
              item.front_original_filename || "recovered-front.jpg",
              { type: item.front_content_type || "image/jpeg" }
            );
            const backFile = item.back_storage_path
              ? new File(
                  [],
                  item.back_original_filename || "recovered-back.jpg",
                  { type: item.back_content_type || "image/jpeg" }
                )
              : null;
            const frontUrl =
              item.recovery?.front?.downloadUrl || EMPTY_CARD_PREVIEW;
            const backUrl = item.recovery?.back?.downloadUrl || null;
            const effectiveStats = effectiveMarketStats(storedResult);
            const effectiveSuggestedPrice =
              effectiveStats.suggestedPrice ??
              (Number.isFinite(Number(item.suggested_price))
                ? Number(item.suggested_price)
                : null);
            const savedCorrections = operatorCorrectionsFromResult(storedResult);

            bindings.set(cardId, {
              jobId: job.id,
              itemId: item.id,
              clientItemId: item.client_item_id,
              frontStoragePath: item.front_storage_path,
              backStoragePath: item.back_storage_path || null,
            });

            return {
              id: cardId,
              file: frontFile,
              backFile,
              originalFile: frontFile,
              originalBackFile: backFile,
              frontRotationDegrees: 0,
              backRotationDegrees: 0,
              previewUrl: frontUrl,
              backPreviewUrl: backUrl,
              status: isDone && storedResult ? "done" : isFailed ? "error" : "queued",
              selected: !item.draft_inventory_item_id,
              operatorMarkedWrong: Boolean(savedCorrections?.operatorMarkedWrong),
              operatorNeedsMoreInfo: Boolean(savedCorrections?.operatorNeedsMoreInfo),
              result: storedResult,
              marketPrice: effectiveSuggestedPrice,
              customTitle:
                savedCorrections?.customTitle ||
                (storedResult
                  ? cardResultTitle(
                      storedResult,
                      item.front_original_filename || "Recovered card"
                    )
                  : ""),
              customSerialNumber:
                savedCorrections?.customSerialNumber ?? storedResult?.ai.serialNumber ?? "",
              customQuantity: savedCorrections?.customQuantity || "1",
              customPrice:
                savedCorrections?.customPrice ??
                (effectiveSuggestedPrice != null
                  ? Number(effectiveSuggestedPrice).toFixed(2)
                  : ""),
              error: isFailed
                ? item.last_error || "Queued scan needs another attempt."
                : null,
              draftStatus: item.draft_inventory_item_id ? "created" : "idle",
              draftError: null,
              draftInventoryItemId: item.draft_inventory_item_id || null,
              draftLegacyProductId: null,
              draftSku: null,
              tradeStatus: item.trade_collection_item_id ? "created" : "idle",
              tradeError: null,
              tradeCollectionItemId: item.trade_collection_item_id || null,
              persistentClientId: item.client_item_id,
              persistentJobId: job.id,
              persistentItemId: item.id,
              knowledgeEntryId: null,
              knowledgeSavedAt: null,
              knowledgeTrustStatus: null,
              knowledgeConfirmedCount: null,
              frontStoragePath: item.front_storage_path,
              backStoragePath: item.back_storage_path || null,
              pairingConfidence:
                item.pairing_confidence === null ||
                item.pairing_confidence === undefined
                  ? null
                  : Number(item.pairing_confidence),
              pairingMethod:
                item.back_storage_path && Number(item.pairing_confidence) < 0.9
                  ? "upload_order"
                  : item.back_storage_path
                    ? "filename"
                    : "front_only",
              scanQueuedAt: item.created_at || null,
              scanStartedAt: item.processing_started_at || null,
              scanCompletedAt: item.processed_at || item.updated_at || null,
              scanElapsedMs: null,
            };
          }
        );

        persistentBindingsRef.current = bindings;
        persistentClientBatchIdRef.current = job.client_batch_id || null;
        setPersistentJob(job);
        setBatchCards(recoveredCards);
        setBatchDraftMessage(
          `Recovered InstaComp™ job ${job.id.slice(0, 8)} with ${recoveredCards.length} card row${
            recoveredCards.length === 1 ? "" : "s"
          }${hiddenCancelledCount ? `; kept ${hiddenCancelledCount} removed row${
            hiddenCancelledCount === 1 ? "" : "s"
          } hidden.` : ""}.`
        );
      } catch (error: any) {
        if (!cancelled) {
          setBatchError(error?.message || "Could not recover the last scan job.");
        }
      }
    }

    void recoverLastPersistentJob();

    return () => {
      cancelled = true;
    };
  }, [testMode]);

  useEffect(() => {
    if (!testMode) return;

    try {
      const storedRecords = window.localStorage.getItem(
        TEST_MODEL_RUN_LEDGER_STORAGE_KEY
      );

      if (storedRecords) {
        setTestModelRunRecords(
          cleanStoredTestModelRunRecords(JSON.parse(storedRecords))
        );
      }
    } catch {
      try {
        window.localStorage.removeItem(TEST_MODEL_RUN_LEDGER_STORAGE_KEY);
      } catch {
        // Ignore storage cleanup failures in restricted browser modes.
      }
    } finally {
      setTestModelRunRecordsLoaded(true);
    }
  }, [testMode]);

  useEffect(() => {
    if (!testMode || !testModelRunRecordsLoaded) return;

    try {
      window.localStorage.setItem(
        TEST_MODEL_RUN_LEDGER_STORAGE_KEY,
        JSON.stringify(testModelRunRecords)
      );
    } catch {
      // The test ledger is helpful, but it should never block scanner work.
    }
  }, [testMode, testModelRunRecordsLoaded, testModelRunRecords]);

  const marketPlus10 = useMemo(() => {
    const suggestedPrice = effectiveMarketStats(result).suggestedPrice;

    if (!suggestedPrice) return null;

    return Math.round(suggestedPrice * 1.1 * 100) / 100;
  }, [result]);

  const marketMinus10 = useMemo(() => {
    const suggestedPrice = effectiveMarketStats(result).suggestedPrice;

    if (!suggestedPrice) return null;

    return Math.round(suggestedPrice * 0.9 * 100) / 100;
  }, [result]);

  const batchDoneCount = batchCards.filter((card) => card.status === "done").length;
  const batchErrorCount = batchCards.filter(
    (card) => card.status === "error"
  ).length;
  const batchRateLimitErrorCards = batchCards.filter(
    (card) => card.status === "error" && isOpenAIRateLimitText(card.error)
  );
  const batchRateLimitErrorCount = batchRateLimitErrorCards.length;
  const batchRateLimitErrorBatchCardIds = new Set(
    batchRateLimitErrorCards.map((card) => card.id)
  );
  const batchOperatorMarkedWrongCards = batchCards.filter(
    isOperatorMarkedProblemBatchCard
  );
  const batchOperatorMarkedWrongCount = batchOperatorMarkedWrongCards.length;
  const batchOperatorMarkedWrongCardIds = new Set(
    batchOperatorMarkedWrongCards.map((card) => card.id)
  );
  const batchScanningCount = batchCards.filter(
    (card) => card.status === "scanning"
  ).length;
  const batchCompleteCount = batchDoneCount + batchErrorCount;
  const selectedDoneBatchCards = batchCards.filter(
    (card) => card.selected && isDraftableBatchCard(card)
  );
  const selectedReviewableBatchCards = batchCards.filter(
    (card) => card.selected && card.status === "done" && Boolean(card.result)
  );
  const selectedSavableCorrectionCards = batchCards.filter(
    (card) => card.selected && isCorrectionSavableBatchCard(card)
  );
  const selectedSavableCorrectionCount = selectedSavableCorrectionCards.length;
  const selectedRefreshableCompCards = selectedSavableCorrectionCards;
  const selectedRefreshableCompCount = selectedRefreshableCompCards.length;
  const selectedOperatorMarkedProblemCount = batchCards.filter(
    (card) => card.selected && isOperatorMarkedProblemBatchCard(card)
  ).length;
  const selectedOperatorMarkedProblemBatchCardIds = new Set(
    batchCards
      .filter((card) => card.selected && isOperatorMarkedProblemBatchCard(card))
      .map((card) => card.id)
  );
  const selectedPriceableBatchCards = selectedDoneBatchCards.filter(
    (card) => primaryCompPriceForCard(card)
  );
  const batchDraftableCount = batchCards.filter(isDraftableBatchCard).length;
  const batchDraftCreatedCount = batchCards.filter(
    (card) => card.draftStatus === "created"
  ).length;
  const batchKnowledgeSavedCount = batchCards.filter(
    (card) => card.knowledgeEntryId
  ).length;
  const batchKnowledgeTrustedCount = batchCards.filter(
    (card) => card.knowledgeTrustStatus === "tcos_trusted"
  ).length;
  const batchCreatedInstaCompDraftHref = batchDraftCreatedCount
    ? sellerInventoryInstaCompDraftHref()
    : null;
  const batchDraftErrorCount = batchCards.filter(
    (card) => card.draftStatus === "error"
  ).length;
  const batchReviewCount = batchCards.filter(
    (card) => batchCardReviewWarnings(card).length > 0
  ).length;
  const batchDraftFixCount = batchCards.filter(
    (card) => isDraftableBatchCard(card) && draftReadinessErrors(card).length > 0
  ).length;
  const readyDraftableBatchCardIds = new Set(
    batchCards
      .filter(
        (card) =>
          isDraftableBatchCard(card) && draftReadinessErrors(card).length === 0
      )
      .map((card) => card.id)
  );
  const readyDraftableCount = readyDraftableBatchCardIds.size;
  const readyReviewCount = batchCards.filter(
    (card) =>
      readyDraftableBatchCardIds.has(card.id) &&
      batchCardReviewWarnings(card).length > 0
  ).length;
  const draftFixBatchCardIds = new Set(
    batchCards
      .filter(
        (card) =>
          isDraftableBatchCard(card) && draftReadinessErrors(card).length > 0
      )
      .map((card) => card.id)
  );
  const selectedDraftFixCount = batchCards.filter(
    (card) => card.selected && draftFixBatchCardIds.has(card.id)
  ).length;
  const selectedReadyDraftCards = selectedDoneBatchCards.filter(
    (card) => draftReadinessErrors(card).length === 0
  );
  const selectedDraftReadyCount = selectedReadyDraftCards.length;
  const createSelectedReadyDraftButtonDisabled =
    batchRunning || batchDrafting || selectedDraftReadyCount === 0;
  const createDraftButtonDisabled =
    batchRunning ||
    batchDrafting ||
    selectedDraftReadyCount === 0 ||
    selectedDraftFixCount > 0;
  const exportDraftPayloadDisabled = createSelectedReadyDraftButtonDisabled;
  const cleanDraftableBatchCardIds = new Set(
    batchCards
      .filter(
        (card) =>
          isDraftableBatchCard(card) && batchCardReviewWarnings(card).length === 0
      )
      .map((card) => card.id)
  );
  const cleanDraftableCount = cleanDraftableBatchCardIds.size;
  const cleanReadyBatchCardIds = new Set(
    batchCards
      .filter(
        (card) =>
          cleanDraftableBatchCardIds.has(card.id) &&
          draftReadinessErrors(card).length === 0
      )
      .map((card) => card.id)
  );
  const cleanReadyCount = cleanReadyBatchCardIds.size;
  const cleanDraftFixCount = batchCards.filter(
    (card) =>
      cleanDraftableBatchCardIds.has(card.id) &&
      draftReadinessErrors(card).length > 0
  ).length;
  const reviewBatchCardIds = new Set(
    batchCards
      .filter((card) => batchCardReviewWarnings(card).length > 0)
      .map((card) => card.id)
  );
  const reviewDraftFixCount = batchCards.filter(
    (card) => reviewBatchCardIds.has(card.id) && draftFixBatchCardIds.has(card.id)
  ).length;
  const selectedReviewCount = batchCards.filter(
    (card) => card.selected && reviewBatchCardIds.has(card.id)
  ).length;
  const selectedReadyReviewCount = selectedDoneBatchCards.filter(
    (card) =>
      readyDraftableBatchCardIds.has(card.id) && reviewBatchCardIds.has(card.id)
  ).length;
  const selectedReviewDraftFixCount = selectedDoneBatchCards.filter(
    (card) => reviewBatchCardIds.has(card.id) && draftFixBatchCardIds.has(card.id)
  ).length;
  const selectedCleanCount = selectedDoneBatchCards.filter((card) =>
    cleanDraftableBatchCardIds.has(card.id)
  ).length;
  const selectedCleanDraftFixCount = selectedDoneBatchCards.filter(
    (card) =>
      cleanDraftableBatchCardIds.has(card.id) && draftFixBatchCardIds.has(card.id)
  ).length;
  const selectedCleanReadyDraftCards = selectedDoneBatchCards.filter((card) =>
    cleanReadyBatchCardIds.has(card.id)
  );
  const selectedCleanReadyCount = selectedCleanReadyDraftCards.length;
  const exportCleanDraftPayloadDisabled =
    batchRunning || batchDrafting || selectedCleanReadyCount === 0;
  const selectedDraftErrorBatchCardIds = new Set(
    selectedDoneBatchCards
      .filter((card) => card.draftStatus === "error")
      .map((card) => card.id)
  );
  const selectedDraftErrorCount = selectedDraftErrorBatchCardIds.size;
  const selectedQuantityMergeCards = selectedDoneBatchCards;
  const selectedQuantityMergeCount = selectedQuantityMergeCards.length;
  const selectedQuantityMergePlan = planInstaCompSelectedQuantityMerge(
    selectedQuantityMergeCards.map((card) => ({
      id: card.id,
      title: draftTitleForCard(card),
      identityKey: selectedQuantityMergeIdentityKeyForCard(card),
      quantity: draftQuantityForCard(card),
    }))
  );
  const selectedQuantityMergeDisabled =
    batchRunning || batchDrafting || selectedQuantityMergeCount < 2;
  const selectedQuantityMergeHelp = selectedQuantityMergePlan.ok
    ? `Ready to merge ${selectedQuantityMergePlan.mergedRowCount} selected duplicate rows: qty ${selectedQuantityMergePlan.previousKeeperQuantity} + ${selectedQuantityMergePlan.duplicateQuantity} = ${selectedQuantityMergePlan.mergedQuantity}.`
    : selectedQuantityMergePlan.reason;
  const selectedDraftSummary =
    selectedDoneBatchCards.length > 0
      ? `Selected ${selectedDoneBatchCards.length} - Ready ${selectedDraftReadyCount} - Ready Review ${selectedReadyReviewCount} - Clean Ready ${selectedCleanReadyCount} - Clean ${selectedCleanCount} - Clean Fix ${selectedCleanDraftFixCount} - Fix ${selectedDraftFixCount} - Review ${selectedReviewCount} - Review Fix ${selectedReviewDraftFixCount} - Marked Problems ${selectedOperatorMarkedProblemCount}`
      : "No draft rows selected";
  const batchViewIsReset =
    batchFilter === "all" && batchSort === "original" && !batchSearch;
  const batchPairedCount = batchCards.filter((card) => card.backFile).length;
  const batchProgressPercent = batchCards.length
    ? Math.round((batchCompleteCount / batchCards.length) * 100)
    : 0;
  const batchProgressLabel = `${batchCompleteCount}/${batchCards.length} finished`;
  const testModelProblemRowCount = batchCards.filter(
    isTestModelProblemBatchCard
  ).length;
  const batchFilterOptions: Array<{
    filter: BatchCardFilter;
    count: number;
  }> = [
    { filter: "all", count: batchCards.length },
    { filter: "selected", count: selectedDoneBatchCards.length },
    { filter: "problems", count: testModelProblemRowCount },
    { filter: "draftable", count: batchDraftableCount },
    { filter: "ready", count: readyDraftableCount },
    { filter: "ready_review", count: readyReviewCount },
    { filter: "clean", count: cleanDraftableCount },
    { filter: "clean_ready", count: cleanReadyCount },
    { filter: "clean_fix", count: cleanDraftFixCount },
    { filter: "review", count: batchReviewCount },
    { filter: "review_fix", count: reviewDraftFixCount },
    { filter: "fix", count: batchDraftFixCount },
    { filter: "errors", count: batchErrorCount },
    { filter: "draft_errors", count: batchDraftErrorCount },
    { filter: "drafted", count: batchDraftCreatedCount },
    { filter: "active", count: batchCards.length - batchCompleteCount },
  ];
  const testModelProblemBreakdown: Array<{
    label: string;
    count: number;
    filter: BatchCardFilter;
  }> = [
    { label: "Scan Fails", count: batchErrorCount, filter: "errors" },
    {
      label: "Draft Fails",
      count: batchDraftErrorCount,
      filter: "draft_errors",
    },
    { label: "Review Rows", count: batchReviewCount, filter: "review" },
    { label: "Fix Rows", count: batchDraftFixCount, filter: "fix" },
  ];
  const visibleBatchCards = batchCards
    .map((card, index) => ({ card, index }))
    .filter(
      ({ card }) =>
        batchCardMatchesFilter(card, batchFilter) &&
        batchCardMatchesSearch(card, batchSearch)
    )
    .sort((left, right) => compareBatchCards(left, right, batchSort));
  const visibleDraftableBatchCardIds = new Set(
    visibleBatchCards
      .filter(({ card }) => isDraftableBatchCard(card))
      .map(({ card }) => card.id)
  );
  const visibleDraftableCount = visibleDraftableBatchCardIds.size;
  const visibleReadyBatchCardIds = new Set(
    visibleBatchCards
      .filter(
        ({ card }) =>
          isDraftableBatchCard(card) && draftReadinessErrors(card).length === 0
      )
      .map(({ card }) => card.id)
  );
  const visibleReadyDraftCards = visibleBatchCards
    .filter(
      ({ card }) =>
        isDraftableBatchCard(card) && draftReadinessErrors(card).length === 0
    )
    .map(({ card }) => card);
  const visibleReadyCount = visibleReadyBatchCardIds.size;
  const visibleCleanBatchCardIds = new Set(
    visibleBatchCards
      .filter(
        ({ card }) =>
          isDraftableBatchCard(card) && batchCardReviewWarnings(card).length === 0
      )
      .map(({ card }) => card.id)
  );
  const visibleCleanCount = visibleCleanBatchCardIds.size;
  const visibleCleanReadyDraftCards = visibleBatchCards
    .filter(
      ({ card }) =>
        isDraftableBatchCard(card) &&
        draftReadinessErrors(card).length === 0 &&
        batchCardReviewWarnings(card).length === 0
    )
    .map(({ card }) => card);
  const visibleCleanReadyBatchCardIds = new Set(
    visibleCleanReadyDraftCards.map((card) => card.id)
  );
  const visibleCleanReadyCount = visibleCleanReadyBatchCardIds.size;
  const visibleReviewBatchCardIds = new Set(
    visibleBatchCards
      .filter(({ card }) => batchCardReviewWarnings(card).length > 0)
      .map(({ card }) => card.id)
  );
  const visibleReviewCount = visibleReviewBatchCardIds.size;
  const visibleReadyReviewBatchCardIds = new Set(
    visibleBatchCards
      .filter(
        ({ card }) =>
          visibleReadyBatchCardIds.has(card.id) &&
          batchCardReviewWarnings(card).length > 0
      )
      .map(({ card }) => card.id)
  );
  const visibleReadyReviewCount = visibleReadyReviewBatchCardIds.size;
  const visibleDraftFixBatchCardIds = new Set(
    visibleBatchCards
      .filter(
        ({ card }) =>
          isDraftableBatchCard(card) && draftReadinessErrors(card).length > 0
      )
      .map(({ card }) => card.id)
  );
  const visibleDraftFixCount = visibleDraftFixBatchCardIds.size;
  const visibleReviewDraftFixBatchCardIds = new Set(
    visibleBatchCards
      .filter(
        ({ card }) =>
          visibleReviewBatchCardIds.has(card.id) &&
          visibleDraftFixBatchCardIds.has(card.id)
      )
      .map(({ card }) => card.id)
  );
  const visibleReviewDraftFixCount = visibleReviewDraftFixBatchCardIds.size;
  const visibleCleanDraftFixBatchCardIds = new Set(
    visibleBatchCards
      .filter(
        ({ card }) =>
          visibleCleanBatchCardIds.has(card.id) &&
          visibleDraftFixBatchCardIds.has(card.id)
      )
      .map(({ card }) => card.id)
  );
  const visibleCleanDraftFixCount = visibleCleanDraftFixBatchCardIds.size;
  const visibleFailedBatchCardIds = new Set(
    visibleBatchCards
      .filter(({ card }) => card.status === "error")
      .map(({ card }) => card.id)
  );
  const visibleFailedCount = visibleFailedBatchCardIds.size;
  const visibleDraftedBatchCardIds = new Set(
    visibleBatchCards
      .filter(({ card }) => card.draftStatus === "created")
      .map(({ card }) => card.id)
  );
  const visibleDraftedCount = visibleDraftedBatchCardIds.size;
  const visibleDraftErrorBatchCardIds = new Set(
    visibleBatchCards
      .filter(({ card }) => card.draftStatus === "error")
      .map(({ card }) => card.id)
  );
  const visibleDraftErrorCount = visibleDraftErrorBatchCardIds.size;
  const visibleTrialResultCount = visibleBatchCards.filter(
    ({ card }) => card.status === "done" && Boolean(card.result?.ai)
  ).length;
  const visibleTrialSpeedGate = useMemo(
    () => instacompTrialSpeedGate(visibleBatchCards),
    [visibleBatchCards]
  );
  const testModelPassedCount = testModelChecks.filter((check) => check.pass).length;
  const testModelFailedCount = testModelChecks.length - testModelPassedCount;

  function handleFrontChange(file: File | null) {
    setFrontImage(file);
    setFrontOriginalImage(file);
    setFrontRotationDegrees(0);
    setResult(null);
    setError(null);

    if (frontPreview) URL.revokeObjectURL(frontPreview);
    setFrontPreview(file ? URL.createObjectURL(file) : null);
  }

  function handleBackChange(file: File | null) {
    setBackImage(file);
    setBackOriginalImage(file);
    setBackRotationDegrees(0);
    setResult(null);
    setError(null);

    if (backPreview) URL.revokeObjectURL(backPreview);
    setBackPreview(file ? URL.createObjectURL(file) : null);
  }

  async function rotateSingleImage(side: "front" | "back", direction: "left" | "right") {
    if (loading || batchRunning || batchDrafting) return;

    const file =
      side === "front"
        ? frontOriginalImage || frontImage
        : backOriginalImage || backImage;

    if (!file) return;

    setError(null);
    setResult(null);

    try {
      const nextDegrees =
        side === "front"
          ? nextRotationDegrees(frontRotationDegrees, direction)
          : nextRotationDegrees(backRotationDegrees, direction);
      const rotatedFile = await rotateImageFile(file, nextDegrees);

      if (side === "front") {
        setFrontImage(rotatedFile);
        setFrontRotationDegrees(nextDegrees);
        if (frontPreview) URL.revokeObjectURL(frontPreview);
        setFrontPreview(URL.createObjectURL(rotatedFile));
      } else {
        setBackImage(rotatedFile);
        setBackRotationDegrees(nextDegrees);
        if (backPreview) URL.revokeObjectURL(backPreview);
        setBackPreview(URL.createObjectURL(rotatedFile));
      }
    } catch (error: any) {
      setError(error?.message || "Could not rotate this image.");
    }
  }

  async function persistentJobJson(
    url: string,
    options: { method?: string; body?: unknown } = {}
  ) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetchWithFreshAccountSession(url, {
        method: options.method || "GET",
        headers:
          options.body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        return data;
      }

      const error = new Error(data?.error || "InstaComp™ job request failed.") as Error & {
        code?: string;
        status?: number;
        details?: unknown;
      };
      error.code = data?.code;
      error.status = response.status;
      error.details = data?.details;

      if (attempt < 3 && isDatabaseConnectionPressureError(error)) {
        await waitForMs(databasePressureBackoffMs(attempt));
        continue;
      }

      throw error;
    }

    throw new Error("InstaComp™ job request failed after database backoff.");
  }

  function bindPersistentCard(cardId: string, binding: PersistentJobBinding) {
    persistentBindingsRef.current.set(cardId, binding);
    setBatchCards((current) =>
      current.map((card) =>
        card.id === cardId
          ? {
              ...card,
              persistentClientId: binding.clientItemId,
              persistentJobId: binding.jobId,
              persistentItemId: binding.itemId,
              frontStoragePath: binding.frontStoragePath,
              backStoragePath: binding.backStoragePath,
            }
          : card
      )
    );
  }

  async function forceCloseActivePersistentJobsBeforeRetry() {
    const listData = await persistentJobJson("/api/instacomp/jobs?limit=25");
    const activeJobs = (Array.isArray(listData.jobs) ? listData.jobs : [])
      .filter((job: PersistentJobSummary) =>
        ACTIVE_INSTACOMP_JOB_STATUSES.has(String(job.status))
      );

    if (!activeJobs.length) return 0;

    await Promise.all(
      activeJobs.map((job: PersistentJobSummary) =>
        persistentJobJson(`/api/instacomp/jobs/${job.id}`, {
          method: "PATCH",
          body: {
            status: "cancelling",
            cancelRequested: true,
            forceCancel: true,
          },
        }).catch((error) => {
          if (
            error?.code === "INSTACOMP_INVALID_JOB_TRANSITION" ||
            error?.status === 404
          ) {
            return null;
          }

          throw error;
        })
      )
    );

    return activeJobs.length;
  }

  async function createPersistentJobWithActiveLotRecovery(params: {
    clientBatchId: string;
    totalItems: number;
    autoCreateDrafts: boolean;
  }) {
    const body = {
      clientBatchId: params.clientBatchId,
      name: `InstaComp™ lot ${new Date().toLocaleString()}`,
      totalItems: params.totalItems,
      requestedConcurrency: batchConcurrency,
      autoCreateDrafts: params.autoCreateDrafts,
      options: {
        transport: "signed_private_uploads",
        imageOptimization: "bounded_v1",
      },
    };

    try {
      return await persistentJobJson("/api/instacomp/jobs", {
        method: "POST",
        body,
      });
    } catch (error: any) {
      if (error?.code !== "INSTACOMP_ACTIVE_JOB_LIMIT") {
        throw error;
      }

      const closedCount = await forceCloseActivePersistentJobsBeforeRetry();

      if (!closedCount) {
        throw error;
      }

      setBatchDraftMessage(
        `Closed ${closedCount} stale active InstaComp™ lot${
          closedCount === 1 ? "" : "s"
        } and retried this upload.`
      );

      return persistentJobJson("/api/instacomp/jobs", {
        method: "POST",
        body,
      });
    }
  }

  async function uploadPersistentJobFile(params: {
    bucket: string;
    path: string;
    token: string;
    file: File;
  }) {
    const { error } = await getInstaCompUploadClient().storage
      .from(params.bucket)
      .uploadToSignedUrl(params.path, params.token, params.file, {
        contentType: params.file.type || "image/jpeg",
      });

    if (error) throw error;
  }

  async function ensurePersistentJob(
    cards: BatchCard[],
    autoCreateDrafts: boolean
  ) {
    if (testMode) return null;

    const activeCards = cards.filter(
      (card) => !removedBatchCardIdsRef.current.has(card.id)
    );

    if (!activeCards.length) return null;

    const existingJobId = persistentJob?.id;
    const allCardsBound = activeCards.every((card) =>
      persistentBindingsRef.current.has(card.id)
    );

    if (
      existingJobId &&
      allCardsBound &&
      ["queued", "processing"].includes(String(persistentJob?.status))
    ) {
      return existingJobId;
    }

    setPersistentJobPreparing(true);
    setPersistentUploadProgress({ completed: 0, total: 0 });

    try {
      const clientIds = new Map(
        activeCards.map((card) => [
          card.id,
          card.persistentClientId || crypto.randomUUID(),
        ])
      );
      const clientBatchId =
        persistentClientBatchIdRef.current || crypto.randomUUID();
      persistentClientBatchIdRef.current = clientBatchId;
      const created = await createPersistentJobWithActiveLotRecovery({
        clientBatchId,
        totalItems: activeCards.length,
        autoCreateDrafts,
      });
      const job = created.job as PersistentJobSummary;
      let completedUploads = 0;
      const totalUploads = activeCards.reduce(
        (total, card) => total + 1 + (card.backFile ? 1 : 0),
        0
      );

      setPersistentJob(job);
      setPersistentUploadProgress({ completed: 0, total: totalUploads });
      window.localStorage.setItem(INSTACOMP_LAST_JOB_STORAGE_KEY, job.id);

      for (
        let chunkStart = 0;
        chunkStart < activeCards.length;
        chunkStart += INSTACOMP_JOB_ITEM_CHUNK_SIZE
      ) {
        const chunk = activeCards.slice(
          chunkStart,
          chunkStart + INSTACOMP_JOB_ITEM_CHUNK_SIZE
        );
        const optimizedByCardId = new Map<
          string,
          {
            front: File;
            back: File | null;
            frontSha256: string;
            backSha256: string | null;
          }
        >();
        let optimizeCursor = 0;

        async function runOptimizeWorker() {
          while (optimizeCursor < chunk.length) {
            const card = chunk[optimizeCursor];
            optimizeCursor += 1;
            const [front, back] = await Promise.all([
              preparePersistentStorageImage(card.file),
              card.backFile
                ? preparePersistentStorageImage(card.backFile)
                : Promise.resolve(null),
            ]);
            const [frontSha256, backSha256] = await Promise.all([
              sha256File(front),
              back ? sha256File(back) : Promise.resolve(null),
            ]);
            optimizedByCardId.set(card.id, {
              front,
              back,
              frontSha256,
              backSha256,
            });
          }
        }

        await Promise.all(
          Array.from(
            {
              length: Math.min(INSTACOMP_JOB_UPLOAD_CONCURRENCY, chunk.length),
            },
            () => runOptimizeWorker()
          )
        );

        const registered = await persistentJobJson(
          `/api/instacomp/jobs/${job.id}/items`,
          {
            method: "POST",
            body: {
              items: chunk.map((card, index) => {
                const optimized = optimizedByCardId.get(card.id)!;

                return {
                  clientItemId: clientIds.get(card.id),
                  position: chunkStart + index,
                  frontName: optimized.front.name,
                  frontType: optimized.front.type || "image/jpeg",
                  frontSize: optimized.front.size,
                  frontSha256: optimized.frontSha256,
                  ...(optimized.back
                    ? {
                        backName: optimized.back.name,
                        backType: optimized.back.type || "image/jpeg",
                        backSize: optimized.back.size,
                        backSha256: optimized.backSha256,
                        pairingConfidence: card.pairingConfidence ?? 1,
                      }
                    : {}),
                };
              }),
            },
          }
        );
        const cardByClientId = new Map(
          chunk.map((card) => [clientIds.get(card.id), card])
        );
        let uploadCursor = 0;

        async function runUploadWorker() {
          while (uploadCursor < registered.items.length) {
            const registration = registered.items[uploadCursor];
            uploadCursor += 1;
            const card = cardByClientId.get(registration.item.client_item_id);

            if (!card) throw new Error("Could not match a registered card row.");

            const optimized = optimizedByCardId.get(card.id)!;

            bindPersistentCard(card.id, {
              jobId: job.id,
              itemId: registration.item.id,
              clientItemId: registration.item.client_item_id,
              frontStoragePath: registration.item.front_storage_path,
              backStoragePath: registration.item.back_storage_path,
            });

            if (registration.frontUpload) {
              await uploadPersistentJobFile({
                bucket: registered.bucket,
                ...registration.frontUpload,
                file: optimized.front,
              });
              completedUploads += 1;
              setPersistentUploadProgress({
                completed: completedUploads,
                total: totalUploads,
              });
            }

            if (registration.backUpload && optimized.back) {
              await uploadPersistentJobFile({
                bucket: registered.bucket,
                ...registration.backUpload,
                file: optimized.back,
              });
              completedUploads += 1;
              setPersistentUploadProgress({
                completed: completedUploads,
                total: totalUploads,
              });
            }

          }
        }

        await Promise.all(
          Array.from(
            {
              length: Math.min(
                INSTACOMP_JOB_UPLOAD_CONCURRENCY,
                registered.items.length
              ),
            },
            () => runUploadWorker()
          )
        );

        await persistentJobJson(`/api/instacomp/jobs/${job.id}/items`, {
          method: "PATCH",
          body: {
            itemIds: registered.items.map(
              (registration: any) => registration.item.id
            ),
          },
        });
      }

      const queued = await persistentJobJson(
        `/api/instacomp/jobs/${job.id}`,
        {
          method: "PATCH",
          body: { status: "queued" },
        }
      );

      setPersistentJob(queued.job as PersistentJobSummary);
      setPersistentUploadProgress({
        completed: totalUploads,
        total: totalUploads,
      });
      return job.id;
    } finally {
      setPersistentJobPreparing(false);
    }
  }

  async function runInstaCompScan(
    front: File,
    back?: File | null,
    claimedItem?: PersistentClaimedItem,
    signal?: AbortSignal
  ) {
    throwIfAborted(signal);

    if (testMode) {
      return runTestInstaCompScan(front, back);
    }

    if (claimedItem) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        throwIfAborted(signal);
        const hasSerialOverride = serialOverrideByItemIdRef.current.has(
          claimedItem.id
        );
        const operatorSerialNumberOverride = hasSerialOverride
          ? serialOverrideByItemIdRef.current.get(claimedItem.id) ?? null
          : undefined;
        const response = await fetchWithFreshAccountSession("/api/instacomp/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal,
          body: JSON.stringify({
            jobId: claimedItem.job_id,
            itemId: claimedItem.id,
            leaseToken: claimedItem.leaseToken || claimedItem.lease_token,
            aiCouncilTier,
            ...(hasSerialOverride ? { operatorSerialNumberOverride } : {}),
          }),
        });
        const data = await response.json().catch(() => ({}));

        if (response.ok && data.ok) {
          return data as ScanResponse;
        }

        const error = new Error(data?.error || "Queued scan failed.") as Error & {
          code?: string;
          status?: number;
          details?: unknown;
        };
        error.code = data?.code;
        error.status = response.status;
        error.details = data?.details;

        if (attempt < 3 && isDatabaseConnectionPressureError(error)) {
          await waitForMs(databasePressureBackoffMs(attempt));
          continue;
        }

        throw error;
      }

      throw new Error("Queued scan failed after database backoff.");
    }

    const [optimizedFront, optimizedBack] = await Promise.all([
      optimizeScanImage(front),
      back ? optimizeScanImage(back) : Promise.resolve(null),
    ]);
    throwIfAborted(signal);
    const formData = new FormData();
    formData.append("frontImage", optimizedFront);
    formData.append("aiCouncilTier", aiCouncilTier);

    if (optimizedBack) {
      formData.append("backImage", optimizedBack);
    }

    const [frontDetailCrops, backDetailCrops] = await Promise.all([
      createSerialDetailCrops(optimizedFront, "front"),
      optimizedBack
        ? createSerialDetailCrops(optimizedBack, "back")
        : Promise.resolve([]),
    ]);
    throwIfAborted(signal);
    const detailCrops = Array.from({
      length: Math.max(frontDetailCrops.length, backDetailCrops.length),
    })
      .flatMap((_, index) => [
        frontDetailCrops[index],
        backDetailCrops[index],
      ])
      .filter((crop): crop is File => Boolean(crop))
      .slice(0, 24);
    let requestBytes = optimizedFront.size + (optimizedBack?.size || 0);

    detailCrops.forEach((crop) => {
      if (requestBytes + crop.size > MAX_SCAN_REQUEST_BYTES) return;

      formData.append("detailImages", crop);
      requestBytes += crop.size;
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      throwIfAborted(signal);
      const response = await fetchWithFreshAccountSession("/api/instacomp/scan", {
        method: "POST",
        signal,
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && data.ok) {
        return data as ScanResponse;
      }

      const error = new Error(data?.error || "Scan failed.") as Error & {
        code?: string;
        status?: number;
        details?: unknown;
      };
      error.code = data?.code;
      error.status = response.status;
      error.details = data?.details;

      if (attempt < 3 && isDatabaseConnectionPressureError(error)) {
        await waitForMs(databasePressureBackoffMs(attempt));
        continue;
      }

      throw error;
    }

    throw new Error("Scan failed after database backoff.");
  }

  async function scanCard() {
    if (loading) {
      setError("InstaComp™ is already running for this card.");
      return;
    }

    if (!frontImage) {
      setError("Upload the front of the card first.");
      return;
    }

    setLoading(true);
    setError(null);
    setCopiedPrice(null);

    try {
      setResult(await runInstaCompScan(frontImage, backImage));
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function copyPrice(value: number | null | undefined, label: string) {
    if (!value) {
      setCopiedPrice(`No ${label} is available yet.`);
      return;
    }

    await navigator.clipboard.writeText(String(value));
    setCopiedPrice(`${label}: ${money(value)}`);
  }

  function createBatchPreviewUrl(file: File) {
    const url = URL.createObjectURL(file);
    batchPreviewUrlsRef.current.push(url);

    return url;
  }

  function createTestBatchCard(
    fixture: TestScanFixture,
    index: number,
    completed: boolean
  ): BatchCard {
    const frontFile = testImageFile(
      `${fixture.slug}-front.svg`,
      fixture.label,
      fixture.color
    );
    const backFile = fixture.backLabel
      ? testImageFile(`${fixture.slug}-back.svg`, fixture.backLabel, fixture.color)
      : null;
    const result =
      completed && !fixture.scanError
        ? testScanResponse(fixture, Boolean(backFile))
        : null;
    const marketPrice = effectiveMarketStats(result).suggestedPrice;
    const status: BatchCardStatus = completed
      ? fixture.scanError
        ? "error"
        : "done"
      : "queued";
    const draftStatus =
      completed && status === "done" ? fixture.initialDraftStatus || "idle" : "idle";

    return {
      id: `${fixture.slug}-${Date.now()}-${index}`,
      file: frontFile,
      backFile,
      originalFile: frontFile,
      originalBackFile: backFile,
      frontRotationDegrees: 0,
      backRotationDegrees: 0,
      previewUrl: createBatchPreviewUrl(frontFile),
      backPreviewUrl: backFile ? createBatchPreviewUrl(backFile) : null,
      status,
      selected:
        fixture.selected ??
        (status !== "error" && draftStatus !== "created" && draftStatus !== "drafting"),
      operatorMarkedWrong: false,
      operatorNeedsMoreInfo: false,
      result,
      marketPrice,
      customTitle: result ? cardResultTitle(result, frontFile.name) : "",
      customSerialNumber: result?.ai.serialNumber || "",
      customQuantity: fixture.customQuantity || "1",
      customPrice:
        fixture.customPrice ??
        (result && marketPrice ? marketPrice.toFixed(2) : ""),
      error: completed && fixture.scanError ? fixture.scanError : null,
      draftStatus,
      draftError: completed ? fixture.initialDraftError || null : null,
      draftInventoryItemId:
        completed && draftStatus === "created"
          ? fixture.draftInventoryItemId || null
          : null,
      draftLegacyProductId:
        completed && draftStatus === "created"
          ? fixture.draftLegacyProductId || null
          : null,
      draftSku:
        completed && draftStatus === "created" ? fixture.draftSku || null : null,
      tradeStatus: "idle",
      tradeError: null,
      tradeCollectionItemId: null,
      scanQueuedAt: completed ? new Date(Date.now() - 6000).toISOString() : null,
      scanStartedAt: completed ? new Date(Date.now() - 5000).toISOString() : null,
      scanCompletedAt: completed ? new Date().toISOString() : null,
      scanElapsedMs: completed ? 5000 : null,
    };
  }

  function testModelSmokeCheckMessage(checks: TestModelCheck[]) {
    const passed = checks.filter((check) => check.pass).length;

    return `Test smoke check: ${passed}/${checks.length} passed.`;
  }

  function recordTestModelRun(
    label: string,
    scenario: TestModelCheckScenario,
    checks: TestModelCheck[],
    cards: BatchCard[]
  ) {
    const passed = checks.filter((check) => check.pass).length;
    const problemCounts = testModelRunProblemCounts(cards);
    const record: TestModelRunRecord = {
      id: `${scenario}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ranAt: new Date().toISOString(),
      label,
      scenario,
      passed,
      failed: checks.length - passed,
      total: checks.length,
      rowCount: cards.length,
      ...problemCounts,
    };

    setTestModelRunRecords((current) => [record, ...current].slice(0, 12));
  }

  function runTestModelSmokeCheck(
    targetCards = batchCards,
    scenario = testModelCheckScenario
  ) {
    if (!testMode) return;

    if (showTestModelBusyBlocked("running a smoke check")) return;

    if (!targetCards.length) {
      setTestModelChecks([]);
      setBatchError("Load the completed test matrix first.");
      return;
    }

    const checks = buildTestModelSmokeChecks(targetCards, scenario);
    const failedCount = checks.filter((check) => !check.pass).length;

    setTestModelCheckScenario(scenario);
    setTestModelChecks(checks);
    recordTestModelRun("Manual Smoke Check", scenario, checks, targetCards);
    setBatchError(
      failedCount
        ? `Test smoke check has ${failedCount} failing check${
            failedCount === 1 ? "" : "s"
          }.`
        : null
    );
    setBatchDraftMessage(testModelSmokeCheckMessage(checks));
  }

  function applyTestDraftResults(cards: BatchCard[], targetCards: BatchCard[]) {
    const targetIds = new Set(targetCards.map((card) => card.id));

    return cards.map((card) => {
      if (!targetIds.has(card.id)) return card;

      const error = testDraftCreateErrorForCard(card);

      if (error) {
        return {
          ...card,
          draftStatus: "error" as const,
          draftError: error,
        };
      }

      return {
        ...card,
        selected: false,
        draftStatus: "created" as const,
        draftError: null,
        draftInventoryItemId: `test-inventory-${card.id.slice(0, 24)}`,
        draftLegacyProductId:
          990000 + targetCards.findIndex((targetCard) => targetCard.id === card.id),
        draftSku: `TEST-${card.id.slice(0, 12).toUpperCase()}`,
        tradeStatus: "idle" as const,
        tradeError: null,
        tradeCollectionItemId: null,
      };
    });
  }

  function testModelEvidenceReportPayload() {
    const checks = batchCards.length
      ? testModelChecks.length
        ? testModelChecks
        : buildTestModelSmokeChecks(batchCards, testModelCheckScenario)
      : [];

    if (batchCards.length && !testModelChecks.length) {
      setTestModelChecks(checks);
    }

    const rows = batchExportRows(
      batchCards.map((card, index) => ({
        card,
        index,
      }))
    );
    const passedChecks = checks.filter((check) => check.pass).length;
    const failedChecks = checks.filter((check) => !check.pass);
    const latestRun = testModelRunRecords[0] || null;
    const runLedgerTotals = summarizeTestModelRunRecords(testModelRunRecords);
    const payload = {
      exportedAt: new Date().toISOString(),
      scope: "instacomp_test_model_evidence",
      route: "/instacomp-test",
      fixtureCount: TEST_SCAN_FIXTURES.length,
      summary: {
        currentScenario: testModelCheckScenario,
        currentPassedChecks: passedChecks,
        currentFailedChecks: failedChecks.length,
        currentTotalChecks: checks.length,
        currentStatus: failedChecks.length ? "fail" : "pass",
        latestRun,
        runLedgerTotals,
        failingChecks: failedChecks.map((check) => ({
          label: check.label,
          expected: check.expected,
          actual: check.actual,
        })),
      },
      view: {
        filter: batchFilter,
        sort: batchSort,
        search: batchSearch,
        visibleRows: visibleBatchCards.length,
      },
      counts: {
        totalRows: batchCards.length,
        completedRows: batchCompleteCount,
        doneRows: batchDoneCount,
        failedRows: batchErrorCount,
        scanningRows: batchScanningCount,
        draftableRows: batchDraftableCount,
        draftErrorRows: batchDraftErrorCount,
        readyRows: readyDraftableCount,
        readyReviewRows: readyReviewCount,
        cleanRows: cleanDraftableCount,
        cleanReadyRows: cleanReadyCount,
        cleanFixRows: cleanDraftFixCount,
        reviewRows: batchReviewCount,
        reviewFixRows: reviewDraftFixCount,
        fixRows: batchDraftFixCount,
        draftedRows: batchDraftCreatedCount,
        pairedRows: batchPairedCount,
        selectedRows: selectedDoneBatchCards.length,
        selectedReadyRows: selectedDraftReadyCount,
        selectedCleanReadyRows: selectedCleanReadyCount,
      },
      selectedDraftSummary,
      smokeChecks: {
        scenario: testModelCheckScenario,
        passed: passedChecks,
        failed: checks.length - passedChecks,
        total: checks.length,
        checks,
      },
      runLedger: testModelRunRecords,
      singleScan: result
        ? {
            scanId: result.scanId,
            searchQuery: result.searchQuery,
            title: cardResultTitle(result, "single-test-scan"),
            stats: effectiveMarketStats(result),
            soldStats: result.soldStats,
            sourceCoverage: result.sourceCoverage,
            externalSearch: externalSearchDiagnostics(result),
          }
        : null,
      rows,
    };

    return payload;
  }

  function exportTestModelEvidenceReport() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("exporting test evidence")) return;

    if (!batchCards.length && !result) {
      setBatchError("Load the test matrix or a single test scan first.");
      return;
    }

    const payload = testModelEvidenceReportPayload();
    const rowCount = payload.rows.length;

    downloadTextFile(
      `instacomp-test-evidence-${exportTimestamp()}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8"
    );
    setBatchError(null);
    setBatchDraftMessage(
      `Exported test evidence report with ${rowCount} batch row${
        rowCount === 1 ? "" : "s"
      }.`
    );
  }

  async function copyTestModelEvidenceReport() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("copying test evidence")) return;

    if (!batchCards.length && !result) {
      setBatchError("Load the test matrix or a single test scan first.");
      return;
    }

    const payload = testModelEvidenceReportPayload();
    const rowCount = payload.rows.length;

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setBatchError(null);
      setBatchDraftMessage(
        `Copied test evidence report with ${rowCount} batch row${
          rowCount === 1 ? "" : "s"
        }.`
      );
    } catch {
      setBatchError("Could not copy the test evidence report.");
    }
  }

  function testModelRunLedgerCsvPayload() {
    const rows = testModelRunRecords.map((record, index) => ({
      row: index + 1,
      ranAt: record.ranAt,
      label: record.label,
      scenario: record.scenario,
      status: record.failed ? "fail" : "pass",
      passed: record.passed,
      failed: record.failed,
      total: record.total,
      rowCount: record.rowCount,
      problemRows: record.problemRows,
      scanFailures: record.scanFailures,
      draftFailures: record.draftFailures,
      reviewRows: record.reviewRows,
      fixRows: record.fixRows,
    }));
    const headers: Array<keyof (typeof rows)[number]> = [
      "row",
      "ranAt",
      "label",
      "scenario",
      "status",
      "passed",
      "failed",
      "total",
      "rowCount",
      "problemRows",
      "scanFailures",
      "draftFailures",
      "reviewRows",
      "fixRows",
    ];
    const csv = [
      headers.map(csvCell).join(","),
      ...rows.map((row) =>
        headers.map((header) => csvCell(row[header])).join(",")
      ),
    ].join("\n");

    return { rows, csv };
  }

  function exportTestModelRunLedgerCsv() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("exporting the test run ledger CSV")) return;

    if (!testModelRunRecords.length) {
      setBatchError("Run at least one test cycle before exporting the ledger.");
      return;
    }

    const { rows, csv } = testModelRunLedgerCsvPayload();

    downloadTextFile(
      `instacomp-test-run-ledger-${exportTimestamp()}.csv`,
      csv,
      "text/csv;charset=utf-8"
    );
    setBatchError(null);
    setBatchDraftMessage(
      `Exported ${rows.length} test run ledger row${rows.length === 1 ? "" : "s"}.`
    );
  }

  async function copyTestModelRunLedgerCsv() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("copying the test run ledger CSV")) return;

    if (!testModelRunRecords.length) {
      setBatchError("Run at least one test cycle before copying the ledger.");
      return;
    }

    const { rows, csv } = testModelRunLedgerCsvPayload();

    try {
      await navigator.clipboard.writeText(csv);
      setBatchError(null);
      setBatchDraftMessage(
        `Copied ${rows.length} test run ledger row${rows.length === 1 ? "" : "s"}.`
      );
    } catch {
      setBatchError("Could not copy the test run ledger CSV.");
    }
  }

  function testModelRunLedgerJsonPayload() {
    return {
      exportedAt: new Date().toISOString(),
      scope: "instacomp_test_run_ledger",
      route: "/instacomp-test",
      totals: summarizeTestModelRunRecords(testModelRunRecords),
      records: testModelRunRecords,
    };
  }

  function exportTestModelRunLedgerJson() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("exporting the test run ledger JSON")) return;

    if (!testModelRunRecords.length) {
      setBatchError("Run at least one test cycle before exporting the ledger JSON.");
      return;
    }

    const payload = testModelRunLedgerJsonPayload();

    downloadTextFile(
      `instacomp-test-run-ledger-${exportTimestamp()}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8"
    );
    setBatchError(null);
    setBatchDraftMessage(
      `Exported ${testModelRunRecords.length} test run ledger JSON record${
        testModelRunRecords.length === 1 ? "" : "s"
      }.`
    );
  }

  async function copyTestModelRunLedgerJson() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("copying the test run ledger JSON")) return;

    if (!testModelRunRecords.length) {
      setBatchError("Run at least one test cycle before copying the ledger JSON.");
      return;
    }

    const payload = testModelRunLedgerJsonPayload();

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setBatchError(null);
      setBatchDraftMessage(
        `Copied ${testModelRunRecords.length} test run ledger JSON record${
          testModelRunRecords.length === 1 ? "" : "s"
        }.`
      );
    } catch {
      setBatchError("Could not copy the test run ledger JSON.");
    }
  }

  async function copyTestModelRunLedgerSummary() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("copying the test run ledger summary")) return;

    if (!testModelRunRecords.length) {
      setBatchError("Run at least one test cycle before copying the ledger summary.");
      return;
    }

    const totals = summarizeTestModelRunRecords(testModelRunRecords);
    const latestRuns = testModelRunRecords.slice(0, 5);
    const summaryLines = [
      "InstaComp™ Test Run Ledger Summary",
      "Route: /instacomp-test",
      `Runs: ${totals.runs}`,
      `Checks: ${totals.passedChecks} passed, ${totals.failedChecks} failed`,
      `Rows tested: ${totals.rowsTested}`,
      `Problem rows: ${totals.problemRows}`,
      `Breakdown: ${totals.scanFailures} scan failures, ${totals.draftFailures} draft failures, ${totals.reviewRows} review rows, ${totals.fixRows} fix rows`,
      latestRuns.length
        ? `Latest runs: ${latestRuns
            .map(
              (record) =>
                `${record.label} ${record.passed}/${record.total} passed, ${record.problemRows} problems`
            )
            .join(" | ")}`
        : "Latest runs: none",
    ];

    try {
      await navigator.clipboard.writeText(summaryLines.join("\n"));
      setBatchError(null);
      setBatchDraftMessage("Copied test run ledger summary.");
    } catch {
      setBatchError("Could not copy the test run ledger summary.");
    }
  }

  function clearTestModelRunLedger() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("clearing the test run ledger")) return;

    if (!testModelRunRecords.length) {
      setBatchError("No test run ledger records are available to clear.");
      return;
    }

    setTestModelRunRecords([]);
    setBatchError(null);
    setBatchDraftMessage("Cleared the test run ledger.");
  }

  function testModelSmokeCheckCsvPayload() {
    const rows = testModelChecks.map((check, index) => ({
      row: index + 1,
      scenario: testModelCheckScenario,
      status: check.pass ? "pass" : "fail",
      label: check.label,
      expected: check.expected,
      actual: check.actual,
    }));
    const headers: Array<keyof (typeof rows)[number]> = [
      "row",
      "scenario",
      "status",
      "label",
      "expected",
      "actual",
    ];
    const csv = [
      headers.map(csvCell).join(","),
      ...rows.map((row) =>
        headers.map((header) => csvCell(row[header])).join(",")
      ),
    ].join("\n");

    return { rows, csv };
  }

  function exportTestModelSmokeCheckCsv() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("exporting smoke check rows")) return;

    if (!testModelChecks.length) {
      setBatchError("Run a smoke check before exporting smoke check rows.");
      return;
    }

    const { rows, csv } = testModelSmokeCheckCsvPayload();

    downloadTextFile(
      `instacomp-test-smoke-checks-${exportTimestamp()}.csv`,
      csv,
      "text/csv;charset=utf-8"
    );
    setBatchError(null);
    setBatchDraftMessage(
      `Exported ${rows.length} smoke check row${rows.length === 1 ? "" : "s"}.`
    );
  }

  async function copyTestModelSmokeCheckCsv() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("copying smoke check rows")) return;

    if (!testModelChecks.length) {
      setBatchError("Run a smoke check before copying smoke check rows.");
      return;
    }

    const { rows, csv } = testModelSmokeCheckCsvPayload();

    try {
      await navigator.clipboard.writeText(csv);
      setBatchError(null);
      setBatchDraftMessage(
        `Copied ${rows.length} smoke check row${rows.length === 1 ? "" : "s"}.`
      );
    } catch {
      setBatchError("Could not copy the smoke check CSV.");
    }
  }

  function testModelSmokeCheckJsonPayload() {
    const passedChecks = testModelChecks.filter((check) => check.pass).length;
    const failedChecks = testModelChecks.length - passedChecks;

    return {
      exportedAt: new Date().toISOString(),
      scope: "instacomp_test_smoke_checks",
      route: "/instacomp-test",
      scenario: testModelCheckScenario,
      summary: {
        status: failedChecks ? "fail" : "pass",
        passedChecks,
        failedChecks,
        totalChecks: testModelChecks.length,
      },
      checks: testModelChecks,
    };
  }

  function exportTestModelSmokeCheckJson() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("exporting smoke check JSON")) return;

    if (!testModelChecks.length) {
      setBatchError("Run a smoke check before exporting smoke check JSON.");
      return;
    }

    const payload = testModelSmokeCheckJsonPayload();

    downloadTextFile(
      `instacomp-test-smoke-checks-${exportTimestamp()}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8"
    );
    setBatchError(null);
    setBatchDraftMessage(
      `Exported smoke check JSON with ${payload.summary.passedChecks}/${
        payload.summary.totalChecks
      } passed.`
    );
  }

  async function copyTestModelSmokeCheckJson() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("copying smoke check JSON")) return;

    if (!testModelChecks.length) {
      setBatchError("Run a smoke check before copying smoke check JSON.");
      return;
    }

    const payload = testModelSmokeCheckJsonPayload();

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setBatchError(null);
      setBatchDraftMessage(
        `Copied smoke check JSON with ${payload.summary.passedChecks}/${
          payload.summary.totalChecks
        } passed.`
      );
    } catch {
      setBatchError("Could not copy the smoke check JSON.");
    }
  }

  function testModelFailureSnapshot() {
    const checks = testModelChecks.length
      ? testModelChecks
      : batchCards.length
        ? buildTestModelSmokeChecks(batchCards, testModelCheckScenario)
        : [];

    if (batchCards.length && !testModelChecks.length) {
      setTestModelChecks(checks);
    }

    const failedChecks = checks.filter((check) => !check.pass);
    const problemRows = batchCards
      .map((card, index) => ({ card, index }))
      .filter(({ card }) => isTestModelProblemBatchCard(card));
    const rowDetails = batchExportRows(problemRows);

    return {
      checks,
      failedChecks,
      problemRows,
      rowDetails,
    };
  }

  function testModelFailureSummaryCsvPayload() {
    const { failedChecks, problemRows, rowDetails } = testModelFailureSnapshot();
    const rows = [
      ...failedChecks.map((check, index) => ({
        type: "smoke_check",
        scenario: testModelCheckScenario,
        item: index + 1,
        status: "fail",
        label: check.label,
        expected: check.expected,
        actual: check.actual,
        row: "",
        title: "",
        issueSummary: `${check.label} expected ${check.expected}, actual ${check.actual}`,
        reviewWarnings: "",
        draftReadinessErrors: "",
        scanError: "",
        draftError: "",
        draftStatus: "",
        confidence: "",
        marketSuggested: "",
        marketValueCompCount: "",
        soldCompCount: "",
      })),
      ...rowDetails.map((row) => ({
        type: "batch_row",
        scenario: testModelCheckScenario,
        item: row.exportRow,
        status: row.status,
        label: "Problem row",
        expected: "clean row",
        actual: [
          row.reviewWarnings,
          row.draftReadinessErrors,
          row.error,
          row.draftError,
        ]
          .filter(Boolean)
          .join("; "),
        row: row.row,
        title: row.title,
        issueSummary: [
          row.reviewWarnings,
          row.draftReadinessErrors,
          row.error,
          row.draftError,
        ]
          .filter(Boolean)
          .join("; "),
        reviewWarnings: row.reviewWarnings,
        draftReadinessErrors: row.draftReadinessErrors,
        scanError: row.error,
        draftError: row.draftError,
        draftStatus: row.draftStatus,
        confidence: row.confidence,
        marketSuggested: row.marketSuggested,
        marketValueCompCount: row.marketValueCompCount,
        soldCompCount: row.soldCompCount,
      })),
    ];
    const headers: Array<keyof (typeof rows)[number]> = [
      "type",
      "scenario",
      "item",
      "status",
      "label",
      "expected",
      "actual",
      "row",
      "title",
      "issueSummary",
      "reviewWarnings",
      "draftReadinessErrors",
      "scanError",
      "draftError",
      "draftStatus",
      "confidence",
      "marketSuggested",
      "marketValueCompCount",
      "soldCompCount",
    ];
    const csv = [
      headers.map(csvCell).join(","),
      ...rows.map((row) =>
        headers.map((header) => csvCell(row[header])).join(",")
      ),
    ].join("\n");

    return { failedChecks, problemRows, rows, csv };
  }

  function exportTestModelFailureSummaryCsv() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("exporting failure CSV")) return;

    const { failedChecks, problemRows, csv } = testModelFailureSummaryCsvPayload();

    if (!failedChecks.length && !problemRows.length) {
      setBatchError("No failing smoke checks or problem rows are available.");
      return;
    }

    downloadTextFile(
      `instacomp-test-failure-summary-${exportTimestamp()}.csv`,
      csv,
      "text/csv;charset=utf-8"
    );
    setBatchError(null);
    setBatchDraftMessage(
      `Exported ${failedChecks.length} failing check${
        failedChecks.length === 1 ? "" : "s"
      } and ${problemRows.length} problem row${
        problemRows.length === 1 ? "" : "s"
      }.`
    );
  }

  async function copyTestModelFailureSummaryCsv() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("copying failure CSV")) return;

    const { failedChecks, problemRows, csv } = testModelFailureSummaryCsvPayload();

    if (!failedChecks.length && !problemRows.length) {
      setBatchError("No failing smoke checks or problem rows are available.");
      return;
    }

    try {
      await navigator.clipboard.writeText(csv);
      setBatchError(null);
      setBatchDraftMessage(
        `Copied ${failedChecks.length} failing check${
          failedChecks.length === 1 ? "" : "s"
        } and ${problemRows.length} problem row${
          problemRows.length === 1 ? "" : "s"
        }.`
      );
    } catch {
      setBatchError("Could not copy the failure CSV.");
    }
  }

  function testModelFailureJsonPayload() {
    const { failedChecks, problemRows, rowDetails } = testModelFailureSnapshot();

    return {
      exportedAt: new Date().toISOString(),
      scope: "instacomp_test_failure_snapshot",
      route: "/instacomp-test",
      scenario: testModelCheckScenario,
      summary: {
        failingChecks: failedChecks.length,
        problemRows: problemRows.length,
        filter: batchFilter,
        sort: batchSort,
        search: batchSearch,
      },
      failedChecks: failedChecks.map((check) => ({
        label: check.label,
        expected: check.expected,
        actual: check.actual,
      })),
      problemRows: rowDetails,
    };
  }

  function exportTestModelFailureJson() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("exporting failure JSON")) return;

    const payload = testModelFailureJsonPayload();

    if (!payload.failedChecks.length && !payload.problemRows.length) {
      setBatchError("No failing smoke checks or problem rows are available.");
      return;
    }

    downloadTextFile(
      `instacomp-test-failure-snapshot-${exportTimestamp()}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8"
    );
    setBatchError(null);
    setBatchDraftMessage(
      `Exported failure JSON with ${payload.failedChecks.length} failing check${
        payload.failedChecks.length === 1 ? "" : "s"
      } and ${payload.problemRows.length} problem row${
        payload.problemRows.length === 1 ? "" : "s"
      }.`
    );
  }

  async function copyTestModelFailureJson() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("copying failure JSON")) return;

    const payload = testModelFailureJsonPayload();

    if (!payload.failedChecks.length && !payload.problemRows.length) {
      setBatchError("No failing smoke checks or problem rows are available.");
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setBatchError(null);
      setBatchDraftMessage(
        `Copied failure JSON with ${payload.failedChecks.length} failing check${
          payload.failedChecks.length === 1 ? "" : "s"
        } and ${payload.problemRows.length} problem row${
          payload.problemRows.length === 1 ? "" : "s"
        }.`
      );
    } catch {
      setBatchError("Could not copy the failure JSON.");
    }
  }

  async function copyTestModelFailureSummary() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("copying failure summary")) return;

    const { failedChecks, problemRows, rowDetails } = testModelFailureSnapshot();

    if (!failedChecks.length && !problemRows.length) {
      setBatchError("No failing smoke checks or problem rows are available.");
      return;
    }

    const rowLimit = 12;
    const visibleProblemRows = rowDetails.slice(0, rowLimit);
    const summaryLines = [
      "InstaComp™ Test Model Failure Summary",
      "Route: /instacomp-test",
      `Scenario: ${testModelCheckScenario.replace("_", " ")}`,
      `Failing smoke checks: ${failedChecks.length}`,
      `Problem rows: ${problemRows.length}`,
      failedChecks.length
        ? `Checks: ${failedChecks
            .map(
              (check) =>
                `${check.label} expected ${check.expected}, actual ${check.actual}`
            )
            .join("; ")}`
        : "Checks: none failing",
      visibleProblemRows.length
        ? `Rows: ${visibleProblemRows
            .map((row) => {
              const issueSummary = [
                row.reviewWarnings,
                row.draftReadinessErrors,
                row.error,
                row.draftError,
              ]
                .filter(Boolean)
                .join("; ");

              return `#${row.row} ${row.title || row.frontFileName}: ${
                issueSummary || row.status
              }`;
            })
            .join(" | ")}`
        : "Rows: none",
      problemRows.length > rowLimit
        ? `Rows omitted: ${problemRows.length - rowLimit}`
        : "Rows omitted: 0",
    ];

    try {
      await navigator.clipboard.writeText(summaryLines.join("\n"));
      setBatchError(null);
      setBatchDraftMessage("Copied test failure summary.");
    } catch {
      setBatchError("Could not copy the test failure summary.");
    }
  }

  async function copyTestModelCurrentViewSummary() {
    if (!testMode) return;

    const busyReason = batchBusyBlockedReason("copying the current view summary");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    if (!visibleBatchCards.length) {
      setBatchError("No visible rows are available to copy.");
      return;
    }

    const visibleCards = visibleBatchCards.map(({ card }) => card);
    const rowLimit = 12;
    const rowDetails = batchExportRows(visibleBatchCards.slice(0, rowLimit));
    const problemRows = visibleCards.filter(isTestModelProblemBatchCard).length;
    const scanFailures = visibleCards.filter((card) => card.status === "error")
      .length;
    const draftFailures = visibleCards.filter(
      (card) => card.draftStatus === "error"
    ).length;
    const reviewRows = visibleCards.filter(
      (card) => batchCardReviewWarnings(card).length > 0
    ).length;
    const fixRows = visibleCards.filter(
      (card) => isDraftableBatchCard(card) && draftReadinessErrors(card).length > 0
    ).length;
    const summaryLines = [
      "InstaComp™ Current View Summary",
      "Route: /instacomp-test",
      `View: ${BATCH_FILTER_LABELS[batchFilter]}`,
      `Sort: ${BATCH_SORT_LABELS[batchSort]}`,
      batchSearch.trim() ? `Search: ${batchSearch.trim()}` : "Search: none",
      `Rows: ${visibleCards.length} visible of ${batchCards.length} total`,
      `Draftable: ${visibleCards.filter(isDraftableBatchCard).length}`,
      `Selected: ${
        visibleCards.filter((card) => card.selected && isDraftableBatchCard(card))
          .length
      }`,
      `Problems: ${problemRows} (${scanFailures} scan, ${draftFailures} draft, ${reviewRows} review, ${fixRows} fix)`,
      rowDetails.length
        ? `Visible rows: ${rowDetails
            .map((row) => {
              const issueSummary = [
                row.reviewWarnings,
                row.draftReadinessErrors,
                row.error,
                row.draftError,
              ]
                .filter(Boolean)
                .join("; ");

              return `#${row.row} ${row.title || row.frontFileName}: ${
                issueSummary || row.status
              }`;
            })
            .join(" | ")}`
        : "Visible rows: none",
      visibleCards.length > rowLimit
        ? `Rows omitted: ${visibleCards.length - rowLimit}`
        : "Rows omitted: 0",
    ];

    try {
      await navigator.clipboard.writeText(summaryLines.join("\n"));
      setBatchError(null);
      setBatchDraftMessage("Copied current test view summary.");
    } catch {
      setBatchError("Could not copy the current test view summary.");
    }
  }

  async function copyTestModelCurrentViewCsv() {
    if (!testMode) return;

    const busyReason = batchBusyBlockedReason("copying the current view CSV");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    if (!visibleBatchCards.length) {
      setBatchError("No visible rows are available to copy.");
      return;
    }

    const rows = batchExportRows(visibleBatchCards);
    const headers = Object.keys(rows[0]) as Array<keyof (typeof rows)[number]>;
    const csv = [
      headers.map(csvCell).join(","),
      ...rows.map((row) =>
        headers.map((header) => csvCell(row[header])).join(",")
      ),
    ].join("\n");

    try {
      await navigator.clipboard.writeText(csv);
      setBatchError(null);
      setBatchDraftMessage(
        `Copied ${rows.length} current view CSV row${
          rows.length === 1 ? "" : "s"
        }.`
      );
    } catch {
      setBatchError("Could not copy the current view CSV.");
    }
  }

  async function copyTestModelCurrentViewJson() {
    if (!testMode) return;

    const busyReason = batchBusyBlockedReason("copying the current view JSON");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    if (!visibleBatchCards.length) {
      setBatchError("No visible rows are available to copy.");
      return;
    }

    const payload = {
      ...batchJsonPayload(
        visibleBatchCards,
        visibleBatchCards.length === batchCards.length ? "all" : "view"
      ),
      route: "/instacomp-test",
      view: {
        filter: batchFilter,
        filterLabel: BATCH_FILTER_LABELS[batchFilter],
        sort: batchSort,
        sortLabel: BATCH_SORT_LABELS[batchSort],
        search: batchSearch.trim(),
        visibleRows: visibleBatchCards.length,
        totalRows: batchCards.length,
      },
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setBatchError(null);
      setBatchDraftMessage(
        `Copied ${visibleBatchCards.length} current view JSON row${
          visibleBatchCards.length === 1 ? "" : "s"
        }.`
      );
    } catch {
      setBatchError("Could not copy the current view JSON.");
    }
  }

  async function copyTestModelBatchRowSummary(card: BatchCard, index: number) {
    if (!testMode) return;

    const row = batchExportRows([{ card, index }])[0];
    const issueSummary = [
      row.reviewWarnings,
      row.draftReadinessErrors,
      row.error,
      row.draftError,
    ]
      .filter(Boolean)
      .join("; ");
    const summaryLines = [
      "InstaComp™ Test Row Summary",
      "Route: /instacomp-test",
      `Row: #${row.row}`,
      `Title: ${row.title || row.frontFileName}`,
      `Status: ${row.status}, draft ${row.draftStatus}`,
      `Files: ${row.frontFileName}${row.backFileName ? ` / ${row.backFileName}` : ""}`,
      `Confidence: ${row.confidence || "none"}`,
      `Market: ${row.marketSuggested || "none"}`,
      `Comps: ${row.marketValueCompCount} market, ${row.soldCompCount} sold, ${row.remainingMatchCount} remaining`,
      `Draft: ready ${row.draftReady}, selected ${row.selectedForDraft}, qty ${row.quantity}, price ${row.listingPrice || "none"}, sku ${row.draftSku || "none"}`,
      `External: ${row.externalProvider || "none"}, cache ${row.externalCacheStatus || "none"}, paid ${row.paidSearchUsed || false}`,
      `Issues: ${issueSummary || "none"}`,
    ];

    try {
      await navigator.clipboard.writeText(summaryLines.join("\n"));
      setBatchError(null);
      setBatchDraftMessage(`Copied row ${row.row} test summary.`);
    } catch {
      setBatchError("Could not copy the row test summary.");
    }
  }

  async function copyTestModelBatchRowDraftPayload(
    card: BatchCard,
    index: number
  ) {
    if (!testMode) return;

    if (!isDraftableBatchCard(card)) {
      setBatchError(
        "Draft payload copy is available after the row has a complete, draftable scan result."
      );
      return;
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      scope: "instacomp_test_row_draft_payload",
      route: "/instacomp-test",
      row: index + 1,
      draftReady:
        isDraftableBatchCard(card) && draftReadinessErrors(card).length === 0,
      reviewWarnings: batchCardReviewWarnings(card),
      draftReadinessErrors: isDraftableBatchCard(card)
        ? draftReadinessErrors(card)
        : ["Row is not draftable."],
      item: draftListingItemsForCards([card])[0],
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setBatchError(null);
      setBatchDraftMessage(`Copied row ${index + 1} draft payload.`);
    } catch {
      setBatchError("Could not copy the row draft payload.");
    }
  }

  function testModelFixtureManifestPayload() {
    const scenarios: TestModelCheckScenario[] = [
      "completed_matrix",
      "scan_cycle",
      "draft_cycle",
    ];

    return {
      exportedAt: new Date().toISOString(),
      scope: "instacomp_test_fixture_manifest",
      route: "/instacomp-test",
      fixtureCount: TEST_SCAN_FIXTURES.length,
      lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD,
      scenarios: scenarios.map((scenario) => ({
        scenario,
        expectedCounts: expectedTestModelScenarioCounts(scenario),
      })),
      fixtures: TEST_SCAN_FIXTURES.map((fixture, index) => ({
        row: index + 1,
        slug: fixture.slug,
        label: fixture.label,
        hasBackImage: Boolean(fixture.backLabel),
        marketPrice: fixture.marketPrice,
        coverageTags: testFixtureCoverageTags(fixture),
        intentionalStates: {
          scanError: fixture.scanError || null,
          noComps: Boolean(fixture.noComps),
          customQuantity: fixture.customQuantity || null,
          initialDraftStatus: fixture.initialDraftStatus || "idle",
          initialDraftError: fixture.initialDraftError || null,
          draftCreateError: fixture.draftCreateError || null,
        },
        ai: fixture.ai,
      })),
    };
  }

  function exportTestModelFixtureManifest() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("exporting the fixture manifest")) return;

    const payload = testModelFixtureManifestPayload();

    downloadTextFile(
      `instacomp-test-fixture-manifest-${exportTimestamp()}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8"
    );
    setBatchError(null);
    setBatchDraftMessage(
      `Exported test fixture manifest with ${TEST_SCAN_FIXTURES.length} fixture${
        TEST_SCAN_FIXTURES.length === 1 ? "" : "s"
      }.`
    );
  }

  async function copyTestModelFixtureManifest() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("copying the fixture manifest")) return;

    try {
      await navigator.clipboard.writeText(
        JSON.stringify(testModelFixtureManifestPayload(), null, 2)
      );
      setBatchError(null);
      setBatchDraftMessage(
        `Copied test fixture manifest with ${TEST_SCAN_FIXTURES.length} fixture${
          TEST_SCAN_FIXTURES.length === 1 ? "" : "s"
        }.`
      );
    } catch {
      setBatchError("Could not copy the test fixture manifest.");
    }
  }

  async function copyTestModelQaSummary() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("copying the QA summary")) return;

    if (
      !batchCards.length &&
      !testModelChecks.length &&
      !testModelRunRecords.length
    ) {
      setBatchError("Run a test cycle before copying the QA summary.");
      return;
    }

    const checks = testModelChecks.length
      ? testModelChecks
      : batchCards.length
        ? buildTestModelSmokeChecks(batchCards, testModelCheckScenario)
        : [];

    if (batchCards.length && !testModelChecks.length) {
      setTestModelChecks(checks);
    }

    const passedChecks = checks.filter((check) => check.pass).length;
    const failedChecks = checks.filter((check) => !check.pass);
    const latestRun = testModelRunRecords[0] || null;
    const summaryLines = [
      "InstaComp™ Test Model QA Summary",
      "Route: /instacomp-test",
      `Scenario: ${testModelCheckScenario.replace("_", " ")}`,
      checks.length
        ? `Smoke: ${passedChecks}/${checks.length} passed${
            failedChecks.length ? `, ${failedChecks.length} failed` : ""
          }`
        : "Smoke: no current smoke check",
      latestRun
        ? `Latest run: ${latestRun.label} (${latestRun.passed}/${latestRun.total} passed, ${latestRun.rowCount} rows, ${latestRun.problemRows} problem rows)`
        : "Latest run: none",
      `Rows: ${batchCards.length} total, ${batchDoneCount} done, ${batchErrorCount} failed, ${batchDraftableCount} draftable, ${batchDraftCreatedCount} drafted, ${batchDraftErrorCount} draft errors`,
      `Selected: ${selectedDoneBatchCards.length} draftable, ${selectedDraftReadyCount} ready, ${selectedCleanReadyCount} clean ready`,
      failedChecks.length
        ? `Failing checks: ${failedChecks
            .map(
              (check) =>
                `${check.label} expected ${check.expected}, actual ${check.actual}`
            )
            .join("; ")}`
        : "Failing checks: none",
    ];

    try {
      await navigator.clipboard.writeText(summaryLines.join("\n"));
      setBatchError(null);
      setBatchDraftMessage("Copied test QA summary.");
    } catch {
      setBatchError("Could not copy the test QA summary.");
    }
  }

  function loadTestBatchModel(completed: boolean) {
    if (!testMode) return;

    if (
      showTestModelBusyBlocked(
        completed ? "loading the completed test matrix" : "loading the queued test batch"
      )
    ) {
      return;
    }

    batchCards.forEach(revokeBatchCardPreviewUrls);

    const nextCards = TEST_SCAN_FIXTURES.map((fixture, index) =>
      createTestBatchCard(fixture, index, completed)
    );

    setBatchCards(nextCards);
    setBatchFilter("all");
    setBatchSort("original");
    setBatchSearch("");
    setSelectedBatchQuantity("1");
    setSelectedBatchFixedPrice("");
    setBatchPauseRequested(false);
    batchPauseRequestedRef.current = false;

    if (completed) {
      const checks = buildTestModelSmokeChecks(nextCards, "completed_matrix");
      const failedCount = checks.filter((check) => !check.pass).length;

      setTestModelCheckScenario("completed_matrix");
      setTestModelChecks(checks);
      recordTestModelRun(
        "Completed Matrix",
        "completed_matrix",
        checks,
        nextCards
      );
      setBatchError(
        failedCount
          ? `Test smoke check has ${failedCount} failing check${
              failedCount === 1 ? "" : "s"
            }.`
          : null
      );
      setBatchDraftMessage(
        `Loaded ${nextCards.length} completed test rows. ${testModelSmokeCheckMessage(
          checks
        )}`
      );
    } else {
      setTestModelCheckScenario("scan_cycle");
      setTestModelChecks([]);
      setBatchError(null);
      setBatchDraftMessage(`Loaded ${nextCards.length} queued test rows.`);
    }
  }

  async function runTestModelFullCycle() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("running the full test cycle")) return;

    batchCards.forEach(revokeBatchCardPreviewUrls);

    const queuedCards = TEST_SCAN_FIXTURES.map((fixture, index) =>
      createTestBatchCard(fixture, index, false)
    );

    setBatchCards(queuedCards);
    setBatchFilter("all");
    setBatchSort("original");
    setBatchSearch("");
    setSelectedBatchQuantity("1");
    setSelectedBatchFixedPrice("");
    setBatchPauseRequested(false);
    batchPauseRequestedRef.current = false;
    setTestModelCheckScenario("scan_cycle");
    setTestModelChecks([]);
    setBatchError(null);
    setBatchDraftMessage("Running full test cycle...");
    setBatchRunning(true);

    const completedCards: BatchCard[] = [];

    try {
      for (const card of queuedCards) {
        completedCards.push(await scanOneBatchCard(card));
      }

      const checks = buildTestModelSmokeChecks(completedCards, "scan_cycle");
      const failedCount = checks.filter((check) => !check.pass).length;

      setBatchCards(completedCards);
      setTestModelChecks(checks);
      recordTestModelRun(
        "Full Scan Cycle",
        "scan_cycle",
        checks,
        completedCards
      );
      setBatchError(
        failedCount
          ? `Full test cycle has ${failedCount} failing check${
              failedCount === 1 ? "" : "s"
            }.`
          : null
      );
      setBatchDraftMessage(
        `Full test cycle scanned ${completedCards.length} fixture${
          completedCards.length === 1 ? "" : "s"
        }. ${testModelSmokeCheckMessage(checks)}`
      );
    } finally {
      setBatchRunning(false);
    }
  }

  async function runTestModelDraftCycle() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("running the draft test cycle")) return;

    batchCards.forEach(revokeBatchCardPreviewUrls);

    const queuedCards = TEST_SCAN_FIXTURES.map((fixture, index) =>
      createTestBatchCard(fixture, index, false)
    );

    setBatchCards(queuedCards);
    setBatchFilter("all");
    setBatchSort("original");
    setBatchSearch("");
    setSelectedBatchQuantity("1");
    setSelectedBatchFixedPrice("");
    setBatchPauseRequested(false);
    batchPauseRequestedRef.current = false;
    setTestModelCheckScenario("draft_cycle");
    setTestModelChecks([]);
    setBatchError(null);
    setBatchDraftMessage("Running draft test cycle...");
    setBatchRunning(true);

    const completedCards: BatchCard[] = [];

    try {
      for (const card of queuedCards) {
        completedCards.push(await scanOneBatchCard(card));
      }

      setBatchRunning(false);
      setBatchDrafting(true);

      const targetDraftCards = completedCards.filter(
        (card) =>
          card.selected &&
          isDraftableBatchCard(card) &&
          draftReadinessErrors(card).length === 0
      );
      const draftedCards = applyTestDraftResults(completedCards, targetDraftCards);
      const checks = buildTestModelSmokeChecks(draftedCards, "draft_cycle");
      const failedCount = checks.filter((check) => !check.pass).length;
      const simulatedErrorCount = draftedCards.filter(
        (card) => card.draftStatus === "error"
      ).length;
      const createdCount = draftedCards.filter(
        (card) => card.draftStatus === "created"
      ).length;

      await waitForTestModel();

      setBatchCards(draftedCards);
      setTestModelChecks(checks);
      recordTestModelRun(
        "Draft Cycle",
        "draft_cycle",
        checks,
        draftedCards
      );
      setBatchError(
        failedCount
          ? `Draft test cycle has ${failedCount} failing check${
              failedCount === 1 ? "" : "s"
            }.`
          : null
      );
      setBatchDraftMessage(
        `Draft test cycle scanned ${completedCards.length} fixture${
          completedCards.length === 1 ? "" : "s"
        }, created ${createdCount} draft${createdCount === 1 ? "" : "s"}, and left ${
          simulatedErrorCount
        } draft error${simulatedErrorCount === 1 ? "" : "s"}. ${testModelSmokeCheckMessage(
          checks
        )}`
      );
    } finally {
      setBatchRunning(false);
      setBatchDrafting(false);
    }
  }

  async function runAllTestModelCycles() {
    if (!testMode) return;

    if (showTestModelBusyBlocked("running all test cycles")) return;

    batchCards.forEach(revokeBatchCardPreviewUrls);

    setBatchFilter("all");
    setBatchSort("original");
    setBatchSearch("");
    setSelectedBatchQuantity("1");
    setSelectedBatchFixedPrice("");
    setBatchPauseRequested(false);
    batchPauseRequestedRef.current = false;
    setTestModelCheckScenario("completed_matrix");
    setTestModelChecks([]);
    setBatchError(null);
    setBatchDraftMessage("Running all test cycles...");

    const completedMatrixCards = TEST_SCAN_FIXTURES.map((fixture, index) =>
      createTestBatchCard(fixture, index, true)
    );
    const completedMatrixChecks = buildTestModelSmokeChecks(
      completedMatrixCards,
      "completed_matrix"
    );

    recordTestModelRun(
      "Completed Matrix",
      "completed_matrix",
      completedMatrixChecks,
      completedMatrixCards
    );
    completedMatrixCards.forEach(revokeBatchCardPreviewUrls);

    const queuedCards = TEST_SCAN_FIXTURES.map((fixture, index) =>
      createTestBatchCard(fixture, index, false)
    );

    setBatchCards(queuedCards);
    setTestModelCheckScenario("scan_cycle");
    setBatchRunning(true);

    const completedCards: BatchCard[] = [];

    try {
      for (const card of queuedCards) {
        completedCards.push(await scanOneBatchCard(card));
      }

      const scanChecks = buildTestModelSmokeChecks(completedCards, "scan_cycle");

      recordTestModelRun(
        "Full Scan Cycle",
        "scan_cycle",
        scanChecks,
        completedCards
      );

      setBatchRunning(false);
      setBatchDrafting(true);

      const targetDraftCards = completedCards.filter(
        (card) =>
          card.selected &&
          isDraftableBatchCard(card) &&
          draftReadinessErrors(card).length === 0
      );
      const draftedCards = applyTestDraftResults(completedCards, targetDraftCards);
      const draftChecks = buildTestModelSmokeChecks(draftedCards, "draft_cycle");
      const failedChecks = draftChecks.filter((check) => !check.pass).length;

      await waitForTestModel();

      recordTestModelRun(
        "Draft Cycle",
        "draft_cycle",
        draftChecks,
        draftedCards
      );
      setBatchCards(draftedCards);
      setTestModelCheckScenario("draft_cycle");
      setTestModelChecks(draftChecks);
      setBatchError(
        failedChecks
          ? `All test cycles finished with ${failedChecks} draft-cycle failing check${
              failedChecks === 1 ? "" : "s"
            }.`
          : null
      );
      setBatchDraftMessage(
        `All test cycles finished. Completed matrix ${completedMatrixChecks.filter(
          (check) => check.pass
        ).length}/${completedMatrixChecks.length}, scan ${scanChecks.filter(
          (check) => check.pass
        ).length}/${scanChecks.length}, draft ${draftChecks.filter(
          (check) => check.pass
        ).length}/${draftChecks.length}.`
      );
    } finally {
      setBatchRunning(false);
      setBatchDrafting(false);
    }
  }

  function loadSingleTestScan() {
    if (!testMode) return;

    if (loading) {
      setBatchError("Finish the current single-card InstaComp™ scan before loading test images.");
      return;
    }

    if (showTestModelBusyBlocked("loading single-card test scan images")) return;

    const fixture = TEST_SCAN_FIXTURES[0];
    const frontFile = testImageFile(
      `${fixture.slug}-single-front.svg`,
      fixture.label,
      fixture.color
    );
    const backFile = fixture.backLabel
      ? testImageFile(
          `${fixture.slug}-single-back.svg`,
          fixture.backLabel,
          fixture.color
        )
      : null;

    handleFrontChange(frontFile);
    handleBackChange(backFile);
    setCopiedPrice(null);
    setTestModelChecks([]);
    setBatchDraftMessage("Loaded single-card test scan images.");
  }

  function addBatchFiles(fileList: FileList | File[]) {
    if (persistentJob) {
      setBatchError(
        "This lot already has a durable scan job. Clear the finished lot before adding different cards."
      );
      return;
    }

    const files = Array.from(fileList).filter((file) =>
      file.type.startsWith("image/")
    );

    if (!files.length) {
      setBatchError("Drop image files only.");
      return;
    }

    setTestModelChecks([]);

    setBatchCards((current) => {
      const remainingSlots = MAX_BATCH_CARDS - current.length;

      if (remainingSlots <= 0) {
        setBatchError(`Batch limit is ${MAX_BATCH_CARDS} cards.`);
        return current;
      }

      const { pairs, skippedBackOnly, orderPairedCount } =
        buildBatchPairs(files);
      const existingSignatures = new Set(current.map(batchCardSignature));
      const newSignatures = new Set<string>();
      const uniquePairs: BatchPair[] = [];
      let skippedDuplicates = 0;

      pairs.forEach((pair) => {
        const signature = batchPairSignature(pair);

        if (existingSignatures.has(signature) || newSignatures.has(signature)) {
          skippedDuplicates += 1;
          return;
        }

        newSignatures.add(signature);
        uniquePairs.push(pair);
      });

      const acceptedPairs = uniquePairs.slice(0, remainingSlots);
      const nextCards = acceptedPairs.map<BatchCard>((pair, index) => ({
        id: `${pair.front.file.name}-${pair.front.file.lastModified}-${pair.front.file.size}-${pair.back?.file.name || "front-only"}-${Date.now()}-${index}`,
        file: pair.front.file,
        backFile: pair.back?.file || null,
        originalFile: pair.front.file,
        originalBackFile: pair.back?.file || null,
        frontRotationDegrees: 0,
        backRotationDegrees: 0,
        previewUrl: createBatchPreviewUrl(pair.front.file),
        backPreviewUrl: pair.back ? createBatchPreviewUrl(pair.back.file) : null,
        status: "queued",
        selected: true,
        operatorMarkedWrong: false,
        operatorNeedsMoreInfo: false,
        result: null,
        marketPrice: null,
        customTitle: "",
        customSerialNumber: "",
        customQuantity: "1",
        customPrice: "",
        error: null,
        draftStatus: "idle",
        draftError: null,
        draftInventoryItemId: null,
        draftLegacyProductId: null,
        draftSku: null,
        tradeStatus: "idle",
        tradeError: null,
        tradeCollectionItemId: null,
        pairingConfidence: pair.pairingConfidence,
        pairingMethod: pair.pairingMethod,
        scanQueuedAt: new Date().toISOString(),
        scanStartedAt: null,
        scanCompletedAt: null,
        scanElapsedMs: null,
      }));
      const pairedCount = acceptedPairs.filter((pair) => pair.back).length;

      if (
        uniquePairs.length > acceptedPairs.length ||
        skippedBackOnly > 0 ||
        skippedDuplicates > 0 ||
        orderPairedCount > 0
      ) {
        const messages = [
          uniquePairs.length > acceptedPairs.length
            ? `Added ${acceptedPairs.length} cards. Batch limit is ${MAX_BATCH_CARDS}.`
            : null,
          orderPairedCount
            ? `Paired ${orderPairedCount} card${
                orderPairedCount === 1 ? "" : "s"
              } by upload order because filenames did not say front/back.`
            : null,
          skippedBackOnly
            ? `Skipped ${skippedBackOnly} back images without matching front images.`
            : null,
          skippedDuplicates
            ? `Skipped ${skippedDuplicates} duplicate card${
                skippedDuplicates === 1 ? "" : "s"
              }.`
            : null,
        ].filter(Boolean);

        setBatchError(messages.join(" "));
      } else if (pairedCount > 0) {
        setBatchError(
          `Paired ${pairedCount} front/back card${pairedCount === 1 ? "" : "s"} by filename.`
        );
      } else {
        setBatchError(null);
      }

      return nextCards.length ? [...current, ...nextCards] : current;
    });
  }

  function updateBatchCard(
    id: string,
    updater: (card: BatchCard) => BatchCard
  ) {
    setBatchCards((current) =>
      current.map((card) => (card.id === id ? updater(card) : card))
    );
  }

  function revokeBatchCardPreviewUrls(card: BatchCard) {
    URL.revokeObjectURL(card.previewUrl);

    if (card.backPreviewUrl) {
      URL.revokeObjectURL(card.backPreviewUrl);
    }

    const previewUrls = batchPreviewUrlsRef.current;

    for (let index = previewUrls.length - 1; index >= 0; index -= 1) {
      if (
        previewUrls[index] === card.previewUrl ||
        previewUrls[index] === card.backPreviewUrl
      ) {
        previewUrls.splice(index, 1);
      }
    }
  }

  function forgetBatchPreviewUrl(url: string | null | undefined) {
    if (!url) return;

    URL.revokeObjectURL(url);

    const previewUrls = batchPreviewUrlsRef.current;
    const index = previewUrls.indexOf(url);

    if (index >= 0) {
      previewUrls.splice(index, 1);
    }
  }

  async function rotateBatchCardImage(
    cardId: string,
    side: "primary" | "paired",
    direction: "left" | "right"
  ) {
    if (showBatchBusyBlocked("rotating this row image")) return;

    const card = batchCards.find((row) => row.id === cardId);
    const file =
      side === "primary"
        ? card?.originalFile || card?.file
        : card?.originalBackFile || card?.backFile;

    if (!card || !file || card.draftStatus !== "idle") return;

    if (file.size <= 0) {
      setBatchError(
        "This recovered saved-lot image is remote-only in this browser. Reselect the original image file, then rotate it before retrying."
      );
      return;
    }

    setBatchError(null);
    setBatchDraftMessage(null);

    try {
      const nextDegrees =
        side === "primary"
          ? nextRotationDegrees(card.frontRotationDegrees, direction)
          : nextRotationDegrees(card.backRotationDegrees, direction);
      const rotatedFile = await rotateImageFile(file, nextDegrees);
      const rotatedPreviewUrl = createBatchPreviewUrl(rotatedFile);

      persistentBindingsRef.current.delete(cardId);

      updateBatchCard(cardId, (current) => {
        const preserveScanAfterRotation = {
          status: current.status === "error" ? ("queued" as const) : current.status,
          error: current.status === "error" ? null : current.error,
          persistentClientId: undefined,
          persistentJobId: null,
          persistentItemId: null,
          frontStoragePath: null,
          backStoragePath: null,
        };

        if (side === "primary") {
          forgetBatchPreviewUrl(current.previewUrl);
          return {
            ...current,
            file: rotatedFile,
            originalFile: file,
            frontRotationDegrees: nextDegrees,
            previewUrl: rotatedPreviewUrl,
            ...preserveScanAfterRotation,
          };
        }

        forgetBatchPreviewUrl(current.backPreviewUrl);
        return {
          ...current,
          backFile: rotatedFile,
          originalBackFile: file,
          backRotationDegrees: nextDegrees,
          backPreviewUrl: rotatedPreviewUrl,
          ...preserveScanAfterRotation,
        };
      });
      setBatchDraftMessage(
        "Image rotated without clearing the scan. Retry this row when you want InstaComp™ to rescan the corrected local image."
      );
    } catch (error: any) {
      setBatchError(error?.message || "Could not rotate this batch image.");
    }
  }

  function swapBatchCardImages(cardId: string) {
    if (batchKnowledgeSaving) {
      setBatchError(
        "Finish TCOS Card DB processing before swapping row images."
      );
      return;
    }

    if (showBatchBusyBlocked("swapping this row's front/back images")) return;

    const card = batchCards.find((row) => row.id === cardId);

    if (!card?.backFile || card.draftStatus !== "idle") return;

    if (card.file.size <= 0 || card.backFile.size <= 0) {
      setBatchError(
        "This recovered saved-lot pair is remote-only in this browser. Reselect the original images, then swap before retrying."
      );
      return;
    }

    persistentBindingsRef.current.delete(cardId);
    setBatchError(null);
    setBatchDraftMessage(
      "Front/back images swapped. Retry this row when you want InstaComp™ to rescan the corrected pair."
    );

    updateBatchCard(cardId, (current) => {
      if (!current.backFile || !current.backPreviewUrl) return current;

      return {
        ...current,
        file: current.backFile,
        backFile: current.file,
        originalFile: current.originalBackFile || current.backFile,
        originalBackFile: current.originalFile || current.file,
        frontRotationDegrees: current.backRotationDegrees || 0,
        backRotationDegrees: current.frontRotationDegrees || 0,
        previewUrl: current.backPreviewUrl,
        backPreviewUrl: current.previewUrl,
        status: current.status === "error" ? "queued" : current.status,
        error: current.status === "error" ? null : current.error,
        persistentClientId: undefined,
        persistentJobId: null,
        persistentItemId: null,
        frontStoragePath: null,
        backStoragePath: null,
        pairingMethod: "upload_order",
        pairingConfidence: 1,
      };
    });
  }

  async function cancelPersistentItem(params: {
    jobId: string | null | undefined;
    itemId: string | null | undefined;
  }) {
    if (!params.jobId || !params.itemId) return null;

    return persistentJobJson(
      `/api/instacomp/jobs/${params.jobId}/items/${params.itemId}`,
      {
        method: "PATCH",
        body: {
          status: "cancelled",
          error: {
            code: "seller_removed_scan_row",
            message:
              "The seller removed this card row from the InstaComp™ scanner review.",
          },
        },
      }
    );
  }

  function abortBatchCardScan(cardId: string) {
    const controller = batchCardAbortControllersRef.current.get(cardId);

    if (!controller) return false;

    controller.abort();
    batchCardAbortControllersRef.current.delete(cardId);
    return true;
  }

  function persistentRemovalTargetForBatchCard(card: BatchCard) {
    const binding = persistentBindingsRef.current.get(card.id);

    return {
      jobId: card.persistentJobId || binding?.jobId || null,
      itemId: card.persistentItemId || binding?.itemId || null,
    };
  }

  async function cancelPersistentBatchCard(
    card: BatchCard,
    target = persistentRemovalTargetForBatchCard(card)
  ) {

    return cancelPersistentItem({
      jobId: target.jobId,
      itemId: target.itemId,
    });
  }

  function rememberRemovedPersistentBatchCard(card: BatchCard) {
    const binding = persistentBindingsRef.current.get(card.id);
    const itemId = card.persistentItemId || binding?.itemId;
    const clientItemId = card.persistentClientId || binding?.clientItemId;

    if (itemId) {
      removedPersistentItemIdsRef.current.add(itemId);
    }

    if (clientItemId) {
      removedPersistentClientIdsRef.current.add(clientItemId);
    }
  }

  function claimedPersistentItemWasRemoved(item: PersistentClaimedItem) {
    return (
      removedPersistentItemIdsRef.current.has(String(item.id || "")) ||
      removedPersistentClientIdsRef.current.has(String(item.client_item_id || ""))
    );
  }

  function forgetRemovedBatchCard(card: BatchCard) {
    removedBatchCardIdsRef.current.add(card.id);
    rememberRemovedPersistentBatchCard(card);
    revokeBatchCardPreviewUrls(card);
    persistentBindingsRef.current.delete(card.id);

    if (card.persistentItemId) {
      serialOverrideByItemIdRef.current.delete(card.persistentItemId);
    }
  }

  async function removeBatchCard(cardId: string) {
    const card = batchCards.find((row) => row.id === cardId);

    if (!card) return;

    if (removingBatchCardIdsRef.current.has(cardId)) {
      setBatchError("This InstaComp™ row is already being removed.");
      return;
    }

    const blockedReason = instaCompBatchRowRemovalBlockedReason({
      batchDrafting,
      draftStatus: card.draftStatus,
      isRemoving: removingBatchCardIds.has(cardId),
    });

    if (blockedReason) {
      setBatchError(blockedReason);
      return;
    }

    setBatchError(null);
    const cardTitle = draftTitleForCard(card);
    const persistentTarget = persistentRemovalTargetForBatchCard(card);
    const isPersisted = Boolean(persistentTarget.jobId && persistentTarget.itemId);
    const abortedActiveScan = abortBatchCardScan(cardId);
    const endedPendingScan = card.status === "queued" || card.status === "scanning";

    removingBatchCardIdsRef.current.add(cardId);
    setRemovingBatchCardIds((current) => new Set(current).add(cardId));
    setBatchCards((current) =>
      current.filter((row) => {
        if (row.id !== cardId) return true;

        forgetRemovedBatchCard(row);
        return false;
      })
    );
    setBatchDraftMessage(
      isPersisted
        ? `Removed ${cardTitle} from this batch. Cancelling its saved InstaComp™ row...`
        : abortedActiveScan
          ? `Ended active scan for ${cardTitle} and removed it from this batch.`
        : endedPendingScan
          ? `Ended pending scan for ${cardTitle} and removed it from this batch.`
        : `Removed ${cardTitle} from this batch.`
    );

    try {
      if (isPersisted) {
        const data = await cancelPersistentBatchCard(card, persistentTarget);

        if (data?.job) {
          setPersistentJob(data.job as PersistentJobSummary);
        }

        setBatchDraftMessage(`Removed ${cardTitle} from this batch and cancelled the saved row.`);
      }
    } catch (error: any) {
      setBatchError(
        `Removed ${cardTitle} locally, but the saved InstaComp™ job row could not be cancelled: ${
          error?.message || "Unknown server error."
        } Refreshing a still-active saved lot may bring that row back until the server accepts cancellation.`
      );
      setBatchDraftMessage(`Removed ${cardTitle} from the visible batch.`);
    } finally {
      removingBatchCardIdsRef.current.delete(cardId);
      setRemovingBatchCardIds((current) => {
        const next = new Set(current);
        next.delete(cardId);
        return next;
      });
    }
  }

  async function removeBatchCardsByIds(
    ids: Set<string>,
    count: number,
    busyAction: string,
    emptyMessage: string,
    removedMessage: string
  ) {
    if (showBatchBusyBlocked(busyAction)) return;

    if (!count) {
      setBatchError(emptyMessage);
      return;
    }

    const cardsToRemove = batchCards.filter(
      (card) => ids.has(card.id) && card.draftStatus !== "drafting"
    );

    if (!cardsToRemove.length) {
      setBatchError(emptyMessage);
      return;
    }

    setBatchError(null);
    const persistedCards = cardsToRemove
      .map((card) => ({
        card,
        target: persistentRemovalTargetForBatchCard(card),
      }))
      .filter(({ target }) => Boolean(target.jobId && target.itemId));
    const removeIds = new Set(cardsToRemove.map((card) => card.id));
    cardsToRemove.forEach((card) => abortBatchCardScan(card.id));

    setBatchDraftMessage(removedMessage);
    setBatchCards((current) =>
      current.filter((card) => {
        if (!removeIds.has(card.id)) return true;

        forgetRemovedBatchCard(card);
        return false;
      })
    );

    if (!persistedCards.length) return;

    const results = await Promise.allSettled(
      persistedCards.map(({ card, target }) =>
        cancelPersistentBatchCard(card, target)
      )
    );
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<any> =>
        result.status === "fulfilled"
    );
    const failed = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    const latestJob = fulfilled
      .map((result) => result.value)
      .slice()
      .reverse()
      .find((result) => result?.job)?.job;

    if (latestJob) {
      setPersistentJob(latestJob as PersistentJobSummary);
    }

    if (failed.length > 0) {
      setBatchError(
        `${failed.length}/${persistedCards.length} saved InstaComp™ row${
          failed.length === 1 ? "" : "s"
        } could not be cancelled server-side. The row${
          failed.length === 1 ? " is" : "s are"
        } gone from this view, but a refresh may recover ${
          failed.length === 1 ? "it" : "them"
        } until storage accepts cancellation.`
      );
    } else {
      setBatchDraftMessage(
        `${removedMessage} Cancelled ${persistedCards.length} saved row${
          persistedCards.length === 1 ? "" : "s"
        } in storage.`
      );
    }
  }

  function removeVisibleFailedBatchCards() {
    void removeBatchCardsByIds(
      visibleFailedBatchCardIds,
      visibleFailedCount,
      "removing visible failed rows",
      "No visible failed rows are available to remove.",
      `Removed ${visibleFailedCount} visible failed row${
        visibleFailedCount === 1 ? "" : "s"
      } from this batch.`
    );
  }

  function removeVisibleDraftedBatchCards() {
    void removeBatchCardsByIds(
      visibleDraftedBatchCardIds,
      visibleDraftedCount,
      "removing visible drafted rows",
      "No visible drafted rows are available to remove.",
      `Removed ${visibleDraftedCount} visible drafted row${
        visibleDraftedCount === 1 ? "" : "s"
      } from this batch.`
    );
  }

  function removeSelectedOperatorMarkedProblemBatchCards() {
    void removeBatchCardsByIds(
      selectedOperatorMarkedProblemBatchCardIds,
      selectedOperatorMarkedProblemCount,
      "removing selected marked problem rows",
      "Select wrong or needs-more-info rows before removing marked problems.",
      `Removed ${selectedOperatorMarkedProblemCount} selected marked problem row${
        selectedOperatorMarkedProblemCount === 1 ? "" : "s"
      } from this batch.`
    );
  }

  function clearDraftErrorsByIds(
    ids: Set<string>,
    count: number,
    emptyMessage: string,
    clearedMessage: string
  ) {
    if (showBatchBusyBlocked("clearing draft errors")) return;

    if (!count) {
      setBatchError(emptyMessage);
      return;
    }

    setBatchError(null);
    setBatchDraftMessage(clearedMessage);
    setBatchCards((current) =>
      current.map((card) =>
        ids.has(card.id) && card.draftStatus === "error"
          ? {
              ...card,
              draftStatus: "idle",
              draftError: null,
            }
          : card
      )
    );
  }

  function clearSelectedDraftErrors() {
    clearDraftErrorsByIds(
      selectedDraftErrorBatchCardIds,
      selectedDraftErrorCount,
      "No selected draft errors are available to clear.",
      `Cleared ${selectedDraftErrorCount} selected draft error${
        selectedDraftErrorCount === 1 ? "" : "s"
      }.`
    );
  }

  function clearVisibleDraftErrors() {
    clearDraftErrorsByIds(
      visibleDraftErrorBatchCardIds,
      visibleDraftErrorCount,
      "No visible draft errors are available to clear.",
      `Cleared ${visibleDraftErrorCount} visible draft error${
        visibleDraftErrorCount === 1 ? "" : "s"
      }.`
    );
  }

  function resetSelectedDraftEdits() {
    if (showBatchBusyBlocked("resetting selected draft edits")) return;

    if (!selectedDoneBatchCards.length) {
      setBatchError("Select at least one draftable row to reset.");
      return;
    }

    setBatchError(null);
    setSelectedBatchQuantity("1");
    setSelectedBatchFixedPrice("");
    setBatchDraftMessage(
      `Reset ${selectedDoneBatchCards.length} selected draft row${
        selectedDoneBatchCards.length === 1 ? "" : "s"
      }.`
    );
    setBatchCards((current) =>
      current.map((card) =>
        card.selected && isDraftableBatchCard(card)
          ? resetDraftEditsForCard(card)
          : card
      )
    );
  }

  function resetVisibleDraftEdits() {
    if (showBatchBusyBlocked("resetting visible draft edits")) return;

    if (!visibleDraftableCount) {
      setBatchError("No visible draftable rows are available to reset.");
      return;
    }

    setBatchError(null);
    setSelectedBatchQuantity("1");
    setSelectedBatchFixedPrice("");
    setBatchDraftMessage(
      `Reset ${visibleDraftableCount} visible draft row${
        visibleDraftableCount === 1 ? "" : "s"
      }.`
    );
    setBatchCards((current) =>
      current.map((card) =>
        visibleDraftableBatchCardIds.has(card.id)
          ? resetDraftEditsForCard(card)
          : card
      )
    );
  }

  async function clearBatch() {
    if (
      persistentJob &&
      ![
        "completed",
        "completed_with_errors",
        "failed",
        "cancelled",
      ].includes(persistentJob.status)
    ) {
      try {
        const cancelled = await persistentJobJson(
          `/api/instacomp/jobs/${persistentJob.id}`,
          {
            method: "PATCH",
            body: {
              status: "cancelling",
              cancelRequested: true,
              forceCancel: true,
            },
          }
        );
        setPersistentJob(cancelled.job as PersistentJobSummary);

        if (cancelled.job?.status === "cancelling") {
          setBatchError(
            "Clear Batch force-cancelled active workers, but the saved lot is still closing in storage. Try Clear Batch again in a few seconds."
          );
          return;
        }
      } catch (error: any) {
        setBatchError(
          error?.message || "Could not cancel the saved InstaComp™ job."
        );
        return;
      }
    }

    batchCards.forEach(revokeBatchCardPreviewUrls);
    setBatchCards([]);
    resetBatchView();
    setSelectedBatchQuantity("1");
    setSelectedBatchFixedPrice("");
    setBatchError(null);
    setBatchDraftMessage(null);
    setTestModelChecks([]);
    setPersistentJob(null);
    setPersistentUploadProgress(null);
    setPersistentJobPreparing(false);
    removingBatchCardIdsRef.current.clear();
    quantityMergeRunningRef.current = false;
    setRemovingBatchCardIds(new Set());
    removedBatchCardIdsRef.current.clear();
    removedPersistentItemIdsRef.current.clear();
    removedPersistentClientIdsRef.current.clear();
    persistentBindingsRef.current.clear();
    batchCardAbortControllersRef.current.forEach((controller) => controller.abort());
    batchCardAbortControllersRef.current.clear();
    persistentClientBatchIdRef.current = null;
    openAIRateLimitPauseRef.current = false;
    try {
      window.localStorage.removeItem(INSTACOMP_LAST_JOB_STORAGE_KEY);
    } catch {
      // Local recovery is optional; clearing the visible batch must still work.
    }
    batchPauseRequestedRef.current = false;
    setBatchPauseRequested(false);
  }

  function resetTestLab() {
    if (!testMode) return;

    if (loading) {
      setBatchError("Finish the current single-card InstaComp™ scan before resetting the test lab.");
      return;
    }

    if (showTestModelBusyBlocked("resetting the test lab")) return;

    void clearBatch();

    if (frontPreview) URL.revokeObjectURL(frontPreview);
    if (backPreview) URL.revokeObjectURL(backPreview);

    setFrontImage(null);
    setBackImage(null);
    setFrontOriginalImage(null);
    setBackOriginalImage(null);
    setFrontRotationDegrees(0);
    setBackRotationDegrees(0);
    setFrontPreview(null);
    setBackPreview(null);
    setResult(null);
    setError(null);
    setCopiedPrice(null);
    setTestModelCheckScenario("completed_matrix");
    setBatchDraftMessage("Reset test lab. Run ledger was kept.");
  }

  function showTestModelProblemRows(
    filter: BatchCardFilter,
    count: number,
    label = "problem rows"
  ) {
    if (showTestModelBusyBlocked(`showing ${label.toLocaleLowerCase()}`)) return;

    if (!count) {
      setBatchError(`No ${label.toLocaleLowerCase()} are available to show.`);
      return;
    }

    setBatchError(null);
    setBatchFilter(filter);
    setBatchDraftMessage(`Showing ${count} ${label.toLocaleLowerCase()}.`);
  }

  function resetBatchView() {
    setBatchFilter("all");
    setBatchSort("original");
    setBatchSearch("");
    setBatchError(null);
  }

  function batchBusyBlockedReason(action: string) {
    if (batchDrafting) {
      return `Finish draft creation before ${action}.`;
    }

    if (batchRunning) {
      return `Finish the current InstaComp™ scan/action before ${action}.`;
    }

    return null;
  }

  function showBatchBusyBlocked(action: string) {
    const blockedReason = batchBusyBlockedReason(action);

    if (!blockedReason) return false;

    setBatchError(blockedReason);
    return true;
  }

  function batchActionTitle({
    action,
    blocked,
    ready,
  }: {
    action: string;
    blocked?: string;
    ready: string;
  }) {
    return batchBusyBlockedReason(action) || blocked || ready;
  }

  function testModelBusyBlockedReason(action: string) {
    if (batchDrafting) {
      return `Finish draft creation before ${action}.`;
    }

    if (batchRunning) {
      return `Finish the current InstaComp™ test run before ${action}.`;
    }

    return null;
  }

  function showTestModelBusyBlocked(action: string) {
    const blockedReason = testModelBusyBlockedReason(action);

    if (!blockedReason) return false;

    setBatchError(blockedReason);
    return true;
  }

  function applyBatchPrice(cardId: string, multiplier: number) {
    updateBatchCard(cardId, (card) => {
      const compPrice = primaryCompPriceForCard(card);

      if (!compPrice) return card;

      const price = Math.round(compPrice * multiplier * 100) / 100;

      return {
        ...card,
        customPrice: price.toFixed(2),
      };
    });
  }

  function applySelectedBatchPrice(multiplier: number) {
    if (showBatchBusyBlocked("applying selected prices")) return;

    if (!selectedPriceableBatchCards.length) {
      setBatchError("Select at least one draftable row with a comp price.");
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) => {
        const compPrice = primaryCompPriceForCard(card);

        if (!card.selected || !isDraftableBatchCard(card) || !compPrice) {
          return card;
        }

        const price = Math.round(compPrice * multiplier * 100) / 100;

        return {
          ...card,
          customPrice: price.toFixed(2),
          draftStatus: card.draftStatus === "error" ? "idle" : card.draftStatus,
          draftError: card.draftStatus === "error" ? null : card.draftError,
        };
      })
    );
  }

  function applySelectedBatchFixedPrice() {
    if (showBatchBusyBlocked("applying a fixed selected price")) return;

    if (!selectedDoneBatchCards.length) {
      setBatchError("Select at least one draftable row.");
      return;
    }

    if (!selectedBatchFixedPrice.trim()) {
      setBatchError("Enter a price to apply to selected rows.");
      return;
    }

    const parsed = Number(selectedBatchFixedPrice);

    if (!Number.isFinite(parsed) || parsed < 0) {
      setBatchError("Selected price must be 0 or higher.");
      return;
    }

    const price = Math.round(parsed * 100) / 100;

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) =>
        card.selected && isDraftableBatchCard(card)
          ? {
              ...card,
              customPrice: price.toFixed(2),
              draftStatus: card.draftStatus === "error" ? "idle" : card.draftStatus,
              draftError: card.draftStatus === "error" ? null : card.draftError,
            }
          : card
      )
    );
  }

  function applySelectedBatchQuantity() {
    if (showBatchBusyBlocked("applying selected quantities")) return;

    if (!selectedDoneBatchCards.length) {
      setBatchError("Select at least one draftable row.");
      return;
    }

    const parsed = Number(selectedBatchQuantity);

    if (!Number.isFinite(parsed) || parsed < 1) {
      setBatchError("Selected quantity must be at least 1.");
      return;
    }

    const quantity = String(Math.floor(parsed));

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) =>
        card.selected && isDraftableBatchCard(card)
          ? {
              ...card,
              customQuantity: quantity,
              draftStatus: card.draftStatus === "error" ? "idle" : card.draftStatus,
              draftError: card.draftStatus === "error" ? null : card.draftError,
            }
          : card
      )
    );
  }

  async function mergeSelectedBatchQuantityRows() {
    if (showBatchBusyBlocked("merging selected duplicate quantities")) return;

    if (quantityMergeRunningRef.current) {
      setBatchError("Finish the current InstaComp™ quantity merge before merging again.");
      return;
    }

    const cardsToMerge = batchCards.filter(
      (card) => card.selected && isDraftableBatchCard(card)
    );
    const mergePlan = planInstaCompSelectedQuantityMerge(
      cardsToMerge.map((card) => ({
        id: card.id,
        title: draftTitleForCard(card),
        identityKey: selectedQuantityMergeIdentityKeyForCard(card),
        quantity: draftQuantityForCard(card),
      }))
    );

    if (!mergePlan.ok) {
      setBatchError(mergePlan.reason);
      return;
    }

    const keeper = cardsToMerge.find((card) => card.id === mergePlan.keeperId);
    const duplicateCards = cardsToMerge.filter((card) =>
      mergePlan.duplicateIds.includes(card.id)
    );

    if (!keeper || !duplicateCards.length) {
      setBatchError("Could not find the selected duplicate rows to merge.");
      return;
    }

    const mergedKeeper: BatchCard = {
      ...keeper,
      customQuantity: String(mergePlan.mergedQuantity),
      selected: true,
      draftStatus: keeper.draftStatus === "error" ? "idle" : keeper.draftStatus,
      draftError: keeper.draftStatus === "error" ? null : keeper.draftError,
    };
    const duplicateIds = new Set(mergePlan.duplicateIds);
    const persistedDuplicates = duplicateCards
      .map((card) => ({
        card,
        target: persistentRemovalTargetForBatchCard(card),
      }))
      .filter(({ target }) => Boolean(target.jobId && target.itemId));

    quantityMergeRunningRef.current = true;
    setBatchRunning(true);
    setBatchError(null);
    setBatchDraftMessage(
      `Merging selected duplicate rows into ${mergePlan.title} with quantity ${mergePlan.mergedQuantity}...`
    );

    setBatchCards((current) =>
      current
        .map((card) =>
          card.id === mergePlan.keeperId
            ? {
                ...card,
                customQuantity: String(mergePlan.mergedQuantity),
                selected: true,
                draftStatus: card.draftStatus === "error" ? "idle" : card.draftStatus,
                draftError: card.draftStatus === "error" ? null : card.draftError,
              }
            : card
        )
        .filter((card) => {
          if (!duplicateIds.has(card.id)) return true;

          forgetRemovedBatchCard(card);
          return false;
        })
    );

    try {
      const cancellationResults = await Promise.allSettled(
        persistedDuplicates.map(({ card, target }) =>
          cancelPersistentBatchCard(card, target)
        )
      );
      const latestJob = cancellationResults
        .filter(
          (result): result is PromiseFulfilledResult<any> =>
            result.status === "fulfilled"
        )
        .map((result) => result.value)
        .slice()
        .reverse()
        .find((result) => result?.job)?.job;
      const failedCancellations = cancellationResults.filter(
        (result) => result.status === "rejected"
      ).length;

      if (latestJob) {
        setPersistentJob(latestJob as PersistentJobSummary);
      }

      let savedKeeperQuantity = false;
      let saveError: string | null = null;

      try {
        if (isCorrectionSavableBatchCard(mergedKeeper)) {
          await persistBatchCardCorrections(mergedKeeper);
          savedKeeperQuantity = true;
        }
      } catch (error: any) {
        saveError =
          error?.message || "Merged quantity was not saved to the saved lot.";
      }

      if (failedCancellations || saveError) {
        const warnings = [
          failedCancellations
            ? `${failedCancellations}/${persistedDuplicates.length} duplicate saved row${
                failedCancellations === 1 ? "" : "s"
              } could not be cancelled server-side.`
            : null,
          saveError,
        ].filter(Boolean);

        setBatchError(warnings.join(" "));
      }

      setBatchDraftMessage(
        `Merged ${mergePlan.mergedRowCount} selected duplicate row${
          mergePlan.mergedRowCount === 1 ? "" : "s"
        } into one ${mergePlan.title} row: qty ${mergePlan.previousKeeperQuantity} + ${mergePlan.duplicateQuantity} = ${mergePlan.mergedQuantity}.${
          persistedDuplicates.length
            ? ` Cancelled ${persistedDuplicates.length - failedCancellations}/${persistedDuplicates.length} duplicate saved row${
                persistedDuplicates.length === 1 ? "" : "s"
              }.`
            : ""
        }${savedKeeperQuantity ? " Saved the merged keeper quantity." : " Review or save the keeper row before drafting if you refresh this lot."}`
      );
    } finally {
      quantityMergeRunningRef.current = false;
      setBatchRunning(false);
    }
  }

  function handleBatchPriceChange(cardId: string, value: string) {
    updateBatchCard(cardId, (card) => ({
      ...card,
      customPrice: value,
      draftStatus: card.draftStatus === "error" ? "idle" : card.draftStatus,
      draftError: card.draftStatus === "error" ? null : card.draftError,
    }));
  }

  function handleBatchTitleChange(cardId: string, value: string) {
    updateBatchCard(cardId, (card) => ({
      ...card,
      customTitle: value,
      draftStatus: card.draftStatus === "error" ? "idle" : card.draftStatus,
      draftError: card.draftStatus === "error" ? null : card.draftError,
    }));
  }

  function handleBatchSerialChange(cardId: string, value: string) {
    updateBatchCard(cardId, (card) => {
      const serialNumber = value.trim() || null;

      return {
        ...card,
        customSerialNumber: value,
        result: scanResultWithSerialNumber(card.result, serialNumber),
        marketPrice: null,
        customPrice: "",
        draftStatus: card.draftStatus === "error" ? "idle" : card.draftStatus,
        draftError: card.draftStatus === "error" ? null : card.draftError,
      };
    });
  }

  function handleBatchQuantityChange(cardId: string, value: string) {
    updateBatchCard(cardId, (card) => ({
      ...card,
      customQuantity: value,
      draftStatus: card.draftStatus === "error" ? "idle" : card.draftStatus,
      draftError: card.draftStatus === "error" ? null : card.draftError,
    }));
  }

  function handleBatchConcurrencyChange(value: string) {
    const parsed = Number(value);
    const nextConcurrency = Number.isFinite(parsed)
      ? Math.max(1, Math.min(INSTACOMP_BATCH_MAX_CONCURRENCY, Math.floor(parsed)))
      : INSTACOMP_BATCH_DEFAULT_CONCURRENCY;

    databasePressurePauseRef.current = false;
    openAIRateLimitPauseRef.current = false;
    setBatchConcurrency(nextConcurrency);
  }

  function requestBatchPause() {
    if (!batchRunning) {
      setBatchError("No InstaComp™ batch is running right now.");
      return;
    }

    if (batchPauseRequested) {
      setBatchError("Pause is already requested. Current mini-pack will finish first.");
      return;
    }

    batchPauseRequestedRef.current = true;
    setBatchPauseRequested(true);
    setBatchError(
      "Pause requested. Current claimed InstaComp™ mini-pack will finish first."
    );
  }

  function requestBatchDatabasePressurePause() {
    if (databasePressurePauseRef.current) {
      return true;
    }

    databasePressurePauseRef.current = true;
    batchPauseRequestedRef.current = true;
    setBatchPauseRequested(true);
    setBatchConcurrency((current) => Math.max(1, current - 1));
    setBatchError(
      `Database connection pressure detected. InstaComp™ paused before claiming more work, backed concurrency down by 1, and will use ${INSTACOMP_JOB_CLAIM_CHUNK_SIZE}-card mini-packs on resume to reduce queue round-trips.`
    );
    return true;
  }

  function requestBatchOpenAIRateLimitPause() {
    if (openAIRateLimitPauseRef.current) {
      return true;
    }

    openAIRateLimitPauseRef.current = true;
    batchPauseRequestedRef.current = true;
    setBatchPauseRequested(true);
    setBatchConcurrency(1);
    setBatchError(
      `OpenAI token rate limit hit. InstaComp™ paused before claiming more work and backed Parallel Scans down to 1. Wait about ${INSTACOMP_RATE_LIMIT_RETRY_SECONDS} seconds, then use Continue Rate-Limited.`
    );
    return true;
  }

  function handleBatchDatabasePressureError(error: unknown) {
    if (!isDatabaseConnectionPressureError(error)) {
      return false;
    }

    return requestBatchDatabasePressurePause();
  }

  function handleBatchOpenAIRateLimitError(error: unknown) {
    if (!isOpenAIRateLimitError(error)) {
      return false;
    }

    return requestBatchOpenAIRateLimitPause();
  }

  function handleBatchDatabasePressure(card: BatchCard) {
    if (card.status !== "error" || !isDatabaseConnectionPressureText(card.error)) {
      return false;
    }

    return requestBatchDatabasePressurePause();
  }

  function handleBatchOpenAIRateLimit(card: BatchCard) {
    if (card.status !== "error" || !isOpenAIRateLimitText(card.error)) {
      return false;
    }

    return requestBatchOpenAIRateLimitPause();
  }

  function toggleBatchCardSelected(cardId: string, selected: boolean) {
    updateBatchCard(cardId, (card) => ({
      ...card,
      selected,
    }));
  }

  function toggleBatchCardOperatorMarkedWrong(
    cardId: string,
    operatorMarkedWrong: boolean
  ) {
    if (operatorMarkedWrong) {
      setBatchError(null);
      setBatchFilter("problems");
      setBatchDraftMessage(
        "Marked 1 row wrong. It is now selected in Problems; use Process Marked Problems to rerun it or Export Trial Results to grade it."
      );
    }

    updateBatchCard(cardId, (card) => ({
      ...card,
      operatorMarkedWrong,
      selected: operatorMarkedWrong ? true : card.selected,
      operatorNeedsMoreInfo: operatorMarkedWrong ? false : card.operatorNeedsMoreInfo,
    }));
  }

  function toggleBatchCardOperatorNeedsMoreInfo(
    cardId: string,
    operatorNeedsMoreInfo: boolean
  ) {
    if (operatorNeedsMoreInfo) {
      setBatchError(null);
      setBatchFilter("problems");
      setBatchDraftMessage(
        "Marked 1 row needs more info. It is now selected in Problems; use Process Marked Problems to rerun it or Export Trial Results to grade it."
      );
    }

    updateBatchCard(cardId, (card) => ({
      ...card,
      operatorNeedsMoreInfo,
      selected: operatorNeedsMoreInfo ? true : card.selected,
      operatorMarkedWrong: operatorNeedsMoreInfo ? false : card.operatorMarkedWrong,
    }));
  }

  function markSelectedOperatorReview(
    reviewState: "wrong" | "needs_more_info" | "clear"
  ) {
    const busyReason = batchBusyBlockedReason(
      reviewState === "wrong"
        ? "marking selected rows wrong"
        : reviewState === "needs_more_info"
          ? "marking selected rows as needs more info"
          : "clearing selected review marks"
    );

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    const selectedDoneIds = new Set(
      batchCards
        .filter((card) => card.selected && card.status === "done" && card.result)
        .map((card) => card.id)
    );

    if (!selectedDoneIds.size) {
      setBatchError("Select completed scan rows first, then mark them wrong or needs more info.");
      return;
    }

    setBatchError(null);
    if (reviewState !== "clear") {
      setBatchFilter("problems");
      setBatchSort("original");
    }
    setBatchDraftMessage(
      reviewState === "wrong"
        ? `Marked ${selectedDoneIds.size} selected completed row${
            selectedDoneIds.size === 1 ? "" : "s"
          } wrong. They are now in Problems; use Process Marked Problems to rerun them or Export Trial Results to grade them.`
        : reviewState === "needs_more_info"
          ? `Marked ${selectedDoneIds.size} selected completed row${
              selectedDoneIds.size === 1 ? "" : "s"
            } needs more info. They are now in Problems; use Process Marked Problems to rerun them or Export Trial Results to grade them.`
          : `Cleared operator review marks on ${selectedDoneIds.size} selected completed row${
              selectedDoneIds.size === 1 ? "" : "s"
            }.`
    );

    setBatchCards((current) =>
      current.map((card) =>
        selectedDoneIds.has(card.id)
          ? {
              ...card,
              operatorMarkedWrong: reviewState === "wrong",
              operatorNeedsMoreInfo: reviewState === "needs_more_info",
            }
          : card
      )
    );
  }

  async function persistBatchCardCorrections(card: BatchCard) {
    if (!isCorrectionSavableBatchCard(card)) {
      throw new Error(
        "This row is not attached to a saved InstaComp™ lot yet. Run Batch InstaComp™ first, then save corrections."
      );
    }

    const correctedResult = scanResultWithOperatorCorrections(card);

    if (!correctedResult) {
      throw new Error("This row does not have a scan result to save.");
    }

    await persistentJobJson(
      `/api/instacomp/jobs/${card.persistentJobId}/items/${card.persistentItemId}`,
      {
        method: "PATCH",
        body: {
          result: correctedResult,
          reviewReasons: batchCardReviewWarnings(card),
          analysisModel: "manual_correction_v1",
        },
      }
    );

    return correctedResult;
  }

  async function repriceBatchCardWithSerialCorrection(card: BatchCard) {
    if (!card.persistentJobId || !card.persistentItemId) {
      return persistBatchCardCorrections(card);
    }

    const serialOverride = card.customSerialNumber.trim() || null;
    serialOverrideByItemIdRef.current.set(card.persistentItemId, serialOverride);

    try {
      await requeuePersistentCards([card]);
      const [repricedCard] = await scanPersistentJob(card.persistentJobId, [card]);

      if (!repricedCard?.result) {
        throw new Error("InstaComp™ could not reprice this row after the serial edit.");
      }

      const marketPrice = effectiveMarketStats(repricedCard.result).suggestedPrice;
      const correctedCard: BatchCard = {
        ...repricedCard,
        customTitle: card.customTitle || cardResultTitle(repricedCard.result, card.file.name),
        customSerialNumber: repricedCard.result.ai.serialNumber || "",
        customQuantity: card.customQuantity,
        customPrice: marketPrice ? marketPrice.toFixed(2) : "",
        operatorMarkedWrong: card.operatorMarkedWrong,
        operatorNeedsMoreInfo: card.operatorNeedsMoreInfo,
      };
      const correctedResult = await persistBatchCardCorrections(correctedCard);

      updateBatchCard(card.id, (current) => ({
        ...current,
        result: correctedResult,
        marketPrice,
        customTitle: correctedCard.customTitle,
        customSerialNumber: correctedCard.customSerialNumber,
        customQuantity: correctedCard.customQuantity,
        customPrice: correctedCard.customPrice,
        operatorMarkedWrong: correctedCard.operatorMarkedWrong,
        operatorNeedsMoreInfo: correctedCard.operatorNeedsMoreInfo,
      }));

      return correctedResult;
    } finally {
      serialOverrideByItemIdRef.current.delete(card.persistentItemId);
    }
  }

  async function saveBatchCardCorrections(cardId: string) {
    const busyReason = batchBusyBlockedReason("saving row corrections");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    const card = batchCards.find((row) => row.id === cardId);

    if (!card) return;

    batchPauseRequestedRef.current = false;
    databasePressurePauseRef.current = false;
    openAIRateLimitPauseRef.current = false;
    setBatchRunning(true);
    setActiveBatchCardAction({
      cardId,
      action: "saving_corrections",
    });
    setBatchError(null);
    setBatchDraftMessage("Saving corrections and repricing this row...");

    try {
      await repriceBatchCardWithSerialCorrection(card);
      setBatchDraftMessage(
        "Saved corrections and repriced this InstaComp™ row with the corrected serial."
      );
    } catch (error: any) {
      setBatchError(error?.message || "Could not save correction edits.");
      setBatchDraftMessage(null);
    } finally {
      setBatchRunning(false);
      setActiveBatchCardAction(null);
    }
  }

  async function saveSelectedBatchCorrections() {
    const busyReason = batchKnowledgeSaving
      ? "Finish TCOS Card DB processing before saving selected corrections."
      : batchBusyBlockedReason("saving selected corrections");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    const cardsToSave = batchCards.filter(
      (card) => card.selected && isCorrectionSavableBatchCard(card)
    );

    if (!cardsToSave.length) {
      setBatchError(
        "Select completed rows from a saved InstaComp™ lot before saving corrections."
      );
      return;
    }

    batchPauseRequestedRef.current = false;
    databasePressurePauseRef.current = false;
    openAIRateLimitPauseRef.current = false;
    setBatchRunning(true);
    setBatchError(null);
    setBatchDraftMessage(
      `Saving corrections and repricing ${cardsToSave.length} selected row${
        cardsToSave.length === 1 ? "" : "s"
      }...`
    );

    let savedCount = 0;
    const failedTitles: string[] = [];

    for (const card of cardsToSave) {
      try {
        const correctedResult = await repriceBatchCardWithSerialCorrection(card);
        savedCount += 1;
        updateBatchCard(card.id, (current) => ({
          ...current,
          result: correctedResult,
          marketPrice: marketPriceForCard({
            ...current,
            result: correctedResult,
          }),
        }));
      } catch {
        failedTitles.push(draftTitleForCard(card));
      }
    }

    if (failedTitles.length) {
      setBatchError(
        `Saved ${savedCount}/${cardsToSave.length} correction edits. Failed: ${failedTitles
          .slice(0, 3)
          .join(", ")}${failedTitles.length > 3 ? "..." : ""}`
      );
    }

    setBatchDraftMessage(
      `Saved corrections for ${savedCount} selected row${
        savedCount === 1 ? "" : "s"
      }.`
    );
    setBatchRunning(false);
  }

  async function refreshBatchCardComps(cardId: string) {
    const busyReason = batchKnowledgeSaving
      ? "Finish TCOS Card DB processing before refreshing row comps."
      : batchBusyBlockedReason("refreshing row comps");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    const card = batchCards.find((row) => row.id === cardId);

    if (!card) return;

    if (!isCorrectionSavableBatchCard(card)) {
      setBatchError(
        "Run Batch InstaComp™ first so this row has a saved lot record, then refresh comps."
      );
      return;
    }

    batchPauseRequestedRef.current = false;
    databasePressurePauseRef.current = false;
    openAIRateLimitPauseRef.current = false;
    setBatchRunning(true);
    setActiveBatchCardAction({
      cardId,
      action: "refreshing_comps",
    });
    setBatchError(null);
    setBatchDraftMessage("Refreshing comps for this row...");

    try {
      const refreshedResult = await repriceBatchCardWithSerialCorrection(card);
      const marketPrice = marketPriceForCard({
        ...card,
        result: refreshedResult,
      });

      updateBatchCard(card.id, (current) => ({
        ...current,
        result: refreshedResult,
        marketPrice,
        customPrice:
          current.customPrice.trim() || !marketPrice
            ? current.customPrice
            : marketPrice.toFixed(2),
      }));
      setBatchDraftMessage("Refreshed comps for this InstaComp™ row.");
    } catch (error: any) {
      if (
        !handleBatchOpenAIRateLimitError(error) &&
        !handleBatchDatabasePressureError(error)
      ) {
        setBatchError(error?.message || "Could not refresh comps for this row.");
      }
      setBatchDraftMessage(null);
    } finally {
      setBatchRunning(false);
      setActiveBatchCardAction(null);
    }
  }

  async function refreshSelectedBatchComps() {
    const busyReason = batchKnowledgeSaving
      ? "Finish TCOS Card DB processing before refreshing selected comps."
      : batchBusyBlockedReason("refreshing selected comps");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    const cardsToRefresh = batchCards.filter(
      (card) => card.selected && isCorrectionSavableBatchCard(card)
    );

    if (!cardsToRefresh.length) {
      setBatchError(
        "Select completed rows from a saved InstaComp™ lot before refreshing comps."
      );
      return;
    }

    batchPauseRequestedRef.current = false;
    databasePressurePauseRef.current = false;
    openAIRateLimitPauseRef.current = false;
    setBatchRunning(true);
    setBatchError(null);
    setBatchDraftMessage(
      `Refreshing comps for ${cardsToRefresh.length} selected row${
        cardsToRefresh.length === 1 ? "" : "s"
      }...`
    );

    let refreshedCount = 0;
    const failedTitles: string[] = [];

    for (const card of cardsToRefresh) {
      try {
        const refreshedResult = await repriceBatchCardWithSerialCorrection(card);
        const marketPrice = marketPriceForCard({
          ...card,
          result: refreshedResult,
        });

        refreshedCount += 1;
        updateBatchCard(card.id, (current) => ({
          ...current,
          result: refreshedResult,
          marketPrice,
          customPrice:
            current.customPrice.trim() || !marketPrice
              ? current.customPrice
              : marketPrice.toFixed(2),
        }));
      } catch (error) {
        if (handleBatchOpenAIRateLimitError(error) || handleBatchDatabasePressureError(error)) {
          failedTitles.push(draftTitleForCard(card));
          break;
        }

        failedTitles.push(draftTitleForCard(card));
      }
    }

    if (failedTitles.length) {
      setBatchError(
        `Refreshed ${refreshedCount}/${cardsToRefresh.length} selected row${
          cardsToRefresh.length === 1 ? "" : "s"
        }. Failed: ${failedTitles.slice(0, 3).join(", ")}${
          failedTitles.length > 3 ? "..." : ""
        }`
      );
    }

    setBatchDraftMessage(
      `Refreshed comps for ${refreshedCount} selected row${
        refreshedCount === 1 ? "" : "s"
      }.`
    );
    setBatchRunning(false);
  }

  async function processSavedLotToKnowledgeBase() {
    const busyReason = batchKnowledgeSaving
      ? "TCOS Card DB processing is already running."
      : batchBusyBlockedReason("processing the saved lot into the TCOS Card DB");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    if (!persistentJob?.id) {
      setBatchError(
        "Run Batch InstaComp™ first so there is a saved lot to process into the TCOS Card DB."
      );
      return;
    }

    const itemIds = batchCards
      .filter((card) => card.status === "done" && card.result && card.persistentItemId)
      .map((card) => card.persistentItemId as string);

    if (!itemIds.length) {
      setBatchError("No completed saved-lot rows are ready for the TCOS Card DB.");
      return;
    }

    setBatchKnowledgeSaving(true);
    setBatchError(null);
    setBatchDraftMessage(
      `Processing ${itemIds.length} confirmed card row${
        itemIds.length === 1 ? "" : "s"
      } into the TCOS Card DB...`
    );

    try {
      const data = await persistentJobJson(
        `/api/instacomp/jobs/${persistentJob.id}/knowledge-base`,
        {
          method: "POST",
          body: { itemIds },
        }
      );
      const processed = Array.isArray(data.processed) ? data.processed : [];
      const byItemId = new Map<string, Record<string, any>>(
        processed.map((item: any) => [
          String(item.itemId),
          item.entry && typeof item.entry === "object" ? item.entry : {},
        ])
      );

      setBatchCards((current) =>
        current.map((card) => {
          if (!card.persistentItemId) return card;

          const entry = byItemId.get(card.persistentItemId);
          if (!entry?.id) return card;

          return {
            ...card,
            knowledgeEntryId: String(entry.id),
            knowledgeSavedAt: new Date().toISOString(),
            knowledgeTrustStatus: entry.trust_status || null,
            knowledgeConfirmedCount:
              entry.confirmed_count === null || entry.confirmed_count === undefined
                ? null
                : Number(entry.confirmed_count),
          };
        })
      );

      setBatchDraftMessage(
        `TCOS Card DB processed ${data.processedCount || 0} row${
          data.processedCount === 1 ? "" : "s"
        }. Trusted ${data.trustedCount || 0}; learning ${
          data.learningCount || 0
        }. A card becomes TCOS trusted on the 3rd confirmed sighting.`
      );

      if (data.skippedCount) {
        setBatchError(
          `${data.skippedCount} row${
            data.skippedCount === 1 ? "" : "s"
          } skipped because scan identity was missing.`
        );
      }
    } catch (error: any) {
      setBatchError(error?.message || "Could not process this lot into the TCOS Card DB.");
      setBatchDraftMessage(null);
    } finally {
      setBatchKnowledgeSaving(false);
    }
  }

  function setAllDoneBatchCardsSelected(selected: boolean) {
    const busyReason = batchBusyBlockedReason(
      selected ? "selecting draftable rows" : "deselecting draftable rows"
    );

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    if (!batchDraftableCount) {
      setBatchError("No draftable rows are available to select.");
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) => {
        if (isDraftableBatchCard(card)) {
          return {
            ...card,
            selected,
          };
        }

        return selected
          ? {
              ...card,
              selected: false,
            }
          : card;
      })
    );
  }

  function selectCleanDraftableBatchCards() {
    if (!cleanDraftableCount) {
      setBatchError("No clean draftable rows are available to select.");
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) => ({
        ...card,
        selected: cleanDraftableBatchCardIds.has(card.id),
      }))
    );
  }

  function selectCleanReadyDraftableBatchCards() {
    if (!cleanReadyCount) {
      setBatchError("No clean ready rows are available to select.");
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) => ({
        ...card,
        selected: cleanReadyBatchCardIds.has(card.id),
      }))
    );
  }

  function selectReadyDraftableBatchCards() {
    if (!readyDraftableCount) {
      setBatchError("No ready draftable rows are available to select.");
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) => ({
        ...card,
        selected: readyDraftableBatchCardIds.has(card.id),
      }))
    );
  }

  function selectOperatorMarkedProblemBatchCards() {
    if (!batchOperatorMarkedWrongCount) {
      setBatchError("No wrong or needs-more-info rows are available to select.");
      return;
    }

    setBatchError(null);
    setBatchFilter("problems");
    setBatchSort("original");
    setBatchDraftMessage(
      `Selected ${batchOperatorMarkedWrongCount} marked problem row${
        batchOperatorMarkedWrongCount === 1 ? "" : "s"
      }. Use Process Marked Problems to rerun them, or Remove Selected Problems to drop bad scans.`
    );
    setBatchCards((current) =>
      current.map((card) => ({
        ...card,
        selected: batchOperatorMarkedWrongCardIds.has(card.id),
      }))
    );
  }

  function deselectReviewBatchCards() {
    if (!selectedReviewCount) {
      setBatchError("No selected review rows are available to deselect.");
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) =>
        reviewBatchCardIds.has(card.id)
          ? {
              ...card,
              selected: false,
            }
          : card
      )
    );
  }

  function deselectReadyReviewBatchCards() {
    if (!selectedReadyReviewCount) {
      setBatchError("No selected ready review rows are available to deselect.");
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) =>
        card.selected &&
        readyDraftableBatchCardIds.has(card.id) &&
        reviewBatchCardIds.has(card.id)
          ? {
              ...card,
              selected: false,
            }
          : card
      )
    );
  }

  function deselectReviewDraftFixBatchCards() {
    if (!selectedReviewDraftFixCount) {
      setBatchError("No selected review fix rows are available to deselect.");
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) =>
        card.selected &&
        reviewBatchCardIds.has(card.id) &&
        draftFixBatchCardIds.has(card.id)
          ? {
              ...card,
              selected: false,
            }
          : card
      )
    );
  }

  function deselectCleanDraftFixBatchCards() {
    if (!selectedCleanDraftFixCount) {
      setBatchError("No selected clean fix rows are available to deselect.");
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) =>
        card.selected &&
        cleanDraftableBatchCardIds.has(card.id) &&
        draftFixBatchCardIds.has(card.id)
          ? {
              ...card,
              selected: false,
            }
          : card
      )
    );
  }

  function deselectDraftFixBatchCards() {
    if (!selectedDraftFixCount) {
      setBatchError("No selected rows needing fixes are available to deselect.");
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) =>
        draftFixBatchCardIds.has(card.id)
          ? {
              ...card,
              selected: false,
            }
          : card
      )
    );
  }

  function setVisibleDraftableBatchCardsSelected(selected: boolean) {
    if (
      showBatchBusyBlocked(
        selected ? "selecting visible draftable rows" : "deselecting visible rows"
      )
    ) {
      return;
    }

    if (!visibleDraftableCount) {
      setBatchError(
        selected
          ? "No visible draftable rows are available to select."
          : "No visible draftable rows are available to deselect."
      );
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) =>
        visibleDraftableBatchCardIds.has(card.id)
          ? {
              ...card,
              selected,
            }
          : card
      )
    );
  }

  function selectVisibleReadyBatchCards() {
    if (showBatchBusyBlocked("selecting visible ready rows")) return;

    if (!visibleReadyCount) {
      setBatchError("No visible ready rows are available to select.");
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) => {
        if (visibleReadyBatchCardIds.has(card.id)) {
          return {
            ...card,
            selected: true,
          };
        }

        if (visibleDraftFixBatchCardIds.has(card.id)) {
          return {
            ...card,
            selected: false,
          };
        }

        return card;
      })
    );
  }

  function selectVisibleCleanBatchCards() {
    if (showBatchBusyBlocked("selecting visible clean rows")) return;

    if (!visibleCleanCount) {
      setBatchError("No visible clean rows are available to select.");
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) => {
        if (visibleCleanBatchCardIds.has(card.id)) {
          return {
            ...card,
            selected: true,
          };
        }

        if (visibleDraftableBatchCardIds.has(card.id)) {
          return {
            ...card,
            selected: false,
          };
        }

        return card;
      })
    );
  }

  function selectVisibleCleanReadyBatchCards() {
    if (showBatchBusyBlocked("selecting visible clean ready rows")) return;

    if (!visibleCleanReadyCount) {
      setBatchError("No visible clean ready rows are available to select.");
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) => {
        if (visibleCleanReadyBatchCardIds.has(card.id)) {
          return {
            ...card,
            selected: true,
          };
        }

        if (visibleDraftableBatchCardIds.has(card.id)) {
          return {
            ...card,
            selected: false,
          };
        }

        return card;
      })
    );
  }

  function deselectVisibleReviewBatchCards() {
    if (showBatchBusyBlocked("deselecting visible review rows")) return;

    if (!visibleReviewCount) {
      setBatchError("No visible review rows are available to deselect.");
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) =>
        visibleReviewBatchCardIds.has(card.id)
          ? {
              ...card,
              selected: false,
            }
          : card
      )
    );
  }

  function deselectVisibleReadyReviewBatchCards() {
    if (showBatchBusyBlocked("deselecting visible ready review rows")) return;

    if (!visibleReadyReviewCount) {
      setBatchError("No visible ready review rows are available to deselect.");
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) =>
        visibleReadyReviewBatchCardIds.has(card.id)
          ? {
              ...card,
              selected: false,
            }
          : card
      )
    );
  }

  function deselectVisibleReviewDraftFixBatchCards() {
    if (showBatchBusyBlocked("deselecting visible review fix rows")) return;

    if (!visibleReviewDraftFixCount) {
      setBatchError("No visible review fix rows are available to deselect.");
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) =>
        visibleReviewDraftFixBatchCardIds.has(card.id)
          ? {
              ...card,
              selected: false,
            }
          : card
      )
    );
  }

  function deselectVisibleCleanDraftFixBatchCards() {
    if (showBatchBusyBlocked("deselecting visible clean fix rows")) return;

    if (!visibleCleanDraftFixCount) {
      setBatchError("No visible clean fix rows are available to deselect.");
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) =>
        visibleCleanDraftFixBatchCardIds.has(card.id)
          ? {
              ...card,
              selected: false,
            }
          : card
      )
    );
  }

  function deselectVisibleDraftFixBatchCards() {
    if (showBatchBusyBlocked("deselecting visible fix rows")) return;

    if (!visibleDraftFixCount) {
      setBatchError("No visible rows needing fixes are available to deselect.");
      return;
    }

    setBatchError(null);
    setBatchCards((current) =>
      current.map((card) =>
        visibleDraftFixBatchCardIds.has(card.id)
          ? {
              ...card,
              selected: false,
            }
          : card
      )
    );
  }

  async function scanOneBatchCard(
    card: BatchCard,
    claimedItem?: PersistentClaimedItem
  ) {
    if (removedBatchCardIdsRef.current.has(card.id)) {
      return card;
    }

    const persistentBinding = persistentBindingsRef.current.get(card.id);
    const abortController = new AbortController();
    const scanStartedAtMs = Date.now();
    const scanStartedAt = new Date(scanStartedAtMs).toISOString();

    batchCardAbortControllersRef.current.set(card.id, abortController);
    updateBatchCard(card.id, (current) => ({
      ...current,
      status: "scanning",
      operatorMarkedWrong: false,
      operatorNeedsMoreInfo: false,
      error: null,
      scanStartedAt,
      scanCompletedAt: null,
      scanElapsedMs: null,
    }));

    try {
      const scanResult = await runInstaCompScan(
        card.file,
        card.backFile,
        claimedItem,
        abortController.signal
      );

      if (
        abortController.signal.aborted ||
        removedBatchCardIdsRef.current.has(card.id)
      ) {
        if (claimedItem) {
          await cancelPersistentItem({
            jobId: claimedItem.job_id,
            itemId: claimedItem.id,
          }).catch((error) => {
            if (error?.status === 404 || error?.status === 409) return null;
            throw error;
          });
        }

        return card;
      }

      const marketPrice = effectiveMarketStats(scanResult).suggestedPrice;
      const nextCard = (current: BatchCard): BatchCard => ({
        ...current,
        status: "done",
        result: scanResult,
        marketPrice,
        customTitle:
          current.customTitle || cardResultTitle(scanResult, current.file.name),
        customSerialNumber: scanResult.ai.serialNumber || "",
        customPrice: marketPrice ? marketPrice.toFixed(2) : current.customPrice,
        error: null,
        scanStartedAt: current.scanStartedAt || scanStartedAt,
        scanCompletedAt: new Date().toISOString(),
        scanElapsedMs: Date.now() - scanStartedAtMs,
        ...(persistentBinding
          ? {
              persistentClientId: persistentBinding.clientItemId,
              persistentJobId: persistentBinding.jobId,
              persistentItemId: persistentBinding.itemId,
              frontStoragePath: persistentBinding.frontStoragePath,
              backStoragePath: persistentBinding.backStoragePath,
            }
          : {}),
      });

      updateBatchCard(card.id, nextCard);
      return nextCard(card);
    } catch (err: any) {
      if (isAbortError(err) || abortController.signal.aborted) {
        return card;
      }

      if (removedBatchCardIdsRef.current.has(card.id)) {
        return card;
      }

      const nextCard = (current: BatchCard): BatchCard => ({
        ...current,
        status: "error",
        error: err?.message || "Scan failed.",
        scanStartedAt: current.scanStartedAt || scanStartedAt,
        scanCompletedAt: new Date().toISOString(),
        scanElapsedMs: Date.now() - scanStartedAtMs,
        ...(persistentBinding
          ? {
              persistentClientId: persistentBinding.clientItemId,
              persistentJobId: persistentBinding.jobId,
              persistentItemId: persistentBinding.itemId,
              frontStoragePath: persistentBinding.frontStoragePath,
              backStoragePath: persistentBinding.backStoragePath,
            }
          : {}),
      });

      updateBatchCard(card.id, nextCard);
      return nextCard(card);
    } finally {
      if (batchCardAbortControllersRef.current.get(card.id) === abortController) {
        batchCardAbortControllersRef.current.delete(card.id);
      }
    }
  }

  async function scanPersistentJob(jobId: string, cards: BatchCard[]) {
    const cardsByClientId = new Map(
      cards.map((card) => [
        persistentBindingsRef.current.get(card.id)?.clientItemId ||
          card.persistentClientId,
        card,
      ])
    );
    const completedCards: BatchCard[] = [];
    const workerCount = Math.min(batchConcurrency, Math.max(1, cards.length));

    async function runPersistentWorker(workerIndex: number) {
      const workerId = `browser-${crypto.randomUUID()}-${workerIndex}`;
      let emptyClaimCount = 0;

      while (!batchPauseRequestedRef.current) {
        let claimed: any;

        try {
          claimed = await persistentJobJson(`/api/instacomp/jobs/${jobId}/claim`, {
            method: "POST",
            body: {
              workerId,
              limit: INSTACOMP_JOB_CLAIM_CHUNK_SIZE,
              leaseSeconds: 900,
            },
          });
        } catch (error) {
          if (handleBatchOpenAIRateLimitError(error)) {
            return;
          }

          if (handleBatchDatabasePressureError(error)) {
            return;
          }

          throw error;
        }

        if (claimed.job) {
          setPersistentJob(claimed.job as PersistentJobSummary);
        }

        const claimedItems = Array.isArray(claimed.items)
          ? (claimed.items as PersistentClaimedItem[])
          : [];

        if (!claimedItems.length) {
          const jobStatus = String(claimed.job?.status || "");
          const totalItems = Number(claimed.job?.total_items || 0);
          const processedItems = Number(claimed.job?.processed_items || 0);
          const terminal = [
            "completed",
            "completed_with_errors",
            "failed",
            "cancelled",
          ].includes(jobStatus);

          if (terminal || (totalItems > 0 && processedItems >= totalItems)) {
            return;
          }

          if (["uploading", "cancelling"].includes(jobStatus)) {
            throw new Error(
              `InstaComp™ job is ${jobStatus}; finish recovery or cancellation before scanning.`
            );
          }

          emptyClaimCount += 1;

          if (emptyClaimCount >= 120) {
            throw new Error(
              "InstaComp™ queue made no progress for several minutes. The job is still saved; use Resume to try again."
            );
          }
          await new Promise((resolve) =>
            window.setTimeout(
              resolve,
              Math.min(3000, 500 + emptyClaimCount * 250)
            )
          );
          continue;
        }

        emptyClaimCount = 0;

        for (const item of claimedItems) {
          if (claimedPersistentItemWasRemoved(item)) {
            await cancelPersistentItem({
              jobId,
              itemId: item.id,
            }).catch((error) => {
              if (error?.status === 404 || error?.status === 409) return null;
              throw error;
            });
            continue;
          }

          const card = cardsByClientId.get(item.client_item_id);

          if (!card) {
            await persistentJobJson(
              `/api/instacomp/jobs/${jobId}/items/${item.id}/fail`,
              {
                method: "POST",
                body: {
                  leaseToken: item.leaseToken || item.lease_token,
                  errorCode: "browser_row_missing",
                  errorMessage:
                    "The browser could not match the claimed card to its uploaded row.",
                  retryable: true,
                  retryDelaySeconds: 5,
                },
              }
            );
            continue;
          }

          if (removedBatchCardIdsRef.current.has(card.id)) {
            await cancelPersistentItem({
              jobId,
              itemId: item.id,
            }).catch((error) => {
              if (error?.status === 404 || error?.status === 409) return null;
              throw error;
            });
            continue;
          }

          const scannedCard = await scanOneBatchCard(card, item);
          completedCards.push(scannedCard);
          handleBatchOpenAIRateLimit(scannedCard);
          handleBatchDatabasePressure(scannedCard);
        }
      }
    }

    await Promise.all(
      Array.from({ length: workerCount }, (_, index) =>
        runPersistentWorker(index)
      )
    );

    return completedCards;
  }

  async function retryBatchCard(cardId: string) {
    const busyReason = batchBusyBlockedReason("retrying this row");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    const card = batchCards.find((row) => row.id === cardId);

    if (!card) return;

    if (card.status !== "error" && card.status !== "done") {
      setBatchError("Retry becomes available after the row finishes scanning or errors.");
      return;
    }

    setBatchError(null);
    setBatchDraftMessage(null);
    const binding = persistentBindingsRef.current.get(card.id);

    if (!binding) {
      await scanOneBatchCard(card);
      return;
    }

    try {
      await persistentJobJson(
        `/api/instacomp/jobs/${binding.jobId}/items/${binding.itemId}/retry`,
        {
          method: "POST",
          body: { reason: "Seller requested a retry from InstaComp™." },
        }
      );
    } catch (error: any) {
      if (error?.status !== 409) {
        setBatchError(error?.message || "Could not requeue this card.");
        return;
      }
    }

    updateBatchCard(card.id, (current) => ({
      ...current,
      status: "queued",
      operatorMarkedWrong: false,
      operatorNeedsMoreInfo: false,
      error: null,
      result: null,
      marketPrice: null,
      customPrice: "",
      scanQueuedAt: new Date().toISOString(),
      scanStartedAt: null,
      scanCompletedAt: null,
      scanElapsedMs: null,
    }));

    batchPauseRequestedRef.current = false;
    openAIRateLimitPauseRef.current = false;
    setBatchRunning(true);

    try {
      await scanPersistentJob(binding.jobId, batchCards);
    } catch (error: any) {
      if (
        !handleBatchOpenAIRateLimitError(error) &&
        !handleBatchDatabasePressureError(error)
      ) {
        setBatchError(error?.message || "Could not retry this queued card.");
      }
    } finally {
      setBatchRunning(false);
    }
  }

  async function requeuePersistentCards(cards: BatchCard[]) {
    let cursor = 0;

    async function runRequeueWorker() {
      while (cursor < cards.length) {
        const card = cards[cursor];
        cursor += 1;
        const binding = persistentBindingsRef.current.get(card.id);

        if (!binding) continue;

        try {
          await persistentJobJson(
            `/api/instacomp/jobs/${binding.jobId}/items/${binding.itemId}/retry`,
            {
              method: "POST",
              body: { reason: "Seller requested a batch retry from InstaComp™." },
            }
          );
        } catch (error: any) {
          // retry_wait rows are already scheduled and will be claimed after
          // their short backoff. Other conflicts need operator attention.
          if (error?.status !== 409) throw error;
        }

        updateBatchCard(card.id, (current) => ({
          ...current,
          status: "queued",
          operatorMarkedWrong: false,
          operatorNeedsMoreInfo: false,
          error: null,
          scanQueuedAt: new Date().toISOString(),
          scanStartedAt: null,
          scanCompletedAt: null,
          scanElapsedMs: null,
        }));
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(INSTACOMP_JOB_UPLOAD_CONCURRENCY, cards.length) },
        () => runRequeueWorker()
      )
    );
  }

  async function scanBatch(
    options: {
      retryOnly?: boolean;
      wrongOnly?: boolean;
      onlyCardIds?: Set<string>;
    } = {}
  ) {
    if (persistentJobPreparing) {
      setBatchError("Finish preparing the saved InstaComp™ lot before scanning.");
      return;
    }

    if (batchDrafting) {
      setBatchError("Finish draft creation before scanning the batch.");
      return;
    }

    if (batchRunning) {
      setBatchError("Finish the current InstaComp™ scan/action before scanning again.");
      return;
    }

    if (!batchCards.length) {
      setBatchError("Add up to 500 card images first.");
      return;
    }

    const cardsToScan = batchCards
      .filter((card) => {
        if (options.wrongOnly) {
          return (
            card.status === "done" &&
            Boolean(card.operatorMarkedWrong || card.operatorNeedsMoreInfo)
          );
        }

        return options.retryOnly
          ? card.status === "error"
          : card.status !== "done";
      })
      .filter((card) => !options.onlyCardIds || options.onlyCardIds.has(card.id));

    if (!cardsToScan.length) {
      let emptyMessage = "No cards are waiting to scan.";

      if (options.retryOnly) {
        emptyMessage = "No failed cards are waiting for retry.";
      }

      if (options.wrongOnly) {
        emptyMessage = "No wrong or needs-more-info cards are waiting to process.";
      }

      if (options.onlyCardIds) {
        emptyMessage = options.wrongOnly
          ? "No selected wrong or needs-more-info cards are waiting to process."
          : "No visible failed cards are waiting for retry.";
      }

      setBatchError(emptyMessage);
      return;
    }

    let persistentJobId: string | null = persistentJob?.id || null;
    const persistentBindingsComplete = batchCards.every((card) =>
      persistentBindingsRef.current.has(card.id)
    );

    if (
      !options.retryOnly &&
      !options.onlyCardIds &&
      (!persistentJobId ||
        persistentJob?.status === "uploading" ||
        !persistentBindingsComplete)
    ) {
      try {
        persistentJobId = await ensurePersistentJob(batchCards, false);
      } catch (error: any) {
        const durableQueueUnavailable =
          error?.status === 503 ||
          [
            "INSTACOMP_JOB_MIGRATION_REQUIRED",
            "INSTACOMP_JOB_STORAGE_REQUIRED",
          ].includes(String(error?.code || ""));

        if (durableQueueUnavailable) {
          setBatchDraftMessage(
            "Durable queue setup is not applied yet. Running the bounded per-card fallback without the old oversized requests."
          );
        } else {
          setBatchError(error?.message || "Could not prepare the persistent scan job.");
          return;
        }
      }
    }

    batchPauseRequestedRef.current = false;
    databasePressurePauseRef.current = false;
    openAIRateLimitPauseRef.current = false;
    setBatchRunning(true);
    setBatchPauseRequested(false);
    setBatchError(null);

    let cursor = 0;
    let completedThisRun = 0;
    const workerCount = Math.min(batchConcurrency, cardsToScan.length);

    async function runWorker() {
      while (
        cursor < cardsToScan.length &&
        !batchPauseRequestedRef.current
      ) {
        const card = cardsToScan[cursor];
        cursor += 1;

        if (removedBatchCardIdsRef.current.has(card.id)) {
          continue;
        }

        const scannedCard = await scanOneBatchCard(card);
        handleBatchOpenAIRateLimit(scannedCard);
        handleBatchDatabasePressure(scannedCard);
        completedThisRun += 1;
      }
    }

    try {
      if (persistentJobId) {
        if (options.retryOnly || options.wrongOnly) {
          await requeuePersistentCards(cardsToScan);
        }

        const persistentResults = await scanPersistentJob(
          persistentJobId,
          batchCards
        );
        completedThisRun = persistentResults.length;
      } else {
        await Promise.all(
          Array.from({ length: workerCount }, () => runWorker())
        );
      }

      if (batchPauseRequestedRef.current) {
        const remaining = cardsToScan.length - completedThisRun;

        setBatchError(
          `Paused after current scans. ${remaining} card${
            remaining === 1 ? "" : "s"
          } still need scanning.`
        );
      }
    } catch (error: any) {
      if (
        !handleBatchOpenAIRateLimitError(error) &&
        !handleBatchDatabasePressureError(error)
      ) {
        setBatchError(error?.message || "The persistent scan job stopped.");
      }
    } finally {
      setBatchRunning(false);
    }
  }

  async function autoScanAndDraftBatch() {
    if (!batchCards.length) {
      setBatchError("Add up to 500 card images first.");
      return;
    }

    if (batchRunning || batchDrafting || persistentJobPreparing) return;

    batchPauseRequestedRef.current = false;
    databasePressurePauseRef.current = false;
    openAIRateLimitPauseRef.current = false;
    setBatchRunning(true);
    setBatchPauseRequested(false);
    setBatchError(null);
    setBatchDraftMessage(
      "InstaComp™ Auto-Pilot is scanning the lot, reading OCR text, finding comps, and preparing ready draft listings."
    );

    let persistentJobId: string | null = persistentJob?.id || null;
    const persistentBindingsComplete = batchCards.every((card) =>
      persistentBindingsRef.current.has(card.id)
    );

    if (
      !persistentJobId ||
      persistentJob?.status === "uploading" ||
      !persistentBindingsComplete
    ) {
      try {
        persistentJobId = await ensurePersistentJob(batchCards, true);
      } catch (error: any) {
        const durableQueueUnavailable =
          error?.status === 503 ||
          [
            "INSTACOMP_JOB_MIGRATION_REQUIRED",
            "INSTACOMP_JOB_STORAGE_REQUIRED",
          ].includes(String(error?.code || ""));

        if (durableQueueUnavailable) {
          setBatchDraftMessage(
            "Durable queue setup is not applied yet. Auto-Pilot is using the bounded per-card fallback."
          );
        } else {
          setBatchRunning(false);
          setBatchError(
            error?.message || "Could not prepare the persistent scan job."
          );
          return;
        }
      }
    }

    const alreadyDoneCards = batchCards.filter(
      (card) => card.status === "done" && card.result
    );
    const cardsToScan = batchCards.filter((card) => card.status !== "done");
    const completedCards: BatchCard[] = [];
    let cursor = 0;
    const workerCount = Math.min(batchConcurrency, cardsToScan.length);
    let scanProcessingFailed = false;

    async function runWorker() {
      while (
        cursor < cardsToScan.length &&
        !batchPauseRequestedRef.current
      ) {
        const card = cardsToScan[cursor];
        cursor += 1;

        if (removedBatchCardIdsRef.current.has(card.id)) {
          continue;
        }

        const scannedCard = await scanOneBatchCard(card);
        completedCards.push(scannedCard);
        handleBatchOpenAIRateLimit(scannedCard);
        handleBatchDatabasePressure(scannedCard);
      }
    }

    try {
      if (cardsToScan.length) {
        if (persistentJobId) {
          completedCards.push(
            ...(await scanPersistentJob(persistentJobId, batchCards))
          );
        } else {
          await Promise.all(
            Array.from({ length: workerCount }, () => runWorker())
          );
        }
      }
    } catch (error: any) {
      scanProcessingFailed = true;
      if (
        !handleBatchOpenAIRateLimitError(error) &&
        !handleBatchDatabasePressureError(error)
      ) {
        setBatchError(error?.message || "Auto-Pilot scan processing stopped.");
      }
    } finally {
      setBatchRunning(false);
    }

    if (scanProcessingFailed) return;

    if (batchPauseRequestedRef.current) {
      setBatchError("Auto-Pilot paused after current scans. Draft creation did not run.");
      return;
    }

    const readyCards = [...alreadyDoneCards, ...completedCards]
      .filter(isDraftableBatchCard)
      .filter(
        (card) =>
          !card.result?.queue || card.result.queue.status === "completed"
      )
      .filter((card) => draftReadinessErrors(card).length === 0);

    if (!readyCards.length) {
      setBatchDraftMessage(
        "Auto-Pilot finished scanning. No rows were safe to draft yet; review rows marked Fix or Review."
      );
      return;
    }

    await createDraftListingsForCards(readyCards, {
      emptyMessage: "No ready rows were safe to draft after Auto-Pilot scanning.",
      blockedScopeLabel: "auto-pilot ready",
    });
  }

  async function retryVisibleFailedBatchCards() {
    const busyReason = batchBusyBlockedReason("retrying visible failed rows");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    if (!visibleFailedCount) {
      setBatchError("No visible failed cards are waiting for retry.");
      return;
    }

    await scanBatch({
      retryOnly: true,
      onlyCardIds: visibleFailedBatchCardIds,
    });
  }

  async function retryRateLimitedBatchCards() {
    if (!batchRateLimitErrorCount) {
      setBatchError("No OpenAI rate-limited rows are waiting for retry.");
      return;
    }

    await scanBatch({
      retryOnly: true,
      onlyCardIds: batchRateLimitErrorBatchCardIds,
    });
  }

  async function retryOperatorMarkedWrongBatchCards() {
    if (!batchOperatorMarkedWrongCount) {
      setBatchError("No wrong or needs-more-info rows are waiting to process.");
      return;
    }

    setBatchFilter("problems");
    setBatchSort("original");
    await scanBatch({
      wrongOnly: true,
      onlyCardIds: batchOperatorMarkedWrongCardIds,
    });
  }

  function exportVisibleBatchReport({
    ids,
    count,
    reportScope,
    emptyMessage,
    label,
  }: {
    ids: Set<string>;
    count: number;
    reportScope: string;
    emptyMessage: string;
    label: string;
  }) {
    const busyReason = batchBusyBlockedReason(`exporting ${label} report rows`);

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    if (!count) {
      setBatchError(emptyMessage);
      return;
    }

    const reportItems = visibleBatchCards.filter(({ card }) => ids.has(card.id));

    exportBatchReportCsv(reportItems, reportScope);
    setBatchError(null);
    setBatchDraftMessage(
      `Exported ${reportItems.length} ${label} report row${
        reportItems.length === 1 ? "" : "s"
      }.`
    );
  }

  function exportVisibleFixReport() {
    exportVisibleBatchReport({
      ids: visibleDraftFixBatchCardIds,
      count: visibleDraftFixCount,
      reportScope: "visible-fix-report",
      emptyMessage: "No visible fix rows are available to export.",
      label: "visible fix",
    });
  }

  function exportVisibleReviewReport() {
    exportVisibleBatchReport({
      ids: visibleReviewBatchCardIds,
      count: visibleReviewCount,
      reportScope: "visible-review-report",
      emptyMessage: "No visible review rows are available to export.",
      label: "visible review",
    });
  }

  function exportVisibleFailedReport() {
    exportVisibleBatchReport({
      ids: visibleFailedBatchCardIds,
      count: visibleFailedCount,
      reportScope: "visible-failed-report",
      emptyMessage: "No visible failed rows are available to export.",
      label: "visible failed",
    });
  }

  function exportVisibleBatchCsv() {
    if (!visibleBatchCards.length) {
      setBatchError("No visible InstaComp™ rows are available to export as CSV.");
      return;
    }

    exportBatchCsv(
      visibleBatchCards,
      visibleBatchCards.length === batchCards.length ? "all" : "view"
    );
    setBatchError(null);
    setBatchDraftMessage(
      `Exported ${visibleBatchCards.length} visible row${
        visibleBatchCards.length === 1 ? "" : "s"
      } as CSV.`
    );
  }

  function exportVisibleBatchJson() {
    if (!visibleBatchCards.length) {
      setBatchError("No visible InstaComp™ rows are available to export as JSON.");
      return;
    }

    exportBatchJson(
      visibleBatchCards,
      visibleBatchCards.length === batchCards.length ? "all" : "view"
    );
    setBatchError(null);
    setBatchDraftMessage(
      `Exported ${visibleBatchCards.length} visible row${
        visibleBatchCards.length === 1 ? "" : "s"
      } as JSON.`
    );
  }

  function exportVisibleTrialResults() {
    const busyReason = batchBusyBlockedReason("exporting visible trial results");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    const payload = instacompTrialResultsPayload(visibleBatchCards);

    if (!payload.cards.length) {
      setBatchError("No completed visible scan rows are available for the trial results export.");
      return;
    }

    downloadTextFile(
      `instacomp-trial-results-${exportTimestamp()}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8"
    );
    setBatchError(null);
    setBatchDraftMessage(
      `Exported ${payload.cards.length} trial result row${
        payload.cards.length === 1 ? "" : "s"
      } for the 94% scorekeeper.`
    );
  }

  async function copyVisibleTrialResults() {
    const busyReason = batchBusyBlockedReason("copying visible trial results");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    const payload = instacompTrialResultsPayload(visibleBatchCards);

    if (!payload.cards.length) {
      setBatchError("No completed visible scan rows are available to copy as trial results.");
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setBatchError(null);
      setBatchDraftMessage(
        `Copied ${payload.cards.length} trial result row${
          payload.cards.length === 1 ? "" : "s"
        } for the 94% scorekeeper.`
      );
    } catch {
      setBatchError("Could not copy the trial results JSON.");
    }
  }

  function exportSelectedDraftPayload() {
    const busyReason = batchBusyBlockedReason("exporting selected draft payload");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    if (!selectedDraftReadyCount) {
      setBatchError("Select at least one ready draft row to export.");
      return;
    }

    const payload = selectedReadyDraftPayload();

    downloadTextFile(
      `instacomp-selected-ready-draft-payload-${exportTimestamp()}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8"
    );
    setBatchError(null);
    setBatchDraftMessage(
      `Exported ${selectedReadyDraftCards.length} ready draft payload item${
        selectedReadyDraftCards.length === 1 ? "" : "s"
      }.`
    );
  }

  function selectedReadyDraftPayload() {
    return {
      exportedAt: new Date().toISOString(),
      scope: "selected_ready",
      selectedCount: selectedDoneBatchCards.length,
      readyCount: selectedDraftReadyCount,
      cleanCount: selectedCleanCount,
      cleanReadyCount: selectedCleanReadyCount,
      cleanFixCount: selectedCleanDraftFixCount,
      fixCount: selectedDraftFixCount,
      reviewCount: selectedReviewCount,
      readyReviewCount: selectedReadyReviewCount,
      reviewFixCount: selectedReviewDraftFixCount,
      itemCount: selectedReadyDraftCards.length,
      items: draftListingItemsForCards(selectedReadyDraftCards),
    };
  }

  async function copySelectedDraftPayload() {
    if (!testMode) return;

    const busyReason = batchBusyBlockedReason("copying selected draft payload");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    if (!selectedDraftReadyCount) {
      setBatchError("Select at least one ready draft row to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(
        JSON.stringify(selectedReadyDraftPayload(), null, 2)
      );
      setBatchError(null);
      setBatchDraftMessage(
        `Copied ${selectedReadyDraftCards.length} selected ready draft payload item${
          selectedReadyDraftCards.length === 1 ? "" : "s"
        }.`
      );
    } catch {
      setBatchError("Could not copy the selected draft payload.");
    }
  }

  function exportSelectedCleanDraftPayload() {
    const busyReason = batchBusyBlockedReason("exporting selected clean draft payload");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    if (!selectedCleanReadyCount) {
      setBatchError("Select at least one clean ready draft row to export.");
      return;
    }

    const payload = selectedCleanDraftPayload();

    downloadTextFile(
      `instacomp-selected-clean-draft-payload-${exportTimestamp()}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8"
    );
    setBatchError(null);
    setBatchDraftMessage(
      `Exported ${selectedCleanReadyDraftCards.length} selected clean draft payload item${
        selectedCleanReadyDraftCards.length === 1 ? "" : "s"
      }.`
    );
  }

  function selectedCleanDraftPayload() {
    return {
      exportedAt: new Date().toISOString(),
      scope: "selected_clean",
      selectedCount: selectedDoneBatchCards.length,
      selectedReadyCount: selectedDraftReadyCount,
      selectedCleanCount,
      selectedCleanReadyCount,
      selectedCleanFixCount: selectedCleanDraftFixCount,
      selectedFixCount: selectedDraftFixCount,
      selectedReviewCount,
      selectedReadyReviewCount,
      selectedReviewFixCount: selectedReviewDraftFixCount,
      itemCount: selectedCleanReadyDraftCards.length,
      items: draftListingItemsForCards(selectedCleanReadyDraftCards),
    };
  }

  async function copySelectedCleanDraftPayload() {
    if (!testMode) return;

    const busyReason = batchBusyBlockedReason("copying selected clean draft payload");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    if (!selectedCleanReadyCount) {
      setBatchError("Select at least one clean ready draft row to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(
        JSON.stringify(selectedCleanDraftPayload(), null, 2)
      );
      setBatchError(null);
      setBatchDraftMessage(
        `Copied ${selectedCleanReadyDraftCards.length} selected clean draft payload item${
          selectedCleanReadyDraftCards.length === 1 ? "" : "s"
        }.`
      );
    } catch {
      setBatchError("Could not copy the selected clean draft payload.");
    }
  }

  function exportVisibleDraftPayload() {
    const busyReason = batchBusyBlockedReason("exporting visible draft payload");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    if (!visibleReadyCount) {
      setBatchError("No visible ready draft rows are available to export.");
      return;
    }

    const payload = visibleReadyDraftPayload();

    downloadTextFile(
      `instacomp-visible-draft-payload-${exportTimestamp()}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8"
    );
    setBatchError(null);
    setBatchDraftMessage(
      `Exported ${visibleReadyDraftCards.length} visible ready draft payload item${
        visibleReadyDraftCards.length === 1 ? "" : "s"
      }.`
    );
  }

  function visibleReadyDraftPayload() {
    return {
      exportedAt: new Date().toISOString(),
      scope: "visible",
      visibleRows: visibleBatchCards.length,
      visibleDraftableCount,
      visibleReadyCount,
      visibleCleanCount,
      visibleCleanReadyCount,
      visibleCleanFixCount: visibleCleanDraftFixCount,
      visibleFixCount: visibleDraftFixCount,
      visibleReviewCount,
      visibleReadyReviewCount,
      visibleReviewFixCount: visibleReviewDraftFixCount,
      itemCount: visibleReadyDraftCards.length,
      items: draftListingItemsForCards(visibleReadyDraftCards),
    };
  }

  async function copyVisibleDraftPayload() {
    if (!testMode) return;

    const busyReason = batchBusyBlockedReason("copying visible draft payload");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    if (!visibleReadyCount) {
      setBatchError("No visible ready draft rows are available to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(
        JSON.stringify(visibleReadyDraftPayload(), null, 2)
      );
      setBatchError(null);
      setBatchDraftMessage(
        `Copied ${visibleReadyDraftCards.length} visible ready draft payload item${
          visibleReadyDraftCards.length === 1 ? "" : "s"
        }.`
      );
    } catch {
      setBatchError("Could not copy the visible draft payload.");
    }
  }

  function exportVisibleCleanDraftPayload() {
    const busyReason = batchBusyBlockedReason("exporting visible clean draft payload");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    if (!visibleCleanReadyCount) {
      setBatchError("No visible clean ready draft rows are available to export.");
      return;
    }

    const payload = visibleCleanDraftPayload();

    downloadTextFile(
      `instacomp-visible-clean-draft-payload-${exportTimestamp()}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8"
    );
    setBatchError(null);
    setBatchDraftMessage(
      `Exported ${visibleCleanReadyDraftCards.length} visible clean draft payload item${
        visibleCleanReadyDraftCards.length === 1 ? "" : "s"
      }.`
    );
  }

  function visibleCleanDraftPayload() {
    return {
      exportedAt: new Date().toISOString(),
      scope: "visible_clean",
      visibleRows: visibleBatchCards.length,
      visibleDraftableCount,
      visibleReadyCount,
      visibleCleanCount,
      visibleCleanReadyCount,
      visibleCleanFixCount: visibleCleanDraftFixCount,
      visibleFixCount: visibleDraftFixCount,
      visibleReviewCount,
      visibleReadyReviewCount,
      visibleReviewFixCount: visibleReviewDraftFixCount,
      itemCount: visibleCleanReadyDraftCards.length,
      items: draftListingItemsForCards(visibleCleanReadyDraftCards),
    };
  }

  async function copyVisibleCleanDraftPayload() {
    if (!testMode) return;

    const busyReason = batchBusyBlockedReason("copying visible clean draft payload");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    if (!visibleCleanReadyCount) {
      setBatchError("No visible clean ready draft rows are available to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(
        JSON.stringify(visibleCleanDraftPayload(), null, 2)
      );
      setBatchError(null);
      setBatchDraftMessage(
        `Copied ${visibleCleanReadyDraftCards.length} visible clean draft payload item${
          visibleCleanReadyDraftCards.length === 1 ? "" : "s"
        }.`
      );
    } catch {
      setBatchError("Could not copy the visible clean draft payload.");
    }
  }

  async function createDraftListingsForCards(
    targetCards: BatchCard[],
    options: {
      emptyMessage: string;
      blockedScopeLabel: string;
    }
  ) {
    const busyReason = batchBusyBlockedReason(
      `creating ${options.blockedScopeLabel} draft listings`
    );

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    if (!targetCards.length) {
      setBatchError(options.emptyMessage);
      return;
    }

    setBatchDraftMessage(null);

    const blockedDraftCards = targetCards
      .map((card) => ({
        card,
        errors: draftReadinessErrors(card),
      }))
      .filter(({ errors }) => errors.length > 0);

    if (blockedDraftCards.length) {
      const blockedErrors = new Map(
        blockedDraftCards.map(({ card, errors }) => [card.id, errors.join("; ")])
      );

      setBatchCards((current) =>
        current.map((card) =>
          blockedErrors.has(card.id)
            ? {
                ...card,
                draftStatus: "error",
                draftError: blockedErrors.get(card.id) || "Row is not ready.",
              }
            : card
        )
      );
      setBatchError(
        `Fix ${blockedDraftCards.length} ${options.blockedScopeLabel} row${
          blockedDraftCards.length === 1 ? "" : "s"
        } before creating drafts.`
      );
      return;
    }

    if (testMode) {
      const targetIds = new Set(targetCards.map((card) => card.id));
      const testDraftErrors = new Map(
        targetCards
          .map((card) => [card.id, testDraftCreateErrorForCard(card)] as const)
          .filter(([, error]) => Boolean(error))
      );
      const createdCount = targetCards.length - testDraftErrors.size;
      const draftedCards = applyTestDraftResults(batchCards, targetCards);

      setBatchDrafting(true);
      setBatchError(null);
      setBatchDraftMessage(null);
      setBatchCards((current) =>
        current.map((card) =>
          targetIds.has(card.id)
            ? {
                ...card,
                draftStatus: "drafting",
                draftError: null,
                draftDuplicateAlert: null,
              }
            : card
        )
      );

      await waitForTestModel();

      setBatchCards(draftedCards);
      setBatchDraftMessage(
        `Test draft simulation created ${createdCount} draft${
          createdCount === 1 ? "" : "s"
        }${
          testDraftErrors.size
            ? `; ${testDraftErrors.size} simulated error${
                testDraftErrors.size === 1 ? "" : "s"
              }`
            : ""
        }.`
      );
      setBatchDrafting(false);
      return;
    }

    setBatchDrafting(true);
    setBatchError(null);
    setBatchDraftMessage(null);

    const targetIds = new Set(targetCards.map((card) => card.id));

    setBatchCards((current) =>
      current.map((card) =>
        targetIds.has(card.id)
          ? {
              ...card,
              draftStatus: "drafting",
              draftError: null,
              draftDuplicateAlert: null,
            }
          : card
      )
    );

    try {
      const createdItems: DraftListingResponse["createdItems"] = [];
      const draftErrors: DraftListingResponse["errors"] = [];
      let createdCount = 0;
      let existingCount = 0;
      let cursor = 0;
      let finishedCount = 0;

      async function createOneDraft(card: BatchCard) {
        try {
          const draftItems = draftListingItemsForCards([card]);
          let response: Response;

          if (card.persistentJobId && card.persistentItemId) {
            response = await fetchWithFreshAccountSession(
              "/api/instacomp/draft-listings",
              {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ items: draftItems }),
              },
            );
          } else {
            const [frontFile, backFile] = await Promise.all([
              optimizeScanImage(card.file),
              card.backFile
                ? optimizeScanImage(card.backFile)
                : Promise.resolve(null),
            ]);
            const formData = new FormData();

            formData.append("items", JSON.stringify(draftItems));
            formData.append("frontImage-0", frontFile);

            if (backFile) {
              formData.append("backImage-0", backFile);
            }

            response = await fetchWithFreshAccountSession(
              "/api/instacomp/draft-listings",
              {
                method: "POST",
                body: formData,
              },
            );
          }
          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(data?.error || "Could not create draft listing.");
          }

          const itemResult = data as DraftListingResponse;
          createdItems.push(...itemResult.createdItems);
          draftErrors.push(...itemResult.errors);
          createdCount += itemResult.createdCount;
          existingCount += itemResult.existingCount || 0;
        } catch (error: any) {
          draftErrors.push({
            clientId: card.persistentClientId || card.id,
            scanId: card.result?.scanId || null,
            title: card.customTitle || card.file.name,
            error: error?.message || "Draft was not created.",
          });
        } finally {
          finishedCount += 1;
          setBatchDraftMessage(
            `Creating drafts ${finishedCount}/${targetCards.length}...`
          );
        }
      }

      async function runDraftWorker() {
        while (cursor < targetCards.length) {
          const card = targetCards[cursor];
          cursor += 1;
          await createOneDraft(card);
        }
      }

      await Promise.all(
        Array.from(
          {
            length: Math.min(DRAFT_UPLOAD_CONCURRENCY, targetCards.length),
          },
          () => runDraftWorker()
        )
      );

      const result: DraftListingResponse = {
        success: draftErrors.length === 0,
        createdCount,
        existingCount,
        errorCount: draftErrors.length,
        createdItems,
        errors: draftErrors,
      };
      const createdByClientId = new Map(
        result.createdItems.map((item) => [item.clientId, item])
      );
      const errorsByClientId = new Map(
        result.errors.map((item) => [item.clientId, item])
      );

      setBatchCards((current) =>
        current.map((card) => {
          if (!targetIds.has(card.id)) return card;

          const responseClientId = card.persistentClientId || card.id;
          const created = createdByClientId.get(responseClientId);
          const failed = errorsByClientId.get(responseClientId);

          if (created) {
            return {
              ...card,
              selected: false,
              draftStatus: "created",
              draftError: created.metadataWarning || null,
              draftInventoryItemId: created.inventoryItemId,
              draftLegacyProductId: created.legacyProductId,
              draftSku: created.sku,
              draftDuplicateAlert: created.duplicateAlert || null,
            };
          }

          return {
            ...card,
            draftStatus: "error",
            draftError: failed?.error || "Draft was not created.",
            draftDuplicateAlert: null,
          };
        })
      );

      setBatchDraftMessage(
        `Created ${result.createdCount} draft listings${
          result.existingCount ? `; reused ${result.existingCount} existing` : ""
        }${
          result.errorCount ? `; ${result.errorCount} need review` : ""
        }.`
      );
    } catch (err: any) {
      setBatchError(err?.message || "Could not create draft listings.");
      setBatchCards((current) =>
        current.map((card) =>
          targetIds.has(card.id)
            ? {
                ...card,
                draftStatus: "error",
                draftError: err?.message || "Draft was not created.",
              }
            : card
        )
      );
    } finally {
      setBatchDrafting(false);
    }
  }

  async function createDraftListings() {
    const busyReason = batchBusyBlockedReason("creating draft listings");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    await createDraftListingsForCards(selectedDoneBatchCards, {
      emptyMessage: "Select at least one completed scan that is not already drafted.",
      blockedScopeLabel: "selected",
    });
  }

  async function createSelectedReadyDraftListings() {
    await createDraftListingsForCards(selectedReadyDraftCards, {
      emptyMessage: "Select at least one ready draft row to create.",
      blockedScopeLabel: "selected ready",
    });
  }

  async function createSelectedCleanDraftListings() {
    await createDraftListingsForCards(selectedCleanReadyDraftCards, {
      emptyMessage: "Select at least one clean ready draft row to create.",
      blockedScopeLabel: "selected clean",
    });
  }

  async function createVisibleReadyDraftListings() {
    await createDraftListingsForCards(visibleReadyDraftCards, {
      emptyMessage: "No visible ready draft rows are available to create.",
      blockedScopeLabel: "visible ready",
    });
  }

  async function createVisibleCleanDraftListings() {
    await createDraftListingsForCards(visibleCleanReadyDraftCards, {
      emptyMessage: "No visible clean ready draft rows are available to create.",
      blockedScopeLabel: "visible clean",
    });
  }

  async function addBatchCardToTrade(cardId: string) {
    const busyReason = batchBusyBlockedReason("adding this row to trade");

    if (busyReason) {
      setBatchError(busyReason);
      return;
    }

    const card = batchCards.find((row) => row.id === cardId);

    if (!card || card.status !== "done" || !card.result) {
      setBatchError("Finish the scan before adding this card to trade.");
      return;
    }

    if (card.draftStatus === "created") {
      setBatchError("This card already has a sell draft, so it cannot also be trade inventory.");
      return;
    }

    if (card.tradeStatus === "created") {
      setBatchError("This card is already Available for Trade.");
      return;
    }

    if (card.tradeStatus === "adding") {
      setBatchError("This card is already being added to Available for Trade.");
      return;
    }

    setBatchError(null);
    setBatchDraftMessage(null);
    updateBatchCard(card.id, (current) => ({
      ...current,
      tradeStatus: "adding",
      tradeError: null,
    }));

    if (testMode) {
      await waitForTestModel();
      updateBatchCard(card.id, (current) => ({
        ...current,
        selected: false,
        tradeStatus: "created",
        tradeError: null,
        tradeCollectionItemId: `test-trade-${card.id.slice(0, 24)}`,
      }));
      setBatchDraftMessage("Test trade simulation marked this card Available for Trade.");
      return;
    }

    try {
      const response = await fetchWithFreshAccountSession(
        "/api/instacomp/trade-items",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tradeItemForCard(card)),
        },
      );
      const data = (await response.json().catch(() => ({}))) as TradeItemResponse;

      if (!response.ok) {
        throw new Error(data?.error || "Could not add this card to trade.");
      }

      updateBatchCard(card.id, (current) => ({
        ...current,
        selected: false,
        tradeStatus: "created",
        tradeError: data.alreadyExisted ? "Already existed in trade inventory." : null,
        tradeCollectionItemId: data.collectionItemId,
      }));
      setBatchDraftMessage(
        data.alreadyExisted
          ? "This card was already Available for Trade."
          : "Added card to Available for Trade."
      );
    } catch (error: any) {
      updateBatchCard(card.id, (current) => ({
        ...current,
        tradeStatus: "error",
        tradeError: error?.message || "Could not add this card to trade.",
      }));
      setBatchError(error?.message || "Could not add this card to trade.");
    }
  }

  const resultCertificationLookupHref = result
    ? certificationLookupHref(result.ai)
    : null;

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {testMode && (
        <section
          style={{
            border: "1px solid #d7e4ff",
            borderRadius: 12,
            padding: 20,
            background: "#f8fbff",
          }}
        >
          <h2 style={{ marginTop: 0 }}>InstaComp™ Test Model</h2>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "center",
            }}
          >
            <button
              type="button"
              onClick={() => void runAllTestModelCycles()}
              aria-disabled={batchRunning || batchDrafting}
              style={{
                ...buttonStyle,
                background: batchRunning || batchDrafting ? "#999" : "#111",
                borderColor: batchRunning || batchDrafting ? "#999" : "#111",
                cursor: batchRunning || batchDrafting ? "not-allowed" : "pointer",
              }}
            >
              {batchRunning || batchDrafting
                ? "Running All Cycles..."
                : "Run All Test Cycles"}
            </button>
            <button
              type="button"
              onClick={() => void runTestModelFullCycle()}
              aria-disabled={batchRunning || batchDrafting}
              style={{
                ...buttonStyle,
                background: batchRunning || batchDrafting ? "#999" : "#0f5132",
                borderColor: batchRunning || batchDrafting ? "#999" : "#0f5132",
                cursor: batchRunning || batchDrafting ? "not-allowed" : "pointer",
              }}
            >
              {batchRunning ? "Running Test Cycle..." : "Run Full Test Cycle"}
            </button>
            <button
              type="button"
              onClick={() => void runTestModelDraftCycle()}
              aria-disabled={batchRunning || batchDrafting}
              style={{
                ...buttonStyle,
                background:
                  batchRunning || batchDrafting ? "#999" : "#7a4f00",
                borderColor:
                  batchRunning || batchDrafting ? "#999" : "#7a4f00",
                cursor: batchRunning || batchDrafting ? "not-allowed" : "pointer",
              }}
            >
              {batchDrafting
                ? "Running Draft Cycle..."
                : "Run Draft Test Cycle"}
            </button>
            <button
              type="button"
              onClick={() => loadTestBatchModel(true)}
              aria-disabled={batchRunning || batchDrafting}
              style={{
                ...buttonStyle,
                background: batchRunning || batchDrafting ? "#999" : "#1d4ed8",
                borderColor: batchRunning || batchDrafting ? "#999" : "#1d4ed8",
                cursor: batchRunning || batchDrafting ? "not-allowed" : "pointer",
              }}
            >
              Load Completed Test Matrix
            </button>
            <button
              type="button"
              onClick={() => loadTestBatchModel(false)}
              aria-disabled={batchRunning || batchDrafting}
              style={{
                ...secondaryButtonStyle,
                cursor: batchRunning || batchDrafting ? "not-allowed" : "pointer",
                opacity: batchRunning || batchDrafting ? 0.55 : 1,
              }}
            >
              Load Queued Test Batch
            </button>
            <button
              type="button"
              onClick={loadSingleTestScan}
              aria-disabled={loading || batchRunning || batchDrafting}
              style={{
                ...secondaryButtonStyle,
                cursor:
                  loading || batchRunning || batchDrafting
                    ? "not-allowed"
                    : "pointer",
                opacity: loading || batchRunning || batchDrafting ? 0.55 : 1,
              }}
            >
              Load Single Test Scan
            </button>
            <button
              type="button"
              onClick={() => runTestModelSmokeCheck()}
              aria-disabled={batchRunning || batchDrafting || !batchCards.length}
              style={{
                ...secondaryButtonStyle,
                borderColor: "#1d4ed8",
                color: "#1d4ed8",
                cursor:
                  batchRunning || batchDrafting || !batchCards.length
                    ? "not-allowed"
                    : "pointer",
                opacity: batchRunning || batchDrafting || !batchCards.length ? 0.55 : 1,
              }}
            >
              Run Smoke Check
            </button>
            <button
              type="button"
              onClick={exportTestModelEvidenceReport}
              aria-disabled={
                batchRunning || batchDrafting || (!batchCards.length && !result)
              }
              style={{
                ...secondaryButtonStyle,
                borderColor: "#0f5132",
                color: "#0f5132",
                cursor:
                  batchRunning ||
                  batchDrafting ||
                  (!batchCards.length && !result)
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  batchRunning ||
                  batchDrafting ||
                  (!batchCards.length && !result)
                    ? 0.55
                    : 1,
              }}
            >
              Export Test Evidence
            </button>
            <button
              type="button"
              onClick={() => void copyTestModelEvidenceReport()}
              aria-disabled={
                batchRunning || batchDrafting || (!batchCards.length && !result)
              }
              style={{
                ...secondaryButtonStyle,
                borderColor: "#0f5132",
                color: "#0f5132",
                cursor:
                  batchRunning ||
                  batchDrafting ||
                  (!batchCards.length && !result)
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  batchRunning ||
                  batchDrafting ||
                  (!batchCards.length && !result)
                    ? 0.55
                    : 1,
              }}
            >
              Copy Test Evidence
            </button>
            <button
              type="button"
              onClick={exportTestModelSmokeCheckCsv}
              aria-disabled={batchRunning || batchDrafting || !testModelChecks.length}
              style={{
                ...secondaryButtonStyle,
                borderColor: "#7a4f00",
                color: "#7a4f00",
                cursor:
                  batchRunning || batchDrafting || !testModelChecks.length
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  batchRunning || batchDrafting || !testModelChecks.length
                    ? 0.55
                    : 1,
              }}
            >
              Export Smoke CSV
            </button>
            <button
              type="button"
              onClick={() => void copyTestModelSmokeCheckCsv()}
              aria-disabled={batchRunning || batchDrafting || !testModelChecks.length}
              style={{
                ...secondaryButtonStyle,
                borderColor: "#7a4f00",
                color: "#7a4f00",
                cursor:
                  batchRunning || batchDrafting || !testModelChecks.length
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  batchRunning || batchDrafting || !testModelChecks.length
                    ? 0.55
                    : 1,
              }}
            >
              Copy Smoke CSV
            </button>
            <button
              type="button"
              onClick={exportTestModelSmokeCheckJson}
              aria-disabled={batchRunning || batchDrafting || !testModelChecks.length}
              style={{
                ...secondaryButtonStyle,
                borderColor: "#7a4f00",
                color: "#7a4f00",
                cursor:
                  batchRunning || batchDrafting || !testModelChecks.length
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  batchRunning || batchDrafting || !testModelChecks.length
                    ? 0.55
                    : 1,
              }}
            >
              Export Smoke JSON
            </button>
            <button
              type="button"
              onClick={() => void copyTestModelSmokeCheckJson()}
              aria-disabled={batchRunning || batchDrafting || !testModelChecks.length}
              style={{
                ...secondaryButtonStyle,
                borderColor: "#7a4f00",
                color: "#7a4f00",
                cursor:
                  batchRunning || batchDrafting || !testModelChecks.length
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  batchRunning || batchDrafting || !testModelChecks.length
                    ? 0.55
                    : 1,
              }}
            >
              Copy Smoke JSON
            </button>
            <button
              type="button"
              onClick={exportTestModelFailureSummaryCsv}
              aria-disabled={
                batchRunning ||
                batchDrafting ||
                (testModelFailedCount === 0 && testModelProblemRowCount === 0)
              }
              style={{
                ...secondaryButtonStyle,
                borderColor: "#b42318",
                color: "#b42318",
                cursor:
                  batchRunning ||
                  batchDrafting ||
                  (testModelFailedCount === 0 && testModelProblemRowCount === 0)
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  batchRunning ||
                  batchDrafting ||
                  (testModelFailedCount === 0 && testModelProblemRowCount === 0)
                    ? 0.55
                    : 1,
              }}
            >
              Export Failure CSV
            </button>
            <button
              type="button"
              onClick={() => void copyTestModelFailureSummaryCsv()}
              aria-disabled={
                batchRunning ||
                batchDrafting ||
                (testModelFailedCount === 0 && testModelProblemRowCount === 0)
              }
              style={{
                ...secondaryButtonStyle,
                borderColor: "#b42318",
                color: "#b42318",
                cursor:
                  batchRunning ||
                  batchDrafting ||
                  (testModelFailedCount === 0 && testModelProblemRowCount === 0)
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  batchRunning ||
                  batchDrafting ||
                  (testModelFailedCount === 0 && testModelProblemRowCount === 0)
                    ? 0.55
                    : 1,
              }}
            >
              Copy Failure CSV
            </button>
            <button
              type="button"
              onClick={exportTestModelFailureJson}
              aria-disabled={
                batchRunning ||
                batchDrafting ||
                (testModelFailedCount === 0 && testModelProblemRowCount === 0)
              }
              style={{
                ...secondaryButtonStyle,
                borderColor: "#b42318",
                color: "#b42318",
                cursor:
                  batchRunning ||
                  batchDrafting ||
                  (testModelFailedCount === 0 && testModelProblemRowCount === 0)
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  batchRunning ||
                  batchDrafting ||
                  (testModelFailedCount === 0 && testModelProblemRowCount === 0)
                    ? 0.55
                    : 1,
              }}
            >
              Export Failure JSON
            </button>
            <button
              type="button"
              onClick={() => void copyTestModelFailureJson()}
              aria-disabled={
                batchRunning ||
                batchDrafting ||
                (testModelFailedCount === 0 && testModelProblemRowCount === 0)
              }
              style={{
                ...secondaryButtonStyle,
                borderColor: "#b42318",
                color: "#b42318",
                cursor:
                  batchRunning ||
                  batchDrafting ||
                  (testModelFailedCount === 0 && testModelProblemRowCount === 0)
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  batchRunning ||
                  batchDrafting ||
                  (testModelFailedCount === 0 && testModelProblemRowCount === 0)
                    ? 0.55
                    : 1,
              }}
            >
              Copy Failure JSON
            </button>
            <button
              type="button"
              onClick={() => void copyTestModelFailureSummary()}
              aria-disabled={
                batchRunning ||
                batchDrafting ||
                (testModelFailedCount === 0 && testModelProblemRowCount === 0)
              }
              style={{
                ...secondaryButtonStyle,
                borderColor: "#b42318",
                color: "#b42318",
                cursor:
                  batchRunning ||
                  batchDrafting ||
                  (testModelFailedCount === 0 && testModelProblemRowCount === 0)
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  batchRunning ||
                  batchDrafting ||
                  (testModelFailedCount === 0 && testModelProblemRowCount === 0)
                    ? 0.55
                    : 1,
              }}
            >
              Copy Failure Summary
            </button>
            <button
              type="button"
              onClick={() =>
                showTestModelProblemRows(
                  "problems",
                  testModelProblemRowCount,
                  "problem rows"
                )
              }
              aria-disabled={
                batchRunning || batchDrafting || testModelProblemRowCount === 0
              }
              style={{
                ...secondaryButtonStyle,
                borderColor: "#b42318",
                color: "#b42318",
                cursor:
                  batchRunning || batchDrafting || testModelProblemRowCount === 0
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  batchRunning || batchDrafting || testModelProblemRowCount === 0
                    ? 0.55
                    : 1,
              }}
            >
              Show Problem Rows
            </button>
            <button
              type="button"
              onClick={exportTestModelFixtureManifest}
              aria-disabled={batchRunning || batchDrafting}
              style={{
                ...secondaryButtonStyle,
                borderColor: "#555",
                color: "#111",
                cursor:
                  batchRunning || batchDrafting ? "not-allowed" : "pointer",
                opacity: batchRunning || batchDrafting ? 0.55 : 1,
              }}
            >
              Export Fixture Manifest
            </button>
            <button
              type="button"
              onClick={() => void copyTestModelFixtureManifest()}
              aria-disabled={batchRunning || batchDrafting}
              style={{
                ...secondaryButtonStyle,
                borderColor: "#555",
                color: "#111",
                cursor:
                  batchRunning || batchDrafting ? "not-allowed" : "pointer",
                opacity: batchRunning || batchDrafting ? 0.55 : 1,
              }}
            >
              Copy Fixture Manifest
            </button>
            <button
              type="button"
              onClick={() => void copyTestModelQaSummary()}
              aria-disabled={
                batchRunning ||
                batchDrafting ||
                (!batchCards.length &&
                  !testModelChecks.length &&
                  !testModelRunRecords.length)
              }
              style={{
                ...secondaryButtonStyle,
                borderColor: "#111",
                color: "#111",
                cursor:
                  batchRunning ||
                  batchDrafting ||
                  (!batchCards.length &&
                    !testModelChecks.length &&
                    !testModelRunRecords.length)
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  batchRunning ||
                  batchDrafting ||
                  (!batchCards.length &&
                    !testModelChecks.length &&
                    !testModelRunRecords.length)
                    ? 0.55
                    : 1,
              }}
            >
              Copy QA Summary
            </button>
            <button
              type="button"
              onClick={resetTestLab}
              aria-disabled={loading || batchRunning || batchDrafting}
              style={{
                ...secondaryButtonStyle,
                borderColor: "#b42318",
                color: "#b42318",
                cursor:
                  loading || batchRunning || batchDrafting
                    ? "not-allowed"
                    : "pointer",
                opacity: loading || batchRunning || batchDrafting ? 0.55 : 1,
              }}
            >
              Reset Test Lab
            </button>
            <strong style={{ color: "#1d4ed8" }}>
              Mock scans and draft simulation are active
              {testModelChecks.length
                ? ` - ${testModelPassedCount}/${testModelChecks.length} passed (${testModelCheckScenario.replace(
                    "_",
                    " "
                  )})`
                : ""}
              {testModelProblemRowCount
                ? ` - ${testModelProblemRowCount} problem rows`
                : ""}
            </strong>
          </div>
          {testModelProblemRowCount > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
                gap: 8,
                marginTop: 14,
              }}
            >
              {testModelProblemBreakdown.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() =>
                    showTestModelProblemRows(
                      item.filter,
                      item.count,
                      item.label
                    )
                  }
                  aria-disabled={item.count === 0}
                  style={{
                    ...secondaryButtonStyle,
                    borderColor: item.count ? "#b42318" : "#ddd",
                    color: item.count ? "#b42318" : "#777",
                    background: item.count ? "#fff8f6" : "#fafafa",
                    cursor: item.count ? "pointer" : "not-allowed",
                    opacity: item.count ? 1 : 0.65,
                    textAlign: "left",
                  }}
                >
                  {item.label}: {item.count}
                </button>
              ))}
            </div>
          )}
          {testModelChecks.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 8,
                marginTop: 14,
              }}
            >
              {testModelChecks.map((check) => (
                <div
                  key={check.label}
                  style={{
                    border: check.pass ? "1px solid #9bd6ac" : "1px solid #e3a2a2",
                    borderRadius: 8,
                    padding: "8px 10px",
                    background: check.pass ? "#f0fff4" : "#fff5f5",
                  }}
                >
                  <div
                    style={{
                      color: check.pass ? "#0f5132" : "#8a1f1f",
                      fontSize: 12,
                      fontWeight: 900,
                    }}
                  >
                    {check.pass ? "PASS" : "FAIL"}
                  </div>
                  <div style={{ fontWeight: 900 }}>{check.label}</div>
                  <small style={{ color: "#555", fontWeight: 800 }}>
                    {check.actual} / {check.expected}
                  </small>
                </div>
              ))}
            </div>
          )}
          {testModelFailedCount > 0 && (
            <p style={{ color: "#8a1f1f", fontWeight: 800, marginBottom: 0 }}>
              Smoke check changed because the current matrix state changed.
            </p>
          )}
          {testModelRunRecords.length > 0 && (
            <div
              style={{
                marginTop: 14,
                border: "1px solid #d7e4ff",
                borderRadius: 8,
                background: "white",
                padding: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <strong>Test Run Ledger ({testModelRunRecords.length})</strong>
                <small style={{ color: "#555", fontWeight: 800 }}>
                  Saved in this browser
                </small>
                <button
                  type="button"
                  onClick={exportTestModelRunLedgerCsv}
                  aria-disabled={batchRunning || batchDrafting}
                  style={{
                    ...secondaryButtonStyle,
                    padding: "7px 10px",
                    borderColor: "#0f5132",
                    color: "#0f5132",
                    opacity: batchRunning || batchDrafting ? 0.55 : 1,
                    cursor:
                      batchRunning || batchDrafting ? "not-allowed" : "pointer",
                  }}
                >
                  Export Ledger CSV
                </button>
                <button
                  type="button"
                  onClick={() => void copyTestModelRunLedgerCsv()}
                  aria-disabled={batchRunning || batchDrafting}
                  style={{
                    ...secondaryButtonStyle,
                    padding: "7px 10px",
                    borderColor: "#0f5132",
                    color: "#0f5132",
                    opacity: batchRunning || batchDrafting ? 0.55 : 1,
                    cursor:
                      batchRunning || batchDrafting ? "not-allowed" : "pointer",
                  }}
                >
                  Copy Ledger CSV
                </button>
                <button
                  type="button"
                  onClick={exportTestModelRunLedgerJson}
                  aria-disabled={batchRunning || batchDrafting}
                  style={{
                    ...secondaryButtonStyle,
                    padding: "7px 10px",
                    borderColor: "#0f5132",
                    color: "#0f5132",
                    opacity: batchRunning || batchDrafting ? 0.55 : 1,
                    cursor:
                      batchRunning || batchDrafting ? "not-allowed" : "pointer",
                  }}
                >
                  Export Ledger JSON
                </button>
                <button
                  type="button"
                  onClick={() => void copyTestModelRunLedgerJson()}
                  aria-disabled={batchRunning || batchDrafting}
                  style={{
                    ...secondaryButtonStyle,
                    padding: "7px 10px",
                    borderColor: "#0f5132",
                    color: "#0f5132",
                    opacity: batchRunning || batchDrafting ? 0.55 : 1,
                    cursor:
                      batchRunning || batchDrafting ? "not-allowed" : "pointer",
                  }}
                >
                  Copy Ledger JSON
                </button>
                <button
                  type="button"
                  onClick={() => void copyTestModelRunLedgerSummary()}
                  aria-disabled={batchRunning || batchDrafting}
                  style={{
                    ...secondaryButtonStyle,
                    padding: "7px 10px",
                    borderColor: "#111",
                    color: "#111",
                    opacity: batchRunning || batchDrafting ? 0.55 : 1,
                    cursor:
                      batchRunning || batchDrafting ? "not-allowed" : "pointer",
                  }}
                >
                  Copy Ledger Summary
                </button>
                <button
                  type="button"
                  onClick={clearTestModelRunLedger}
                  aria-disabled={batchRunning || batchDrafting}
                  style={{
                    ...secondaryButtonStyle,
                    padding: "7px 10px",
                    opacity: batchRunning || batchDrafting ? 0.55 : 1,
                    cursor:
                      batchRunning || batchDrafting ? "not-allowed" : "pointer",
                  }}
                >
                  Clear Ledger
                </button>
              </div>
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                {testModelRunRecords.map((record) => (
                  <div
                    key={record.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                      gap: 8,
                      alignItems: "center",
                      borderTop: "1px solid #eef3ff",
                      paddingTop: 8,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 900 }}>{record.label}</div>
                      <small style={{ color: "#555", fontWeight: 800 }}>
                        {new Date(record.ranAt).toLocaleTimeString()}
                      </small>
                    </div>
                    <small style={{ color: "#555", fontWeight: 800 }}>
                      {record.scenario.replace("_", " ")} - {record.rowCount} rows
                      {record.problemRows
                        ? ` - ${record.problemRows} problems`
                        : ""}
                      {record.scanFailures
                        ? ` - ${record.scanFailures} scan`
                        : ""}
                      {record.draftFailures
                        ? ` - ${record.draftFailures} draft`
                        : ""}
                      {record.reviewRows
                        ? ` - ${record.reviewRows} review`
                        : ""}
                      {record.fixRows ? ` - ${record.fixRows} fix` : ""}
                    </small>
                    <strong
                      style={{
                        color: record.failed ? "#8a1f1f" : "#0f5132",
                      }}
                    >
                      {record.passed}/{record.total} passed
                      {record.failed ? ` - ${record.failed} failed` : ""}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 20,
          background: "white",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Batch Scan Up To 500 Cards</h2>

        <div
          onDrop={(event) => {
            event.preventDefault();
            if (!batchRunning && !batchDrafting && !persistentJobPreparing) {
              addBatchFiles(event.dataTransfer.files);
            }
          }}
          onDragOver={(event) => event.preventDefault()}
          style={{
            border: "2px dashed #999",
            borderRadius: 12,
            padding: 24,
            background: "#fafafa",
            textAlign: "center",
          }}
        >
          <div style={{ fontWeight: 900 }}>
            Drag card images here or choose files
          </div>
          <p style={{ margin: "8px 0 14px", color: "#555" }}>
            Drop photos in card-pair order. If filenames include front/back,
            InstaComp™ uses them; otherwise it groups image 1 with 2, image 3
            with 4, and so on. Single-image cards still scan, but paired images
            improve identification.
          </p>
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={
              batchRunning ||
              batchDrafting ||
              persistentJobPreparing ||
              batchCards.length >= MAX_BATCH_CARDS
            }
            onChange={(event) => {
              if (event.target.files) addBatchFiles(event.target.files);
              event.currentTarget.value = "";
            }}
          />
        </div>

        <div
          style={{
            marginTop: 18,
            border: "1px solid #111",
            borderRadius: 16,
            padding: 18,
            background:
              "linear-gradient(135deg, #111 0%, #1f2937 52%, #064e3b 100%)",
            color: "white",
            display: "grid",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h3 style={{ margin: "0 0 4px", fontSize: 24 }}>
                InstaComp™ Auto-Pilot
              </h3>
              <p style={{ margin: 0, color: "#d1fae5", fontWeight: 800 }}>
                One button after upload: scan the lot, read card text, pull comps,
                and create TCOS draft listings for rows that are safe to list.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void autoScanAndDraftBatch()}
              disabled={
                batchRunning ||
                batchDrafting ||
                persistentJobPreparing ||
                !batchCards.length
              }
              style={{
                border: "1px solid #facc15",
                borderRadius: 999,
                background:
                  batchRunning ||
                  batchDrafting ||
                  persistentJobPreparing ||
                  !batchCards.length
                    ? "#999"
                    : "#facc15",
                color: "#111",
                cursor:
                  batchRunning ||
                  batchDrafting ||
                  persistentJobPreparing ||
                  !batchCards.length
                    ? "not-allowed"
                    : "pointer",
                fontSize: 18,
                fontWeight: 1000,
                padding: "14px 22px",
                boxShadow:
                  batchRunning ||
                  batchDrafting ||
                  persistentJobPreparing ||
                  !batchCards.length
                    ? "none"
                    : "0 12px 30px rgba(250, 204, 21, 0.28)",
              }}
            >
              {persistentJobPreparing
                ? "Securing Uploads..."
                : batchRunning
                ? "Scanning..."
                : batchDrafting
                  ? "Creating Drafts..."
                  : "Run InstaComp™ Auto-Pilot"}
            </button>
          </div>
          <small style={{ color: "#e5e7eb", fontWeight: 800 }}>
            Safe rows become TCOS drafts. Uncertain rows stay in review so bad
            card IDs, missing serials, missing prices, or weak comps do not go
            live pretending to be 100%.
          </small>
          {persistentUploadProgress ? (
            <div
              style={{
                display: "grid",
                gap: 6,
                borderTop: "1px solid rgba(255,255,255,0.2)",
                paddingTop: 10,
              }}
            >
              <progress
                max={Math.max(1, persistentUploadProgress.total)}
                value={persistentUploadProgress.completed}
                style={{ width: "100%" }}
              />
              <small style={{ color: "#d1fae5", fontWeight: 900 }}>
                Private intake uploads: {persistentUploadProgress.completed}/
                {persistentUploadProgress.total}
                {persistentJob ? ` - queue ${persistentJob.status}` : ""}
              </small>
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
            marginTop: 16,
          }}
        >
          <label
            style={{
              display: "grid",
              gap: 4,
              color: "#333",
              fontSize: 12,
              fontWeight: 900,
            }}
          >
            Parallel Scans
            <input
              type="number"
              min="1"
              max={String(INSTACOMP_BATCH_MAX_CONCURRENCY)}
              value={batchConcurrency}
              disabled={batchRunning || batchDrafting || persistentJobPreparing}
              onChange={(event) =>
                handleBatchConcurrencyChange(event.target.value)
              }
              style={{
                width: 92,
                border: "1px solid #bbb",
                borderRadius: 8,
                padding: "9px 10px",
                fontWeight: 900,
              }}
            />
          </label>

          <label
            style={{
              display: "grid",
              gap: 4,
              color: "#333",
              fontSize: 12,
              fontWeight: 900,
            }}
          >
            AI Council
            <select
              value={aiCouncilTier}
              disabled={batchRunning || batchDrafting || persistentJobPreparing}
              onChange={(event) =>
                setAiCouncilTier(event.target.value as AiCouncilTier)
              }
              style={{
                minWidth: 158,
                border: "1px solid #bbb",
                borderRadius: 8,
                padding: "9px 10px",
                fontWeight: 900,
                background: "white",
              }}
              title={
                AI_COUNCIL_TIER_OPTIONS.find(
                  (option) => option.value === aiCouncilTier
                )?.description || "Choose how many AI witnesses to use."
              }
            >
              {AI_COUNCIL_TIER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => void scanBatch()}
            aria-disabled={
              batchRunning ||
              batchDrafting ||
              persistentJobPreparing ||
              !batchCards.length
            }
            style={{
              ...buttonStyle,
              background:
                batchRunning ||
                batchDrafting ||
                persistentJobPreparing ||
                !batchCards.length
                  ? "#999"
                  : "#111",
              borderColor:
                batchRunning ||
                batchDrafting ||
                persistentJobPreparing ||
                !batchCards.length
                  ? "#999"
                  : "#111",
              cursor:
                batchRunning ||
                batchDrafting ||
                persistentJobPreparing ||
                !batchCards.length
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {batchRunning
              ? "Batch is scanning..."
              : batchPauseRequested
                ? "Resume Batch"
                : "Run Batch InstaComp™"}
          </button>

          <button
            type="button"
            onClick={requestBatchPause}
            aria-disabled={!batchRunning || batchPauseRequested}
            style={{
              ...secondaryButtonStyle,
              cursor:
                !batchRunning || batchPauseRequested ? "not-allowed" : "pointer",
              opacity: !batchRunning || batchPauseRequested ? 0.55 : 1,
            }}
          >
            {batchPauseRequested ? "Pausing..." : "Pause After Current"}
          </button>

          <button
            type="button"
            onClick={() => void retryRateLimitedBatchCards()}
            aria-disabled={
              batchRunning ||
              batchDrafting ||
              batchRateLimitErrorCount === 0
            }
            style={{
              ...secondaryButtonStyle,
              borderColor: "#b45309",
              color: "#92400e",
              cursor:
                batchRunning || batchDrafting || batchRateLimitErrorCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning || batchDrafting || batchRateLimitErrorCount === 0
                  ? 0.55
                  : 1,
            }}
            title={`Wait about ${INSTACOMP_RATE_LIMIT_RETRY_SECONDS} seconds after a token-rate limit, then retry only those failed rows.`}
          >
            Continue Rate-Limited ({batchRateLimitErrorCount})
          </button>

          <button
            type="button"
            onClick={() => void retryOperatorMarkedWrongBatchCards()}
            aria-disabled={
              batchRunning ||
              batchDrafting ||
              batchOperatorMarkedWrongCount === 0
            }
            style={{
              ...secondaryButtonStyle,
              borderColor: "#dc2626",
              color: "#991b1b",
              cursor:
                batchRunning || batchDrafting || batchOperatorMarkedWrongCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning || batchDrafting || batchOperatorMarkedWrongCount === 0
                  ? 0.55
                  : 1,
            }}
          >
            Process Marked Problems ({batchOperatorMarkedWrongCount})
          </button>

          <button
            type="button"
            onClick={selectOperatorMarkedProblemBatchCards}
            aria-disabled={
              batchRunning ||
              batchDrafting ||
              batchOperatorMarkedWrongCount === 0
            }
            style={{
              ...secondaryButtonStyle,
              borderColor: "#7c3aed",
              color: "#5b21b6",
              cursor:
                batchRunning || batchDrafting || batchOperatorMarkedWrongCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning || batchDrafting || batchOperatorMarkedWrongCount === 0
                  ? 0.55
                  : 1,
            }}
          >
            Select Marked Problems ({batchOperatorMarkedWrongCount})
          </button>

          <button
            type="button"
            onClick={removeSelectedOperatorMarkedProblemBatchCards}
            aria-disabled={
              batchRunning ||
              batchDrafting ||
              selectedOperatorMarkedProblemCount === 0
            }
            title={
              batchBusyBlockedReason("removing selected marked problem rows") ||
              (selectedOperatorMarkedProblemCount === 0
                ? "Select rows marked wrong or needs more info before removing them."
                : "Remove selected wrong or needs-more-info rows from this batch and cancel saved storage when available.")
            }
            style={{
              ...secondaryButtonStyle,
              borderColor: "#dc2626",
              color: "#991b1b",
              cursor:
                batchRunning ||
                batchDrafting ||
                selectedOperatorMarkedProblemCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning ||
                batchDrafting ||
                selectedOperatorMarkedProblemCount === 0
                  ? 0.55
                  : 1,
            }}
          >
            Remove Selected Problems ({selectedOperatorMarkedProblemCount})
          </button>

          <button
            type="button"
            onClick={() => void scanBatch({ retryOnly: true })}
            aria-disabled={batchRunning || batchDrafting || batchErrorCount === 0}
            style={{
              ...secondaryButtonStyle,
              cursor:
                batchRunning || batchDrafting || batchErrorCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning || batchDrafting || batchErrorCount === 0
                  ? 0.55
                  : 1,
            }}
          >
            Retry Failed ({batchErrorCount})
          </button>

          <button
            type="button"
            onClick={() => markSelectedOperatorReview("wrong")}
            aria-disabled={
              batchRunning || batchDrafting || selectedReviewableBatchCards.length === 0
            }
            style={{
              ...secondaryButtonStyle,
              borderColor: "#dc2626",
              color: "#991b1b",
              cursor:
                batchRunning ||
                batchDrafting ||
                selectedReviewableBatchCards.length === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning ||
                batchDrafting ||
                selectedReviewableBatchCards.length === 0
                  ? 0.55
                  : 1,
            }}
          >
            Mark Selected Wrong ({selectedReviewableBatchCards.length})
          </button>

          <button
            type="button"
            onClick={() => markSelectedOperatorReview("needs_more_info")}
            aria-disabled={
              batchRunning || batchDrafting || selectedReviewableBatchCards.length === 0
            }
            style={{
              ...secondaryButtonStyle,
              borderColor: "#b45309",
              color: "#92400e",
              cursor:
                batchRunning ||
                batchDrafting ||
                selectedReviewableBatchCards.length === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning ||
                batchDrafting ||
                selectedReviewableBatchCards.length === 0
                  ? 0.55
                  : 1,
            }}
          >
            Needs More Info ({selectedReviewableBatchCards.length})
          </button>

          <button
            type="button"
            onClick={() => markSelectedOperatorReview("clear")}
            aria-disabled={
              batchRunning || batchDrafting || selectedReviewableBatchCards.length === 0
            }
            style={{
              ...secondaryButtonStyle,
              cursor:
                batchRunning ||
                batchDrafting ||
                selectedReviewableBatchCards.length === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning ||
                batchDrafting ||
                selectedReviewableBatchCards.length === 0
                  ? 0.55
                  : 1,
            }}
          >
            Clear Selected Review ({selectedReviewableBatchCards.length})
          </button>

          <button
            type="button"
            onClick={() => void saveSelectedBatchCorrections()}
            aria-disabled={
              batchRunning ||
              batchDrafting ||
              batchKnowledgeSaving ||
              selectedSavableCorrectionCount === 0
            }
            style={{
              ...secondaryButtonStyle,
              borderColor: "#0f5132",
              color: "#0f5132",
              cursor:
                batchRunning ||
                batchDrafting ||
                batchKnowledgeSaving ||
                selectedSavableCorrectionCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning ||
                batchDrafting ||
                batchKnowledgeSaving ||
                selectedSavableCorrectionCount === 0
                  ? 0.55
                  : 1,
            }}
          >
            Save Selected Corrections ({selectedSavableCorrectionCount})
          </button>

          <button
            type="button"
            onClick={() => void refreshSelectedBatchComps()}
            aria-disabled={
              batchRunning ||
              batchDrafting ||
              batchKnowledgeSaving ||
              selectedRefreshableCompCount === 0
            }
            style={{
              ...secondaryButtonStyle,
              borderColor: "#7c3aed",
              color: "#5b21b6",
              cursor:
                batchRunning ||
                batchDrafting ||
                batchKnowledgeSaving ||
                selectedRefreshableCompCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning ||
                batchDrafting ||
                batchKnowledgeSaving ||
                selectedRefreshableCompCount === 0
                  ? 0.55
                  : 1,
            }}
          >
            Refresh Selected Comps ({selectedRefreshableCompCount})
          </button>

          <button
            type="button"
            onClick={() => void processSavedLotToKnowledgeBase()}
            aria-disabled={
              batchRunning ||
              batchDrafting ||
              batchKnowledgeSaving ||
              !persistentJob ||
              batchDoneCount === 0
            }
            style={{
              ...buttonStyle,
              background:
                batchRunning ||
                batchDrafting ||
                batchKnowledgeSaving ||
                !persistentJob ||
                batchDoneCount === 0
                  ? "#999"
                  : "#0f5132",
              borderColor:
                batchRunning ||
                batchDrafting ||
                batchKnowledgeSaving ||
                !persistentJob ||
                batchDoneCount === 0
                  ? "#999"
                  : "#0f5132",
              cursor:
                batchRunning ||
                batchDrafting ||
                batchKnowledgeSaving ||
                !persistentJob ||
                batchDoneCount === 0
                  ? "not-allowed"
                  : "pointer",
            }}
            title="Save completed rows from this saved InstaComp™ lot into the TCOS Card DB. They become trusted only after 3 confirmed sightings."
          >
            {batchKnowledgeSaving
              ? "Processing TCOS DB..."
              : `Process Saved Lot to TCOS DB (${batchDoneCount})`}
          </button>

          <button
            type="button"
            onClick={createDraftListings}
            aria-disabled={createDraftButtonDisabled}
            title={batchActionTitle({
              action: "creating draft listings",
              blocked: selectedDraftFixCount
                ? "Fix or deselect selected rows that need edits before creating drafts."
                : selectedDraftReadyCount === 0
                  ? "Select at least one ready draft row before creating drafts."
                  : "",
              ready: "Create TCOS draft listings for the selected ready rows.",
            })}
            style={{
              ...buttonStyle,
              background: createDraftButtonDisabled ? "#999" : "#0f5132",
              borderColor: createDraftButtonDisabled ? "#999" : "#0f5132",
              cursor: createDraftButtonDisabled ? "not-allowed" : "pointer",
            }}
          >
            {batchDrafting
              ? "Creating drafts..."
              : selectedDraftFixCount > 0
                ? `Fix Selected Rows (${selectedDraftFixCount})`
                : `Create Draft Listings (${selectedDraftReadyCount})`}
          </button>

          <small style={{ color: "#555", fontWeight: 800 }}>
            {selectedDraftSummary}
          </small>

          <button
            type="button"
            onClick={() => setAllDoneBatchCardsSelected(true)}
            aria-disabled={batchRunning || batchDrafting || batchDraftableCount === 0}
            title={batchActionTitle({
              action: "selecting draftable rows",
              blocked: batchDraftableCount === 0
                ? "No draftable rows are available to select."
                : "",
              ready: "Select every completed row that can become a draft.",
            })}
            style={{
              ...secondaryButtonStyle,
              cursor:
                batchRunning || batchDrafting || batchDraftableCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning || batchDrafting || batchDraftableCount === 0
                  ? 0.55
                  : 1,
            }}
          >
            Select Draftable
          </button>

          <button
            type="button"
            onClick={selectReadyDraftableBatchCards}
            aria-disabled={batchRunning || batchDrafting || readyDraftableCount === 0}
            title={batchActionTitle({
              action: "selecting ready draft rows",
              blocked: readyDraftableCount === 0
                ? "No ready rows are available to select."
                : "",
              ready: "Select draftable rows with no missing draft fields.",
            })}
            style={{
              ...secondaryButtonStyle,
              cursor:
                batchRunning || batchDrafting || readyDraftableCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning || batchDrafting || readyDraftableCount === 0
                  ? 0.55
                  : 1,
            }}
          >
            Select Ready ({readyDraftableCount})
          </button>

          <button
            type="button"
            onClick={selectCleanDraftableBatchCards}
            aria-disabled={batchRunning || batchDrafting || cleanDraftableCount === 0}
            title={batchActionTitle({
              action: "selecting clean draft rows",
              blocked: cleanDraftableCount === 0
                ? "No clean rows are available to select."
                : "",
              ready: "Select draftable rows without review warnings.",
            })}
            style={{
              ...secondaryButtonStyle,
              cursor:
                batchRunning || batchDrafting || cleanDraftableCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning || batchDrafting || cleanDraftableCount === 0
                  ? 0.55
                  : 1,
            }}
          >
            Select Clean ({cleanDraftableCount})
          </button>

          <button
            type="button"
            onClick={selectCleanReadyDraftableBatchCards}
            aria-disabled={batchRunning || batchDrafting || cleanReadyCount === 0}
            title={batchActionTitle({
              action: "selecting clean ready draft rows",
              blocked: cleanReadyCount === 0
                ? "No clean ready rows are available to select."
                : "",
              ready: "Select rows that are clean, ready, and safe to draft.",
            })}
            style={{
              ...secondaryButtonStyle,
              cursor:
                batchRunning || batchDrafting || cleanReadyCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning || batchDrafting || cleanReadyCount === 0 ? 0.55 : 1,
            }}
          >
            Select Clean Ready ({cleanReadyCount})
          </button>

          <button
            type="button"
            onClick={() => setAllDoneBatchCardsSelected(false)}
            aria-disabled={batchRunning || batchDrafting || batchDraftableCount === 0}
            title={batchActionTitle({
              action: "deselecting draftable rows",
              blocked: batchDraftableCount === 0
                ? "No draftable rows are available to deselect."
                : "",
              ready: "Clear selection from every draftable row.",
            })}
            style={{
              ...secondaryButtonStyle,
              cursor:
                batchRunning || batchDrafting || batchDraftableCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning || batchDrafting || batchDraftableCount === 0
                  ? 0.55
                  : 1,
            }}
          >
            Deselect Draftable
          </button>

          <button
            type="button"
            onClick={deselectDraftFixBatchCards}
            aria-disabled={batchRunning || batchDrafting || selectedDraftFixCount === 0}
            title={batchActionTitle({
              action: "deselecting selected rows that need fixes",
              blocked: selectedDraftFixCount === 0
                ? "No selected fix rows are available to deselect."
                : "",
              ready: "Deselect selected rows that still need draft fixes.",
            })}
            style={{
              ...secondaryButtonStyle,
              cursor:
                batchRunning || batchDrafting || selectedDraftFixCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning || batchDrafting || selectedDraftFixCount === 0
                  ? 0.55
                  : 1,
            }}
          >
            Deselect Fix ({selectedDraftFixCount})
          </button>

          <button
            type="button"
            onClick={deselectReadyReviewBatchCards}
            aria-disabled={batchRunning || batchDrafting || selectedReadyReviewCount === 0}
            title={batchActionTitle({
              action: "deselecting selected ready review rows",
              blocked: selectedReadyReviewCount === 0
                ? "No selected ready review rows are available to deselect."
                : "",
              ready: "Deselect selected rows that are ready but still need review.",
            })}
            style={{
              ...secondaryButtonStyle,
              cursor:
                batchRunning || batchDrafting || selectedReadyReviewCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning || batchDrafting || selectedReadyReviewCount === 0
                  ? 0.55
                  : 1,
            }}
          >
            Deselect Ready Review ({selectedReadyReviewCount})
          </button>

          <button
            type="button"
            onClick={deselectReviewDraftFixBatchCards}
            aria-disabled={
              batchRunning || batchDrafting || selectedReviewDraftFixCount === 0
            }
            title={batchActionTitle({
              action: "deselecting selected review fix rows",
              blocked: selectedReviewDraftFixCount === 0
                ? "No selected review fix rows are available to deselect."
                : "",
              ready: "Deselect selected review rows that also need draft fixes.",
            })}
            style={{
              ...secondaryButtonStyle,
              cursor:
                batchRunning || batchDrafting || selectedReviewDraftFixCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning || batchDrafting || selectedReviewDraftFixCount === 0
                  ? 0.55
                  : 1,
            }}
          >
            Deselect Review Fix ({selectedReviewDraftFixCount})
          </button>

          <button
            type="button"
            onClick={deselectCleanDraftFixBatchCards}
            aria-disabled={
              batchRunning || batchDrafting || selectedCleanDraftFixCount === 0
            }
            title={batchActionTitle({
              action: "deselecting selected clean fix rows",
              blocked: selectedCleanDraftFixCount === 0
                ? "No selected clean fix rows are available to deselect."
                : "",
              ready: "Deselect selected clean rows that still need draft fixes.",
            })}
            style={{
              ...secondaryButtonStyle,
              cursor:
                batchRunning || batchDrafting || selectedCleanDraftFixCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning || batchDrafting || selectedCleanDraftFixCount === 0
                  ? 0.55
                  : 1,
            }}
          >
            Deselect Clean Fix ({selectedCleanDraftFixCount})
          </button>

          <button
            type="button"
            onClick={deselectReviewBatchCards}
            aria-disabled={batchRunning || batchDrafting || selectedReviewCount === 0}
            title={batchActionTitle({
              action: "deselecting selected review rows",
              blocked: selectedReviewCount === 0
                ? "No selected review rows are available to deselect."
                : "",
              ready: "Deselect selected rows with review warnings.",
            })}
            style={{
              ...secondaryButtonStyle,
              cursor:
                batchRunning || batchDrafting || selectedReviewCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning || batchDrafting || selectedReviewCount === 0
                  ? 0.55
                  : 1,
            }}
          >
            Deselect Review ({selectedReviewCount})
          </button>

          <button
            type="button"
            onClick={exportVisibleBatchCsv}
            aria-disabled={!visibleBatchCards.length}
            title={
              visibleBatchCards.length
                ? "Export the current visible InstaComp™ rows as CSV."
                : "No visible InstaComp™ rows are available to export as CSV."
            }
            style={{
              ...secondaryButtonStyle,
              cursor: !visibleBatchCards.length ? "not-allowed" : "pointer",
              opacity: !visibleBatchCards.length ? 0.55 : 1,
            }}
          >
            Export View CSV
          </button>

          <button
            type="button"
            onClick={exportVisibleBatchJson}
            aria-disabled={!visibleBatchCards.length}
            title={
              visibleBatchCards.length
                ? "Export the current visible InstaComp™ rows as JSON."
                : "No visible InstaComp™ rows are available to export as JSON."
            }
            style={{
              ...secondaryButtonStyle,
              cursor: !visibleBatchCards.length ? "not-allowed" : "pointer",
              opacity: !visibleBatchCards.length ? 0.55 : 1,
            }}
          >
            Export View JSON
          </button>

          <button
            type="button"
            onClick={exportVisibleTrialResults}
            aria-disabled={
              batchRunning || batchDrafting || visibleTrialResultCount === 0
            }
            title={batchActionTitle({
              action: "exporting visible trial results",
              blocked: visibleTrialResultCount === 0
                ? "No visible trial result rows are available to export."
                : "",
              ready: "Export visible trial result rows for accuracy review.",
            })}
            style={{
              ...secondaryButtonStyle,
              borderColor: "#1d4ed8",
              color: "#1d4ed8",
              cursor:
                batchRunning || batchDrafting || visibleTrialResultCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning || batchDrafting || visibleTrialResultCount === 0
                  ? 0.55
                  : 1,
            }}
          >
            Export Trial Results ({visibleTrialResultCount})
          </button>

          <button
            type="button"
            onClick={() => void copyVisibleTrialResults()}
            aria-disabled={
              batchRunning || batchDrafting || visibleTrialResultCount === 0
            }
            style={{
              ...secondaryButtonStyle,
              borderColor: "#1d4ed8",
              color: "#1d4ed8",
              cursor:
                batchRunning || batchDrafting || visibleTrialResultCount === 0
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning || batchDrafting || visibleTrialResultCount === 0
                  ? 0.55
                  : 1,
            }}
          >
            Copy Trial Results ({visibleTrialResultCount})
          </button>

          <div
            style={{
              minWidth: 280,
              flex: "1 1 360px",
              border: `2px solid ${
                visibleTrialSpeedGate.readyToExport ? "#047857" : "#f59e0b"
              }`,
              borderRadius: 14,
              padding: "10px 12px",
              background: visibleTrialSpeedGate.readyToExport
                ? "#ecfdf5"
                : "#fffbeb",
              color: "#111",
              display: "grid",
              gap: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                alignItems: "center",
              }}
            >
              <strong>Final Tester Gate</strong>
              <span
                style={{
                  borderRadius: 999,
                  padding: "3px 8px",
                  fontSize: 12,
                  fontWeight: 900,
                  background: visibleTrialSpeedGate.readyToExport
                    ? "#047857"
                    : "#92400e",
                  color: "white",
                  whiteSpace: "nowrap",
                }}
              >
                {visibleTrialSpeedGate.readyToExport
                  ? "FINAL TESTER PASS"
                  : "NOT READY"}
              </span>
            </div>
            <small style={{ color: "#374151", fontWeight: 800 }}>
              Results {visibleTrialSpeedGate.resultRows}/
              {visibleTrialSpeedGate.targetCards} · Timing{" "}
              {visibleTrialSpeedGate.rowsWithTiming}/
              {visibleTrialSpeedGate.resultRows || visibleTrialSpeedGate.targetCards}
            </small>
            <small style={{ color: "#374151", fontWeight: 800 }}>
              Avg{" "}
              {visibleTrialSpeedGate.averageSeconds === null
                ? "n/a"
                : `${visibleTrialSpeedGate.averageSeconds}s`}
              {" / "}
              {visibleTrialSpeedGate.targetAverageSeconds}s · P95{" "}
              {visibleTrialSpeedGate.p95Seconds === null
                ? "n/a"
                : `${visibleTrialSpeedGate.p95Seconds}s`}
              {" / "}
              {visibleTrialSpeedGate.targetP95Seconds}s
            </small>
            {visibleTrialSpeedGate.slowestRows.length > 0 ? (
              <small style={{ color: "#6b7280", fontWeight: 700 }}>
                Slowest:{" "}
                {visibleTrialSpeedGate.slowestRows
                  .map(
                    (row) =>
                      `${row.trialCardId} ${row.seconds ?? "n/a"}s`
                  )
                  .join(", ")}
              </small>
            ) : (
              <small style={{ color: "#6b7280", fontWeight: 700 }}>
                Run/export the completed 100-card lot to prove the final tester speed gate.
              </small>
            )}
          </div>

          <button
            type="button"
            onClick={clearBatch}
            disabled={batchRunning || batchDrafting || !batchCards.length}
            style={{
              ...secondaryButtonStyle,
              cursor:
                batchRunning || batchDrafting || !batchCards.length
                  ? "not-allowed"
                  : "pointer",
              opacity:
                batchRunning || batchDrafting || !batchCards.length ? 0.55 : 1,
            }}
          >
            Clear Batch
          </button>

          <strong>
            {batchCards.length ? batchProgressLabel : "No cards queued"}
            {batchScanningCount ? ` - ${batchScanningCount} scanning` : ""}
            {batchErrorCount ? ` - ${batchErrorCount} errors` : ""}
            {batchPairedCount ? ` - ${batchPairedCount} paired` : ""}
            {batchDraftableCount ? ` - ${batchDraftableCount} draftable` : ""}
            {readyDraftableCount ? ` - ${readyDraftableCount} ready` : ""}
            {readyReviewCount ? ` - ${readyReviewCount} ready review` : ""}
            {cleanDraftableCount ? ` - ${cleanDraftableCount} clean` : ""}
            {cleanReadyCount ? ` - ${cleanReadyCount} clean ready` : ""}
            {cleanDraftFixCount ? ` - ${cleanDraftFixCount} clean fix` : ""}
            {batchReviewCount ? ` - ${batchReviewCount} review` : ""}
            {reviewDraftFixCount ? ` - ${reviewDraftFixCount} review fix` : ""}
            {batchDraftFixCount ? ` - ${batchDraftFixCount} fix` : ""}
            {batchOperatorMarkedWrongCount
              ? ` - ${batchOperatorMarkedWrongCount} marked problems`
              : ""}
            {batchDraftCreatedCount ? ` - ${batchDraftCreatedCount} drafts` : ""}
            {batchKnowledgeSavedCount
              ? ` - ${batchKnowledgeSavedCount} TCOS DB`
              : ""}
            {batchKnowledgeTrustedCount
              ? ` - ${batchKnowledgeTrustedCount} TCOS trusted`
              : ""}
          </strong>
        </div>

        {batchDraftableCount > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              marginTop: 12,
              padding: 10,
              border: "1px solid #eee",
              borderRadius: 10,
              background: "#fafafa",
            }}
          >
            <strong>
              Selected Bulk Edit ({selectedDoneBatchCards.length})
            </strong>
            <small style={{ color: "#555", fontWeight: 800 }}>
              {selectedDraftSummary}
            </small>
            <button
              type="button"
              onClick={exportSelectedDraftPayload}
              aria-disabled={exportDraftPayloadDisabled}
              title={batchActionTitle({
                action: "exporting selected draft payload",
                blocked: selectedDraftReadyCount === 0
                  ? "Select at least one ready draft row before exporting payload."
                  : "",
                ready: "Export the selected ready draft rows as a TCOS draft payload.",
              })}
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity: exportDraftPayloadDisabled ? 0.5 : 1,
                cursor: exportDraftPayloadDisabled ? "not-allowed" : "pointer",
              }}
            >
              Export Draft Payload ({selectedDraftReadyCount})
            </button>
            {testMode && (
              <button
                type="button"
                onClick={() => void copySelectedDraftPayload()}
                aria-disabled={exportDraftPayloadDisabled}
                title={batchActionTitle({
                  action: "copying selected draft payload",
                  blocked: selectedDraftReadyCount === 0
                    ? "Select at least one ready draft row before copying payload."
                    : "",
                  ready: "Copy the selected ready draft rows as a TCOS draft payload.",
                })}
                style={{
                  ...secondaryButtonStyle,
                  padding: "8px 10px",
                  borderColor: "#0f5132",
                  color: "#0f5132",
                  opacity: exportDraftPayloadDisabled ? 0.5 : 1,
                  cursor: exportDraftPayloadDisabled ? "not-allowed" : "pointer",
                }}
              >
                Copy Draft Payload ({selectedDraftReadyCount})
              </button>
            )}
            <button
              type="button"
              onClick={createSelectedReadyDraftListings}
              aria-disabled={createSelectedReadyDraftButtonDisabled}
              title={batchActionTitle({
                action: "creating selected ready draft listings",
                blocked: selectedDraftReadyCount === 0
                  ? "Select at least one ready draft row before creating drafts."
                  : "",
                ready: "Create TCOS draft listings for the selected ready rows.",
              })}
              style={{
                ...buttonStyle,
                padding: "8px 10px",
                background: createSelectedReadyDraftButtonDisabled
                  ? "#999"
                  : "#0f5132",
                borderColor: createSelectedReadyDraftButtonDisabled
                  ? "#999"
                  : "#0f5132",
                cursor: createSelectedReadyDraftButtonDisabled
                  ? "not-allowed"
                  : "pointer",
              }}
            >
              {batchDrafting
                ? "Creating Drafts..."
                : `Create Selected Ready Drafts (${selectedDraftReadyCount})`}
            </button>
            <button
              type="button"
              onClick={exportSelectedCleanDraftPayload}
              aria-disabled={exportCleanDraftPayloadDisabled}
              title={batchActionTitle({
                action: "exporting selected clean draft payload",
                blocked: selectedCleanReadyCount === 0
                  ? "Select at least one clean ready row before exporting payload."
                  : "",
                ready: "Export selected clean ready rows as a TCOS draft payload.",
              })}
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity: exportCleanDraftPayloadDisabled ? 0.5 : 1,
                cursor: exportCleanDraftPayloadDisabled
                  ? "not-allowed"
                  : "pointer",
              }}
            >
              Export Clean Payload ({selectedCleanReadyCount})
            </button>
            {testMode && (
              <button
                type="button"
                onClick={() => void copySelectedCleanDraftPayload()}
                aria-disabled={exportCleanDraftPayloadDisabled}
                title={batchActionTitle({
                  action: "copying selected clean draft payload",
                  blocked: selectedCleanReadyCount === 0
                    ? "Select at least one clean ready row before copying payload."
                    : "",
                  ready: "Copy selected clean ready rows as a TCOS draft payload.",
                })}
                style={{
                  ...secondaryButtonStyle,
                  padding: "8px 10px",
                  borderColor: "#0f5132",
                  color: "#0f5132",
                  opacity: exportCleanDraftPayloadDisabled ? 0.5 : 1,
                  cursor: exportCleanDraftPayloadDisabled
                    ? "not-allowed"
                    : "pointer",
                }}
              >
                Copy Clean Payload ({selectedCleanReadyCount})
              </button>
            )}
            <button
              type="button"
              onClick={createSelectedCleanDraftListings}
              aria-disabled={exportCleanDraftPayloadDisabled}
              title={batchActionTitle({
                action: "creating selected clean draft listings",
                blocked: selectedCleanReadyCount === 0
                  ? "Select at least one clean ready row before creating drafts."
                  : "",
                ready: "Create TCOS draft listings only for selected clean ready rows.",
              })}
              style={{
                ...buttonStyle,
                padding: "8px 10px",
                background: exportCleanDraftPayloadDisabled ? "#999" : "#0f5132",
                borderColor: exportCleanDraftPayloadDisabled ? "#999" : "#0f5132",
                cursor: exportCleanDraftPayloadDisabled
                  ? "not-allowed"
                  : "pointer",
              }}
            >
              {batchDrafting
                ? "Creating Drafts..."
                : `Create Selected Clean Drafts (${selectedCleanReadyCount})`}
            </button>
            <button
              type="button"
              onClick={clearSelectedDraftErrors}
              disabled={
                batchRunning || batchDrafting || selectedDraftErrorCount === 0
              }
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || selectedDraftErrorCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || selectedDraftErrorCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Clear Draft Errors ({selectedDraftErrorCount})
            </button>
            <button
              type="button"
              onClick={resetSelectedDraftEdits}
              disabled={
                batchRunning || batchDrafting || selectedDoneBatchCards.length === 0
              }
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning ||
                  batchDrafting ||
                  selectedDoneBatchCards.length === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning ||
                  batchDrafting ||
                  selectedDoneBatchCards.length === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Reset Selected Edits ({selectedDoneBatchCards.length})
            </button>
            {PRICE_BUTTONS.map((button) => (
              <button
                key={`selected-${button.label}`}
                type="button"
                onClick={() => applySelectedBatchPrice(button.multiplier)}
                disabled={
                  batchRunning ||
                  batchDrafting ||
                  selectedPriceableBatchCards.length === 0
                }
                style={{
                  ...secondaryButtonStyle,
                  padding: "8px 10px",
                  opacity:
                    batchRunning ||
                    batchDrafting ||
                    selectedPriceableBatchCards.length === 0
                      ? 0.5
                      : 1,
                  cursor:
                    batchRunning ||
                    batchDrafting ||
                    selectedPriceableBatchCards.length === 0
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                {button.label}
              </button>
            ))}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontWeight: 800,
              }}
            >
              Price
              <input
                type="number"
                min="0"
                step="0.01"
                value={selectedBatchFixedPrice}
                onChange={(event) =>
                  setSelectedBatchFixedPrice(event.target.value)
                }
                disabled={batchRunning || batchDrafting}
                style={{
                  width: 98,
                  border: "1px solid #ccc",
                  borderRadius: 8,
                  padding: "8px 10px",
                  fontWeight: 800,
                }}
              />
            </label>
            <button
              type="button"
              onClick={applySelectedBatchFixedPrice}
              disabled={
                batchRunning ||
                batchDrafting ||
                selectedDoneBatchCards.length === 0
              }
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning ||
                  batchDrafting ||
                  selectedDoneBatchCards.length === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning ||
                  batchDrafting ||
                  selectedDoneBatchCards.length === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Apply Price ({selectedDoneBatchCards.length})
            </button>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontWeight: 800,
              }}
            >
              Qty
              <input
                type="number"
                min="1"
                step="1"
                value={selectedBatchQuantity}
                onChange={(event) => setSelectedBatchQuantity(event.target.value)}
                disabled={batchRunning || batchDrafting}
                style={{
                  width: 82,
                  border: "1px solid #ccc",
                  borderRadius: 8,
                  padding: "8px 10px",
                  fontWeight: 800,
                }}
              />
            </label>
            <button
              type="button"
              onClick={applySelectedBatchQuantity}
              aria-disabled={
                batchRunning ||
                batchDrafting ||
                selectedDoneBatchCards.length === 0
              }
              title={
                batchBusyBlockedReason("applying selected quantities") ||
                (selectedDoneBatchCards.length === 0
                  ? "Select at least one draftable row before applying quantity."
                  : "Apply this quantity to the selected draftable rows.")
              }
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning ||
                  batchDrafting ||
                  selectedDoneBatchCards.length === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning ||
                  batchDrafting ||
                  selectedDoneBatchCards.length === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Apply Qty ({selectedDoneBatchCards.length})
            </button>
            <button
              type="button"
              onClick={() => void mergeSelectedBatchQuantityRows()}
              aria-disabled={selectedQuantityMergeDisabled}
              title={
                batchBusyBlockedReason("merging selected duplicate quantities") ||
                selectedQuantityMergeHelp
              }
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                borderColor: "#7c3aed",
                color: "#5b21b6",
                opacity:
                  selectedQuantityMergeDisabled
                    ? 0.5
                    : 1,
                cursor:
                  selectedQuantityMergeDisabled
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Merge Selected Qty ({selectedQuantityMergeCount})
            </button>
            {selectedQuantityMergeCount > 0 && (
              <small
                role="status"
                aria-live="polite"
                style={{
                  color: selectedQuantityMergePlan.ok ? "#5b21b6" : "#7c2d12",
                  fontWeight: 900,
                  maxWidth: 340,
                }}
              >
                {selectedQuantityMergeHelp}
              </small>
            )}
          </div>
        )}

        {batchCards.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={batchProgressPercent}
              style={{
                height: 12,
                overflow: "hidden",
                borderRadius: 999,
                background: "#eee",
              }}
            >
              <div
                style={{
                  width: `${batchProgressPercent}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: batchErrorCount ? "#b45309" : "#0f5132",
                  transition: "width 180ms ease",
                }}
              />
            </div>
            <small style={{ color: "#555", fontWeight: 800 }}>
              {batchProgressPercent}% complete - {batchDoneCount} done,{" "}
              {batchErrorCount} failed, {batchScanningCount} scanning
            </small>
          </div>
        )}

        {batchError && (
          <p
            role="alert"
            aria-live="assertive"
            style={{ color: "crimson", fontWeight: 700 }}
          >
            {batchError}
          </p>
        )}

        {batchDraftMessage && (
          <div
            role="status"
            aria-live="polite"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              alignItems: "center",
              color: "#0f5132",
              fontWeight: 800,
            }}
          >
            <span>{batchDraftMessage}</span>
            {batchCreatedInstaCompDraftHref ? (
              <a
                href={batchCreatedInstaCompDraftHref}
                style={{
                  ...secondaryButtonStyle,
                  padding: "8px 10px",
                  borderColor: "#0f5132",
                  color: "#0f5132",
                  textDecoration: "none",
                }}
              >
                Open InstaComp™ Drafts
              </a>
            ) : null}
          </div>
        )}

        {batchCards.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              alignItems: "center",
              marginTop: 14,
            }}
          >
            <strong>View Rows</strong>
            {batchFilterOptions.map((option) => {
              const active = option.filter === batchFilter;

              return (
                <button
                  key={option.filter}
                  type="button"
                  onClick={() => setBatchFilter(option.filter)}
                  style={{
                    ...secondaryButtonStyle,
                    padding: "8px 10px",
                    borderColor: active ? "#111" : "#bbb",
                    background: active ? "#111" : "white",
                    color: active ? "white" : "#111",
                  }}
                >
                  {BATCH_FILTER_LABELS[option.filter]} ({option.count})
                </button>
              );
            })}
            <button
              type="button"
              onClick={resetBatchView}
              disabled={batchViewIsReset}
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity: batchViewIsReset ? 0.5 : 1,
                cursor: batchViewIsReset ? "not-allowed" : "pointer",
              }}
            >
              Reset View
            </button>
            {testMode && (
              <button
                type="button"
                onClick={() => void copyTestModelCurrentViewSummary()}
                aria-disabled={
                  batchRunning || batchDrafting || visibleBatchCards.length === 0
                }
                style={{
                  ...secondaryButtonStyle,
                  padding: "8px 10px",
                  borderColor: "#111",
                  color: "#111",
                  opacity:
                    batchRunning ||
                    batchDrafting ||
                    visibleBatchCards.length === 0
                      ? 0.55
                      : 1,
                  cursor:
                    batchRunning ||
                    batchDrafting ||
                    visibleBatchCards.length === 0
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                Copy Current View Summary
              </button>
            )}
            {testMode && (
              <button
                type="button"
                onClick={() => void copyTestModelCurrentViewCsv()}
                aria-disabled={
                  batchRunning || batchDrafting || visibleBatchCards.length === 0
                }
                style={{
                  ...secondaryButtonStyle,
                  padding: "8px 10px",
                  borderColor: "#0f5132",
                  color: "#0f5132",
                  opacity:
                    batchRunning ||
                    batchDrafting ||
                    visibleBatchCards.length === 0
                      ? 0.55
                      : 1,
                  cursor:
                    batchRunning ||
                    batchDrafting ||
                    visibleBatchCards.length === 0
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                Copy Current View CSV
              </button>
            )}
            {testMode && (
              <button
                type="button"
                onClick={() => void copyTestModelCurrentViewJson()}
                aria-disabled={
                  batchRunning || batchDrafting || visibleBatchCards.length === 0
                }
                style={{
                  ...secondaryButtonStyle,
                  padding: "8px 10px",
                  borderColor: "#1d4ed8",
                  color: "#1d4ed8",
                  opacity:
                    batchRunning ||
                    batchDrafting ||
                    visibleBatchCards.length === 0
                      ? 0.55
                      : 1,
                  cursor:
                    batchRunning ||
                    batchDrafting ||
                    visibleBatchCards.length === 0
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                Copy Current View JSON
              </button>
            )}
            <button
              type="button"
              onClick={() => setVisibleDraftableBatchCardsSelected(true)}
              aria-disabled={batchRunning || batchDrafting || visibleDraftableCount === 0}
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || visibleDraftableCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleDraftableCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Select Visible ({visibleDraftableCount})
            </button>
            <button
              type="button"
              onClick={selectVisibleReadyBatchCards}
              aria-disabled={batchRunning || batchDrafting || visibleReadyCount === 0}
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || visibleReadyCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleReadyCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Select Visible Ready ({visibleReadyCount})
            </button>
            <button
              type="button"
              onClick={selectVisibleCleanBatchCards}
              aria-disabled={batchRunning || batchDrafting || visibleCleanCount === 0}
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || visibleCleanCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleCleanCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Select Visible Clean ({visibleCleanCount})
            </button>
            <button
              type="button"
              onClick={selectVisibleCleanReadyBatchCards}
              aria-disabled={
                batchRunning || batchDrafting || visibleCleanReadyCount === 0
              }
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || visibleCleanReadyCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleCleanReadyCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Select Visible Clean Ready ({visibleCleanReadyCount})
            </button>
            <button
              type="button"
              onClick={exportVisibleDraftPayload}
              aria-disabled={batchRunning || batchDrafting || visibleReadyCount === 0}
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || visibleReadyCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleReadyCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Export Visible Draft Payload ({visibleReadyCount})
            </button>
            {testMode && (
              <button
                type="button"
                onClick={() => void copyVisibleDraftPayload()}
                aria-disabled={
                  batchRunning || batchDrafting || visibleReadyCount === 0
                }
                style={{
                  ...secondaryButtonStyle,
                  padding: "8px 10px",
                  borderColor: "#0f5132",
                  color: "#0f5132",
                  opacity:
                    batchRunning || batchDrafting || visibleReadyCount === 0
                      ? 0.5
                      : 1,
                  cursor:
                    batchRunning || batchDrafting || visibleReadyCount === 0
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                Copy Visible Draft Payload ({visibleReadyCount})
              </button>
            )}
            <button
              type="button"
              onClick={createVisibleReadyDraftListings}
              aria-disabled={batchRunning || batchDrafting || visibleReadyCount === 0}
              style={{
                ...buttonStyle,
                padding: "8px 10px",
                background:
                  batchRunning || batchDrafting || visibleReadyCount === 0
                    ? "#999"
                    : "#0f5132",
                borderColor:
                  batchRunning || batchDrafting || visibleReadyCount === 0
                    ? "#999"
                    : "#0f5132",
                cursor:
                  batchRunning || batchDrafting || visibleReadyCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {batchDrafting
                ? "Creating Drafts..."
                : `Create Visible Ready Drafts (${visibleReadyCount})`}
            </button>
            <button
              type="button"
              onClick={exportVisibleCleanDraftPayload}
              aria-disabled={
                batchRunning || batchDrafting || visibleCleanReadyCount === 0
              }
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || visibleCleanReadyCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleCleanReadyCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Export Visible Clean Payload ({visibleCleanReadyCount})
            </button>
            {testMode && (
              <button
                type="button"
                onClick={() => void copyVisibleCleanDraftPayload()}
                aria-disabled={
                  batchRunning || batchDrafting || visibleCleanReadyCount === 0
                }
                style={{
                  ...secondaryButtonStyle,
                  padding: "8px 10px",
                  borderColor: "#0f5132",
                  color: "#0f5132",
                  opacity:
                    batchRunning || batchDrafting || visibleCleanReadyCount === 0
                      ? 0.5
                      : 1,
                  cursor:
                    batchRunning || batchDrafting || visibleCleanReadyCount === 0
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                Copy Visible Clean Payload ({visibleCleanReadyCount})
              </button>
            )}
            <button
              type="button"
              onClick={exportVisibleFixReport}
              aria-disabled={batchRunning || batchDrafting || visibleDraftFixCount === 0}
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || visibleDraftFixCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleDraftFixCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Export Visible Fix Report ({visibleDraftFixCount})
            </button>
            <button
              type="button"
              onClick={exportVisibleReviewReport}
              aria-disabled={batchRunning || batchDrafting || visibleReviewCount === 0}
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || visibleReviewCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleReviewCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Export Visible Review Report ({visibleReviewCount})
            </button>
            <button
              type="button"
              onClick={exportVisibleFailedReport}
              aria-disabled={batchRunning || batchDrafting || visibleFailedCount === 0}
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || visibleFailedCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleFailedCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Export Visible Failed Report ({visibleFailedCount})
            </button>
            <button
              type="button"
              onClick={createVisibleCleanDraftListings}
              aria-disabled={
                batchRunning || batchDrafting || visibleCleanReadyCount === 0
              }
              style={{
                ...buttonStyle,
                padding: "8px 10px",
                background:
                  batchRunning || batchDrafting || visibleCleanReadyCount === 0
                    ? "#999"
                    : "#0f5132",
                borderColor:
                  batchRunning || batchDrafting || visibleCleanReadyCount === 0
                    ? "#999"
                    : "#0f5132",
                cursor:
                  batchRunning || batchDrafting || visibleCleanReadyCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {batchDrafting
                ? "Creating Drafts..."
                : `Create Visible Clean Drafts (${visibleCleanReadyCount})`}
            </button>
            <button
              type="button"
              onClick={resetVisibleDraftEdits}
              aria-disabled={batchRunning || batchDrafting || visibleDraftableCount === 0}
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || visibleDraftableCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleDraftableCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Reset Visible Edits ({visibleDraftableCount})
            </button>
            <button
              type="button"
              onClick={() => setVisibleDraftableBatchCardsSelected(false)}
              aria-disabled={batchRunning || batchDrafting || visibleDraftableCount === 0}
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || visibleDraftableCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleDraftableCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Deselect Visible
            </button>
            <button
              type="button"
              onClick={deselectVisibleDraftFixBatchCards}
              aria-disabled={batchRunning || batchDrafting || visibleDraftFixCount === 0}
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || visibleDraftFixCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleDraftFixCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Deselect Visible Fix ({visibleDraftFixCount})
            </button>
            <button
              type="button"
              onClick={deselectVisibleReviewBatchCards}
              aria-disabled={batchRunning || batchDrafting || visibleReviewCount === 0}
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || visibleReviewCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleReviewCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Deselect Visible Review ({visibleReviewCount})
            </button>
            <button
              type="button"
              onClick={deselectVisibleReadyReviewBatchCards}
              aria-disabled={
                batchRunning || batchDrafting || visibleReadyReviewCount === 0
              }
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || visibleReadyReviewCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleReadyReviewCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Deselect Visible Ready Review ({visibleReadyReviewCount})
            </button>
            <button
              type="button"
              onClick={deselectVisibleReviewDraftFixBatchCards}
              aria-disabled={
                batchRunning || batchDrafting || visibleReviewDraftFixCount === 0
              }
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || visibleReviewDraftFixCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleReviewDraftFixCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Deselect Visible Review Fix ({visibleReviewDraftFixCount})
            </button>
            <button
              type="button"
              onClick={deselectVisibleCleanDraftFixBatchCards}
              aria-disabled={
                batchRunning || batchDrafting || visibleCleanDraftFixCount === 0
              }
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || visibleCleanDraftFixCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleCleanDraftFixCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Deselect Visible Clean Fix ({visibleCleanDraftFixCount})
            </button>
            <button
              type="button"
              onClick={clearVisibleDraftErrors}
              aria-disabled={batchRunning || batchDrafting || visibleDraftErrorCount === 0}
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || visibleDraftErrorCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleDraftErrorCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Clear Visible Draft Errors ({visibleDraftErrorCount})
            </button>
            <button
              type="button"
              onClick={() => void retryVisibleFailedBatchCards()}
              aria-disabled={batchRunning || batchDrafting || visibleFailedCount === 0}
              title={
                batchBusyBlockedReason("retrying visible failed rows") ||
                (visibleFailedCount === 0
                  ? "No visible failed rows are available to retry."
                  : "Retry every failed row visible in the current filter.")
              }
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity:
                  batchRunning || batchDrafting || visibleFailedCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleFailedCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Retry Visible Failed ({visibleFailedCount})
            </button>
            <button
              type="button"
              onClick={removeVisibleFailedBatchCards}
              aria-disabled={batchRunning || batchDrafting || visibleFailedCount === 0}
              title={
                batchBusyBlockedReason("removing visible failed rows") ||
                (visibleFailedCount === 0
                  ? "No visible failed rows are available to remove."
                  : "Remove every failed row visible in the current filter and cancel saved rows when present.")
              }
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                borderColor: "#d7b3b3",
                color: "#8a1f1f",
                opacity:
                  batchRunning || batchDrafting || visibleFailedCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleFailedCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Remove Visible Failed ({visibleFailedCount})
            </button>
            <button
              type="button"
              onClick={removeVisibleDraftedBatchCards}
              aria-disabled={batchRunning || batchDrafting || visibleDraftedCount === 0}
              title={
                batchBusyBlockedReason("removing visible drafted rows") ||
                (visibleDraftedCount === 0
                  ? "No visible drafted rows are available to remove."
                  : "Remove every drafted row visible in the current filter and cancel saved rows when present.")
              }
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                borderColor: "#d7b3b3",
                color: "#8a1f1f",
                opacity:
                  batchRunning || batchDrafting || visibleDraftedCount === 0
                    ? 0.5
                    : 1,
                cursor:
                  batchRunning || batchDrafting || visibleDraftedCount === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              Remove Visible Drafted ({visibleDraftedCount})
            </button>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                fontWeight: 800,
              }}
            >
              Sort
              <select
                value={batchSort}
                onChange={(event) =>
                  setBatchSort(event.target.value as BatchCardSort)
                }
                style={{
                  border: "1px solid #bbb",
                  borderRadius: 8,
                  padding: "8px 10px",
                  fontWeight: 800,
                  background: "white",
                }}
              >
                {(Object.keys(BATCH_SORT_LABELS) as BatchCardSort[]).map(
                  (sort) => (
                    <option key={sort} value={sort}>
                      {BATCH_SORT_LABELS[sort]}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                fontWeight: 800,
              }}
            >
              Search
              <input
                type="search"
                value={batchSearch}
                onChange={(event) => setBatchSearch(event.target.value)}
                placeholder="Title, file, SKU, player"
                style={{
                  minWidth: 240,
                  border: "1px solid #bbb",
                  borderRadius: 8,
                  padding: "8px 10px",
                  fontWeight: 800,
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => setBatchSearch("")}
              disabled={!batchSearch}
              style={{
                ...secondaryButtonStyle,
                padding: "8px 10px",
                opacity: batchSearch ? 1 : 0.5,
                cursor: batchSearch ? "pointer" : "not-allowed",
              }}
            >
              Clear Search
            </button>
            {visibleBatchCards.length !== batchCards.length && (
              <small style={{ color: "#555", fontWeight: 800 }}>
                Showing {visibleBatchCards.length} of {batchCards.length}
              </small>
            )}
          </div>
        )}

        {batchCards.length > 0 && (
          <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
            {visibleBatchCards.length === 0 && (
              <div
                style={{
                  border: "1px solid #eee",
                  borderRadius: 10,
                  padding: 14,
                  background: "#fafafa",
                  color: "#555",
                  fontWeight: 800,
                }}
              >
                No rows match this view.
              </div>
            )}

            {visibleBatchCards.map(({ card, index }) => (
              <BatchCardRow
                key={card.id}
                card={card}
                index={index}
                batchBusy={batchRunning || batchDrafting || batchKnowledgeSaving}
                batchDrafting={batchDrafting}
                activeAction={
                  activeBatchCardAction?.cardId === card.id
                    ? activeBatchCardAction.action
                    : null
                }
                isRemoving={removingBatchCardIds.has(card.id)}
                onApplyPrice={applyBatchPrice}
                onTitleChange={handleBatchTitleChange}
                onSerialChange={handleBatchSerialChange}
                onQuantityChange={handleBatchQuantityChange}
                onPriceChange={handleBatchPriceChange}
                onSelectedChange={toggleBatchCardSelected}
                onOperatorMarkedWrongChange={toggleBatchCardOperatorMarkedWrong}
                onOperatorNeedsMoreInfoChange={toggleBatchCardOperatorNeedsMoreInfo}
                onRotateImage={rotateBatchCardImage}
                onSwapImages={swapBatchCardImages}
                onBlockedAction={setBatchDraftMessage}
                onRefreshComps={refreshBatchCardComps}
                onSaveCorrections={saveBatchCardCorrections}
                onAddToTrade={addBatchCardToTrade}
                onRetry={retryBatchCard}
                onRemove={removeBatchCard}
                onCopySummary={
                  testMode ? copyTestModelBatchRowSummary : undefined
                }
                onCopyDraftPayload={
                  testMode ? copyTestModelBatchRowDraftPayload : undefined
                }
              />
            ))}
          </div>
        )}
      </section>

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: 12,
          padding: 20,
          background: "white",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Scan Card</h2>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
          }}
        >
          <div>
            <label style={{ fontWeight: 700 }}>Front Image *</label>
            <input
              type="file"
              accept="image/*"
              onChange={(event) =>
                handleFrontChange(event.target.files?.[0] || null)
              }
              style={{ display: "block", marginTop: 8 }}
            />

            {frontPreview && (
              <ImagePreviewWithRotation
                url={frontPreview}
                alt="Primary card image preview"
                disabled={loading}
                disabledReason="Wait for the current InstaComp™ scan to finish before rotating images."
                onUnavailable={(message) => setError(message)}
                onRotateLeft={() => void rotateSingleImage("front", "left")}
                onRotateRight={() => void rotateSingleImage("front", "right")}
              />
            )}
          </div>

          <div>
            <label style={{ fontWeight: 700 }}>Back Image optional</label>
            <input
              type="file"
              accept="image/*"
              onChange={(event) =>
                handleBackChange(event.target.files?.[0] || null)
              }
              style={{ display: "block", marginTop: 8 }}
            />

            {backPreview && (
              <ImagePreviewWithRotation
                url={backPreview}
                alt="Paired card image preview"
                disabled={loading}
                disabledReason="Wait for the current InstaComp™ scan to finish before rotating images."
                onUnavailable={(message) => setError(message)}
                onRotateLeft={() => void rotateSingleImage("back", "left")}
                onRotateRight={() => void rotateSingleImage("back", "right")}
              />
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={scanCard}
          aria-disabled={loading || !frontImage}
          style={{
            marginTop: 20,
            padding: "12px 18px",
            borderRadius: 8,
            border: "none",
            background: loading || !frontImage ? "#999" : "#111",
            color: "white",
            fontWeight: 800,
            cursor: loading || !frontImage ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "InstaComp™ is running..." : "Run InstaComp™ Scan"}
        </button>

        {error && (
          <p style={{ color: "crimson", fontWeight: 700, marginTop: 14 }}>
            {error}
          </p>
        )}
      </section>

      {result && (
        <>
          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 20,
              background: "white",
            }}
          >
            <h2 style={{ marginTop: 0 }}>InstaComp™ Result</h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              <Info label="Player" value={result.ai.player} />
              <Info label="Year" value={result.ai.year} />
              <Info label="Brand" value={result.ai.brand} />
              <Info label="Set" value={result.ai.setName} />
              <Info label="Card #" value={result.ai.cardNumber} />
              <Info label="Parallel" value={result.ai.parallel} />
              <Info label="Serial #" value={result.ai.serialNumber} />
              <Info label="Grader" value={result.ai.gradingCompany || null} />
              <Info label="Grade" value={result.ai.gradeValue || null} />
              <Info
                label="Cert #"
                value={result.ai.certificationNumber || null}
              />
              <Info label="Team" value={result.ai.team} />
              <Info label="Sport" value={result.ai.sport} />
              <Info label="Rookie" value={result.ai.isRookie ? "Yes" : "No"} />
              <Info label="Auto" value={result.ai.isAuto ? "Yes" : "No"} />
              <Info label="Relic" value={result.ai.isRelic ? "Yes" : "No"} />
              <Info
                label="Confidence"
                value={confidenceLabel(result.ai.confidence)}
              />
            </div>

            {result.ai.notes && (
              <p style={{ marginTop: 14 }}>
                <strong>AI Notes:</strong> {result.ai.notes}
              </p>
            )}

            {gradingSummary(result.ai) ? (
              <p style={{ marginTop: 10, color: "#555" }}>
                <strong>Grading:</strong> {gradingSummary(result.ai)}
                {resultCertificationLookupHref ? (
                  <>
                    {" "}
                    <a
                      href={resultCertificationLookupHref}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Verify cert
                    </a>
                  </>
                ) : null}
                {result.ai.gradingEvidence ? ` — ${result.ai.gradingEvidence}` : ""}
              </p>
            ) : null}

            <OcrDiagnosticsPanel result={result} />
            <ConsensusPanel result={result} />

            <div
              style={{
                marginTop: 18,
                padding: 14,
                borderRadius: 10,
                background: "#f6f6f6",
              }}
            >
              <strong>Search Query:</strong>
              <div style={{ marginTop: 6, fontFamily: "monospace" }}>
                {result.searchQuery}
              </div>
            </div>

            <ExternalSearchUsage result={result} />

            <TcosCardSearchActions
              query={tcosCardSearchQuery(result, frontImage?.name || "card")}
            />
          </section>

          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 20,
              background: "white",
            }}
          >
            <h2 style={{ marginTop: 0 }}>InstaComp™ Suggested Pricing</h2>

            <p style={{ marginTop: 0, color: "#555" }}>
              Current sold comps drive the suggested price first. Older dated
              sales stay visible as comp history, but they do not pull down
              today&apos;s InstaComp™ Suggested price.
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 12,
              }}
            >
              <PriceBox label="Comp Low" value={primaryCompStats(result).low} />
              <PriceBox
                label="Comp Median"
                value={primaryCompStats(result).median}
              />
              <PriceBox
                label="Comp Average"
                value={primaryCompStats(result).average}
              />
              <PriceBox
                label="Comp High"
                value={primaryCompStats(result).high}
              />
              <PriceBox
                label="InstaComp™ Suggested"
                value={primaryCompStats(result).suggestedPrice}
                strong
              />
            </div>

            <MarketPricingExplanation result={result} />

            <h3 style={{ margin: "18px 0 10px" }}>Market Guidance</h3>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 12,
              }}
            >
              <PriceBox label="Market Low" value={effectiveMarketStats(result).low} />
              <PriceBox
                label="Market Median"
                value={effectiveMarketStats(result).median}
              />
              <PriceBox
                label="Market Average"
                value={effectiveMarketStats(result).average}
              />
              <PriceBox label="Market High" value={effectiveMarketStats(result).high} />
              <PriceBox
                label="Market Suggested"
                value={effectiveMarketStats(result).suggestedPrice}
              />
            </div>

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                marginTop: 16,
              }}
            >
              <button
                type="button"
                onClick={() =>
                  copyPrice(
                    primaryCompStats(result).suggestedPrice,
                    "InstaComp™ Suggested price"
                  )
                }
                aria-disabled={!primaryCompStats(result).suggestedPrice}
                title={
                  primaryCompStats(result).suggestedPrice
                    ? "Copy the current InstaComp™ suggested price."
                    : "No InstaComp™ suggested price is available yet."
                }
                style={{
                  ...buttonStyle,
                  opacity: primaryCompStats(result).suggestedPrice ? 1 : 0.5,
                  cursor: primaryCompStats(result).suggestedPrice
                    ? "pointer"
                    : "not-allowed",
                }}
              >
                Copy InstaComp™ Suggested
              </button>

              <button
                type="button"
                onClick={() => copyPrice(marketPlus10, "Market +10%")}
                aria-disabled={!marketPlus10}
                title={
                  marketPlus10
                    ? "Copy market guidance plus 10%."
                    : "No Market +10% price is available yet."
                }
                style={{
                  ...buttonStyle,
                  opacity: marketPlus10 ? 1 : 0.5,
                  cursor: marketPlus10 ? "pointer" : "not-allowed",
                }}
              >
                Copy Market +10%
              </button>

              <button
                type="button"
                onClick={() => copyPrice(marketMinus10, "Market -10%")}
                aria-disabled={!marketMinus10}
                title={
                  marketMinus10
                    ? "Copy market guidance minus 10%."
                    : "No Market -10% price is available yet."
                }
                style={{
                  ...buttonStyle,
                  opacity: marketMinus10 ? 1 : 0.5,
                  cursor: marketMinus10 ? "pointer" : "not-allowed",
                }}
              >
                Copy Market -10%
              </button>
            </div>

            {copiedPrice && (
              <p style={{ color: "green", fontWeight: 700 }}>
                Copied {copiedPrice}
              </p>
            )}
          </section>

          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 20,
              background: "white",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Comp Source Coverage</h2>

            <p style={{ marginTop: 0, color: "#555" }}>
              InstaComp™ tracks these sources for market value, sold value, and
              remaining-card coverage. Only included sources affect pricing.
            </p>

            <SourceCoverage sources={result.sourceCoverage} />
          </section>

          <section
            style={{
              border: "1px solid #ddd",
              borderRadius: 12,
              padding: 20,
              background: "white",
            }}
          >
            <h2 style={{ marginTop: 0 }}>Comps and Price Guidance</h2>

            {!visibleMarketplaceMatches(result).length ? (
              <p>No live comps or guidance matches returned yet.</p>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {visibleMarketplaceMatches(result).map((comp, index) => (
                  <a
                    key={`${comp.url}-${index}`}
                    href={comp.url}
                    target="_blank"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "72px 1fr auto",
                      gap: 12,
                      alignItems: "center",
                      border: "1px solid #eee",
                      borderRadius: 10,
                      padding: 10,
                      color: "inherit",
                      textDecoration: "none",
                    }}
                  >
                    {comp.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={comp.imageUrl}
                        alt=""
                        style={{
                          width: 72,
                          height: 72,
                          objectFit: "contain",
                          background: "#fafafa",
                          borderRadius: 8,
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 72,
                          height: 72,
                          background: "#eee",
                          borderRadius: 8,
                        }}
                      />
                    )}

                    <div>
                      <div style={{ fontWeight: 700 }}>{comp.title}</div>
                      <small style={{ color: "#666" }}>
                        {comp.sourceLabel || comp.source} Â·{" "}
                        {sourceCategoryLabels[comp.sourceCategory]} Â· Match{" "}
                        {comp.matchScore}
                        {comp.flags?.includes("guidance comp")
                          ? comp.sourceCategory === "reference"
                            ? " - guidance only"
                            : " - pricing guidance"
                          : ""}
                        {compGuidanceLabel(comp)
                          ? ` - ${compGuidanceLabel(comp)}`
                          : ""}
                      </small>
                    </div>

                    <strong>{money(comp.price)}</strong>
                  </a>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: any }) {
  return (
    <div
      style={{
        border: "1px solid #eee",
        borderRadius: 10,
        padding: 12,
        background: "#fafafa",
      }}
    >
      <div style={{ color: "#666", fontSize: 12, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontWeight: 800 }}>{value || "—"}</div>
    </div>
  );
}

function ConsensusMini({ result }: { result: ScanResponse | null }) {
  const consensus = result?.consensus;

  if (!consensus) return null;

  const confirmed = consensus.status === "consensus_confirmed";
  const readiness = consensus.councilReadiness;
  const readinessLabel =
    readiness?.status === "review_required"
      ? "council incomplete"
      : readiness?.status === "warning"
        ? "thin council"
        : readiness?.status === "ready"
          ? "council ready"
          : null;

  return (
    <div
      style={{
        marginTop: 6,
        color: confirmed ? "#0f5132" : "#7a4f00",
        fontSize: 12,
        fontWeight: 900,
      }}
    >
      Consensus: {confirmed ? "confirmed" : "needs review"} -{" "}
      {consensus.readerSummaries.length} reader
      {consensus.readerSummaries.length === 1 ? "" : "s"}
      {readinessLabel ? ` - ${readinessLabel}` : ""}
      {consensus.reasonTrail[0] ? ` - ${consensus.reasonTrail[0]}` : ""}
    </div>
  );
}

function ConsensusPanel({ result }: { result: ScanResponse }) {
  const consensus = result.consensus;

  if (!consensus) return null;

  const confirmed = consensus.status === "consensus_confirmed";
  const readiness = consensus.councilReadiness;
  const catalogEvidence = result.catalogEvidence || null;
  const topDecisions = consensus.fieldDecisions.slice(0, 8);

  return (
    <div
      style={{
        marginTop: 14,
        padding: 14,
        borderRadius: 10,
        border: confirmed ? "1px solid #9bd6ac" : "1px solid #e7c979",
        background: confirmed ? "#f0fff4" : "#fffaf0",
      }}
    >
      <h3 style={{ margin: "0 0 10px" }}>
        InstaComp™ Multi-Scanner Consensus
      </h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 10,
        }}
      >
        <Info label="Status" value={confirmed ? "Confirmed" : "Needs Review"} />
        <Info
          label="Readers"
          value={String(consensus.readerSummaries.length)}
        />
        <Info
          label="Catalog Referee"
          value={
            consensus.catalogReferee.sourceLabel ||
            consensus.catalogReferee.status.replaceAll("_", " ")
          }
        />
        <Info
          label="Trusted Identity"
          value={consensus.trustedForIdentity ? "Yes" : "No"}
        />
        {readiness && (
          <>
            <Info
              label="Council Verdict"
              value={readiness.status.replaceAll("_", " ")}
            />
            <Info
              label="Council Voices"
              value={String(readiness.independentReaderCount)}
            />
          </>
        )}
        {catalogEvidence && (
          <>
            <Info
              label="Catalog Status"
              value={catalogEvidence.status.replaceAll("_", " ")}
            />
            <Info
              label="Catalog Match"
              value={
                catalogEvidence.selectedMatch
                  ? `${catalogEvidence.selectedMatch.catalogId} (${catalogEvidence.selectedMatch.score})`
                  : "Needs review"
              }
            />
          </>
        )}
      </div>
      {catalogEvidence && (
        <p
          style={{
            margin: "10px 0 0",
            color: catalogEvidence.catalogConfirmed ? "#0f5132" : "#7a4f00",
            fontWeight: 900,
          }}
        >
          Catalog: {catalogEvidence.operatorAction}
          {catalogEvidence.reviewReasons.length > 0
            ? ` Review: ${catalogEvidence.reviewReasons.join("; ")}.`
            : ""}
        </p>
      )}
      {readiness && readiness.status !== "ready" && (
        <p style={{ margin: "10px 0 0", color: "#7a4f00", fontWeight: 900 }}>
          Council: {readiness.explanation}
          {readiness.missingReaderKinds.length > 0
            ? ` Missing: ${readiness.missingReaderKinds.join(", ")}.`
            : ""}
        </p>
      )}
      {consensus.suggestedQuestion && (
        <p style={{ margin: "10px 0 0", color: "#7a4f00", fontWeight: 900 }}>
          Question: {consensus.suggestedQuestion}
        </p>
      )}
      {consensus.reviewReasons.length > 0 && (
        <p style={{ margin: "10px 0 0", color: "#7a4f00", fontWeight: 800 }}>
          Review: {consensus.reviewReasons.map(queueReviewReasonLabel).join("; ")}
        </p>
      )}
      {topDecisions.length > 0 && (
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
          {topDecisions.map((decision) => (
            <div
              key={`${decision.field}-${String(decision.value)}`}
              style={{
                padding: "8px 10px",
                border: "1px solid #e5e5e5",
                borderRadius: 8,
                background: "white",
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              <strong>{decision.field}:</strong>{" "}
              {String(decision.value ?? "—")} — {decision.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExternalSearchUsage({ result }: { result: ScanResponse }) {
  const diagnostics = externalSearchDiagnostics(result);

  if (!diagnostics) return null;

  return (
    <div
      style={{
        marginTop: 14,
        padding: 14,
        borderRadius: 10,
        border: "1px solid #e5e5e5",
        background: diagnostics.paidSearchUsed ? "#fff7ed" : "#f0fff4",
      }}
    >
      <h3 style={{ margin: "0 0 10px" }}>External Search Usage</h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
        }}
      >
        <Info label="Provider" value={diagnostics.providerLabel || "None"} />
        <Info label="Cache" value={externalSearchCacheLabel(diagnostics)} />
        <Info label="Request" value={externalSearchRequestLabel(diagnostics)} />
        <Info
          label="Search Items"
          value={`${diagnostics.returnedSearchItems}/${diagnostics.requestedLimit}`}
        />
        <Info label="Included" value={String(diagnostics.includedCompCount)} />
        <Info
          label="Registered"
          value={String(diagnostics.registeredSourceCount)}
        />
        <Info
          label="Cache Hits"
          value={
            diagnostics.cacheHitCountBeforeScan === null
              ? "Not set"
              : String(diagnostics.cacheHitCountBeforeScan)
          }
        />
        <Info
          label="Expires"
          value={shortDateTime(diagnostics.cacheExpiresAt)}
        />
      </div>
    </div>
  );
}

function ExternalSearchMini({ result }: { result: ScanResponse | null }) {
  const diagnostics = externalSearchDiagnostics(result);

  if (!diagnostics) return null;

  return (
    <div style={{ marginTop: 6, color: "#555", fontSize: 12, fontWeight: 800 }}>
      External search: {diagnostics.providerLabel || "None"} -{" "}
      {externalSearchCacheLabel(diagnostics)} -{" "}
      {externalSearchRequestLabel(diagnostics)} - {diagnostics.includedCompCount}{" "}
      included
    </div>
  );
}

function OcrDiagnosticsPanel({ result }: { result: ScanResponse }) {
  const diagnostics = result.ocrDiagnostics;

  if (!diagnostics) return null;

  const providerConfigured =
    diagnostics.paddleOcrConfigured || diagnostics.googleVisionConfigured;
  const active = providerConfigured && diagnostics.provider;
  const serialVisionSerial =
    diagnostics.serialVisionSerialNumber || result.ai.serialNumber || null;
  const serialVisionImages = diagnostics.serialVisionCheckedImages || 0;

  return (
    <div
      style={{
        marginTop: 14,
        padding: 14,
        borderRadius: 10,
        border: active ? "1px solid #9bd6ac" : "1px solid #e3a2a2",
        background: active ? "#f0fff4" : "#fff5f5",
      }}
    >
      <h3 style={{ margin: "0 0 10px" }}>OCR Diagnostics</h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 10,
        }}
      >
        <Info
          label="PaddleOCR"
          value={
            diagnostics.paddleOcrConfigured ? "Configured" : "Missing service"
          }
        />
        <Info
          label="Google fallback"
          value={diagnostics.googleVisionConfigured ? "Configured" : "Missing key"}
        />
        <Info label="Provider" value={diagnostics.provider || "None"} />
        <Info label="Images OCR'd" value={String(diagnostics.checkedImages || 0)} />
        <Info
          label="Speed lane"
          value={
            diagnostics.speedLane === "escalated_multi_ai"
              ? `Escalated multi-AI${
                  diagnostics.secondaryVisionReasons?.length
                    ? `: ${diagnostics.secondaryVisionReasons.slice(0, 2).join(", ")}`
                    : ""
                }`
              : diagnostics.speedLane === "fast_lane"
                ? "Fast lane"
                : "Not reported"
          }
        />
        <Info
          label="Council mode"
          value={
            diagnostics.councilMode === "full_council"
              ? `Full council${diagnostics.consensusRiskTier ? ` - ${diagnostics.consensusRiskTier} risk` : ""}`
              : diagnostics.councilMode === "fast_lane_council"
                ? `Fast council${diagnostics.consensusRiskTier ? ` - ${diagnostics.consensusRiskTier} risk` : ""}`
                : diagnostics.consensusRiskTier
                  ? `${diagnostics.consensusRiskTier} risk`
                  : "Not reported"
          }
        />
        <Info
          label="AI witnesses"
          value={
            diagnostics.aiCouncil
              ? `${diagnostics.aiCouncil.completedReaders}/${diagnostics.aiCouncil.desiredReaders} extra + primary - ${diagnostics.aiCouncil.tier}`
              : diagnostics.secondaryVisionRan
                ? "Secondary ran"
                : "None"
          }
        />
        <Info
          label="OCR Serial"
          value={diagnostics.extractedSerialNumber || "None found"}
        />
        <Info
          label="Vision Serial"
          value={
            serialVisionSerial
              ? `${serialVisionSerial}${
                  serialVisionImages ? ` (${serialVisionImages} checked)` : ""
                }`
              : diagnostics.serialVisionSkipped
                ? `Skipped (${diagnostics.serialVisionMode || "adaptive"})`
              : "None found"
          }
        />
        <Info
          label="Grading"
          value={
            gradingSummary({
              ...result.ai,
              gradingCompany:
                diagnostics.gradingCompany || result.ai.gradingCompany,
              gradeValue: diagnostics.gradeValue || result.ai.gradeValue,
              certificationNumber:
                diagnostics.certificationNumber ||
                result.ai.certificationNumber,
            }) || "None detected"
          }
        />
      </div>
      {!providerConfigured && (
        <p style={{ margin: "10px 0 0", color: "#8a1f1f", fontWeight: 900 }}>
          Real OCR is not active. Add PADDLEOCR_API_URL, or add
          GOOGLE_VISION_API_KEY / GOOGLE_CLOUD_VISION_API_KEY as fallback, then
          restart the dev server.
        </p>
      )}
      {providerConfigured && !diagnostics.provider && (
        <p style={{ margin: "10px 0 0", color: "#7a4f00", fontWeight: 900 }}>
          Paddle/Google OCR did not return usable text for this saved scan.
          Serial vision is tracked separately above.
        </p>
      )}
      {diagnostics.serialVisionEvidence && (
        <p style={{ margin: "10px 0 0", color: "#555", fontWeight: 800 }}>
          Serial evidence: {diagnostics.serialVisionEvidence}
        </p>
      )}
      {diagnostics.gradingEvidence && (
        <p style={{ margin: "10px 0 0", color: "#555", fontWeight: 800 }}>
          Grading evidence: {diagnostics.gradingEvidence}
        </p>
      )}
      {diagnostics.scannerPlan?.length ? (
        <p style={{ margin: "10px 0 0", color: "#555", fontWeight: 800 }}>
          Scanner plan: {diagnostics.scannerPlan.join(" → ").replaceAll("_", " ")}
        </p>
      ) : null}
      {diagnostics.aiCouncil?.attempts?.length ? (
        <div style={{ marginTop: 10, color: "#555", fontWeight: 800 }}>
          AI council:{" "}
          {diagnostics.aiCouncil.attempts
            .map((attempt) => {
              const timing =
                typeof attempt.durationMs === "number"
                  ? `/${Math.round(attempt.durationMs / 100) / 10}s`
                  : "";

              return `${attempt.label} ${attempt.status}${timing}`;
            })
            .join(" | ")}
        </div>
      ) : null}
      {diagnostics.textExcerpt && (
        <pre
          style={{
            margin: "12px 0 0",
            whiteSpace: "pre-wrap",
            fontSize: 12,
            lineHeight: 1.45,
            maxHeight: 180,
            overflow: "auto",
            background: "white",
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: 10,
          }}
        >
          {diagnostics.textExcerpt}
        </pre>
      )}
    </div>
  );
}

function OcrDiagnosticsMini({ result }: { result: ScanResponse | null }) {
  const diagnostics = result?.ocrDiagnostics;

  if (!diagnostics) {
    if (result?.ai.serialNumber) {
      return (
        <div style={{ marginTop: 6, color: "#0f5132", fontSize: 12, fontWeight: 900 }}>
          Serial vision: found {result.ai.serialNumber}
        </div>
      );
    }

    return null;
  }

  const providerConfigured =
    diagnostics.paddleOcrConfigured || diagnostics.googleVisionConfigured;
  const serialVisionSerial =
    diagnostics.serialVisionSerialNumber || result?.ai.serialNumber || null;
  const speedLaneLabel =
    diagnostics.speedLane === "escalated_multi_ai"
      ? " - escalated multi-AI"
      : diagnostics.speedLane === "fast_lane"
        ? " - fast lane"
        : "";
  const councilLabel =
    diagnostics.councilMode === "full_council"
      ? ` - full council${diagnostics.consensusRiskTier ? `/${diagnostics.consensusRiskTier}` : ""}`
      : diagnostics.councilMode === "fast_lane_council"
        ? ` - fast council${diagnostics.consensusRiskTier ? `/${diagnostics.consensusRiskTier}` : ""}`
        : "";
  const aiCouncilLabel = diagnostics.aiCouncil
    ? ` - AI +${diagnostics.aiCouncil.completedReaders}/${diagnostics.aiCouncil.desiredReaders}`
    : "";
  const serialVisionLabel = serialVisionSerial
    ? `found ${serialVisionSerial}`
    : diagnostics.serialVisionSkipped
      ? `skipped ${diagnostics.serialVisionMode || "adaptive"}`
      : "did not find a serial";

  if (!providerConfigured) {
    return (
      <div style={{ marginTop: 6, color: "#8a1f1f", fontSize: 12, fontWeight: 900 }}>
        OCR: PaddleOCR/Google not configured - serial vision{" "}
        {serialVisionLabel}
        {speedLaneLabel}
        {councilLabel}
        {aiCouncilLabel}
      </div>
    );
  }

  if (!diagnostics.provider) {
    return (
      <div style={{ marginTop: 6, color: "#7a4f00", fontSize: 12, fontWeight: 900 }}>
        OCR: no Paddle/Google text - serial vision{" "}
        {serialVisionLabel}
        {speedLaneLabel}
        {councilLabel}
        {aiCouncilLabel}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 6, color: "#0f5132", fontSize: 12, fontWeight: 900 }}>
      OCR: {diagnostics.provider || "none"} - {diagnostics.checkedImages || 0} image
      {diagnostics.checkedImages === 1 ? "" : "s"} - serial{" "}
      {diagnostics.extractedSerialNumber || serialVisionSerial || "not found"}
      {!diagnostics.extractedSerialNumber && serialVisionSerial
        ? " by vision"
        : ""}
      {speedLaneLabel}
      {councilLabel}
      {aiCouncilLabel}
    </div>
  );
}

function MarketPricingExplanation({ result }: { result: ScanResponse }) {
  const explanation = marketPricingExplanation(result);
  const topComps = explanation.marketComps.slice(0, 5);

  return (
    <div
      style={{
        marginTop: 14,
        border: "1px solid #e5e5e5",
        borderRadius: 10,
        padding: 14,
        background: explanation.marketComps.length ? "#f6fffa" : "#fffaf0",
      }}
    >
      <div style={{ fontWeight: 900 }}>
        Price basis: {explanation.basis}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          gap: 8,
          marginTop: 10,
        }}
      >
        <Info label="Priced comps" value={String(explanation.marketComps.length)} />
        <Info label="Current sold" value={String(explanation.currentSoldComps.length)} />
        <Info label="Historical" value={String(explanation.historicalSoldComps.length)} />
        <Info label="Active listings" value={String(explanation.activeComps.length)} />
        <Info label="Adjusted runs" value={String(explanation.adjustedComps.length)} />
      </div>

      {!topComps.length ? (
        <p style={{ margin: "10px 0 0", color: "#7a4f00", fontWeight: 800 }}>
          No active, sold, or serial-adjusted comps were usable for comp price.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {topComps.map((comp, index) => (
            <a
              key={`${comp.url}-${index}`}
              href={comp.url}
              target="_blank"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 10,
                alignItems: "center",
                border: "1px solid #eee",
                borderRadius: 8,
                padding: 10,
                color: "inherit",
                textDecoration: "none",
                background: "white",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800 }}>{comp.title}</div>
                <small style={{ color: "#666" }}>
                  {comp.sourceLabel || comp.source} - {compPriceBasisLabel(comp)}
                  {compGuidanceLabel(comp) ? ` - ${compGuidanceLabel(comp)}` : ""}
                  {compFreshnessLabel(comp) ? ` - ${compFreshnessLabel(comp)}` : ""}
                </small>
              </div>
              <strong>{money(comp.price)}</strong>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function PriceBox({
  label,
  value,
  strong,
}: {
  label: string;
  value: number | null;
  strong?: boolean;
}) {
  return (
    <div
      style={{
        border: strong ? "2px solid #111" : "1px solid #eee",
        borderRadius: 10,
        padding: 14,
        background: strong ? "#f2f2f2" : "#fafafa",
      }}
    >
      <div style={{ color: "#666", fontSize: 12, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontWeight: 900, fontSize: strong ? 24 : 20 }}>
        {money(value)}
      </div>
    </div>
  );
}

function TcosCardSearchActions({
  query,
  compact = false,
}: {
  query: string;
  compact?: boolean;
}) {
  const cleanQuery = query.trim();

  if (!cleanQuery) return null;

  return (
    <div
      style={{
        marginTop: compact ? 10 : 14,
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
      }}
    >
      {!compact ? (
        <div
          style={{
            flexBasis: "100%",
            color: "#555",
            fontSize: 12,
            fontWeight: 900,
            textTransform: "uppercase",
            letterSpacing: 0.4,
          }}
        >
          Search this card on TCOS
        </div>
      ) : null}

      <a
        href={tcosBuySearchHref(cleanQuery)}
        style={{
          ...secondaryButtonStyle,
          padding: compact ? "7px 9px" : "9px 12px",
          borderColor: "#0f5132",
          color: "#0f5132",
          textDecoration: "none",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        Buy Me on TCOS
      </a>

      <a
        href={tcosTradeSearchHref(cleanQuery)}
        style={{
          ...secondaryButtonStyle,
          padding: compact ? "7px 9px" : "9px 12px",
          borderColor: "#1d4ed8",
          color: "#1d4ed8",
          textDecoration: "none",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        Trade For Me on TCOS
      </a>
    </div>
  );
}

function BatchCardRow({
  activeAction,
  card,
  index,
  batchBusy,
  batchDrafting,
  isRemoving,
  onApplyPrice,
  onTitleChange,
  onSerialChange,
  onQuantityChange,
  onPriceChange,
  onSelectedChange,
  onOperatorMarkedWrongChange,
  onOperatorNeedsMoreInfoChange,
  onRotateImage,
  onSwapImages,
  onBlockedAction,
  onRefreshComps,
  onSaveCorrections,
  onAddToTrade,
  onRetry,
  onRemove,
  onCopySummary,
  onCopyDraftPayload,
}: {
  activeAction: InstaCompBatchRowAction;
  card: BatchCard;
  index: number;
  batchBusy: boolean;
  batchDrafting: boolean;
  isRemoving: boolean;
  onApplyPrice: (cardId: string, multiplier: number) => void;
  onTitleChange: (cardId: string, value: string) => void;
  onSerialChange: (cardId: string, value: string) => void;
  onQuantityChange: (cardId: string, value: string) => void;
  onPriceChange: (cardId: string, value: string) => void;
  onSelectedChange: (cardId: string, selected: boolean) => void;
  onOperatorMarkedWrongChange: (
    cardId: string,
    operatorMarkedWrong: boolean
  ) => void;
  onOperatorNeedsMoreInfoChange: (
    cardId: string,
    operatorNeedsMoreInfo: boolean
  ) => void;
  onRotateImage: (
    cardId: string,
    side: "primary" | "paired",
    direction: "left" | "right"
  ) => void | Promise<void>;
  onSwapImages: (cardId: string) => void;
  onBlockedAction: (message: string) => void;
  onRefreshComps: (cardId: string) => void | Promise<void>;
  onSaveCorrections: (cardId: string) => void | Promise<void>;
  onAddToTrade: (cardId: string) => void | Promise<void>;
  onRetry: (cardId: string) => void;
  onRemove: (cardId: string) => void | Promise<void>;
  onCopySummary?: (card: BatchCard, index: number) => void | Promise<void>;
  onCopyDraftPayload?: (card: BatchCard, index: number) => void | Promise<void>;
}) {
  const [showUsableComps, setShowUsableComps] = useState(false);
  const title = draftTitleForCard(card);
  const aiTitle = cardResultTitle(card.result, card.file.name);
  const serialNumber = card.result?.ai.serialNumber || null;
  const grading = gradingSummary(card.result?.ai);
  const gradingHref = certificationLookupHref(card.result?.ai);
  const confidence = card.result
    ? confidenceLabel(card.result.ai.confidence)
    : "Pending";
  const reviewWarnings = batchCardReviewWarnings(card);
  const draftErrors = isDraftableBatchCard(card) ? draftReadinessErrors(card) : [];
  const missingPriceDraftError = draftErrors.includes("Missing positive listing price");
  const marketPrice = marketPriceForCard(card);
  const compPrice = primaryCompPriceForCard(card);
  const compStats = primaryCompStats(card.result);
  const compBasis = compPriceBasisForResult(card.result);
  const pricingComps = primaryCompComps(card.result);
  const evidenceComps = primaryCompEvidenceComps(card.result);
  const pricingCompCount = pricingComps.length;
  const evidenceCompCount = evidenceComps.length;
  const historicalCompCount = evidenceComps.filter(isHistoricalSoldComp).length;
  const compRange =
    compStats.low && compStats.high && compStats.low !== compStats.high
      ? `${money(compStats.low)}-${money(compStats.high)}`
      : null;
  const draftPrice = draftPriceHandoffForCard(card);
  const priceButtonsDisabled = !compPrice || card.status !== "done";
  const displayReviewWarnings = reviewWarnings.filter(
    (warning) => !(warning === "No listing price" && missingPriceDraftError)
  );
  const draftHref = sellerInventoryInstaCompDraftHref(card.draftSku || title);
  const tcosSearchQuery = tcosCardSearchQuery(card.result, title);
  const canSelectForDraft = isDraftableBatchCard(card);
  const canSelectRow = canSelectForDraft || (card.status === "done" && Boolean(card.result));
  const canCopyDraftPayload = Boolean(onCopyDraftPayload) && canSelectForDraft;
  const copyDraftPayloadBlockedReason =
    "Draft payload copy is available after the row has a complete, draftable scan result.";
  const retryBlockedReason = batchBusy
    ? "Finish the current InstaComp™ batch action before retrying this row."
    : card.status === "error" || card.status === "done"
      ? null
      : "Retry becomes available after this row finishes scanning or errors.";
  const canRetry =
    (card.status === "error" || card.status === "done") && !batchBusy;
  const removeBlockedReason = instaCompBatchRowRemovalBlockedReason({
    batchDrafting,
    draftStatus: card.draftStatus,
    isRemoving,
  });
  const canRemove = !removeBlockedReason;
  const canRotate =
    !batchBusy && card.draftStatus === "idle" && card.tradeStatus === "idle";
  const canRotatePrimary = canRotate && card.file.size > 0;
  const canRotatePaired = canRotate && Boolean(card.backFile?.size);
  const canSwapImages =
    canRotate &&
    Boolean(card.backFile) &&
    card.file.size > 0 &&
    Boolean(card.backFile?.size);
  const rotateBlockedReason = batchBusy
    ? "Finish the current InstaComp™ batch action before rotating images."
    : card.draftStatus !== "idle"
      ? "Image rotation is locked after draft creation starts."
      : card.tradeStatus !== "idle"
        ? "Image rotation is locked after trade handoff starts."
        : "";
  const primaryRotateBlockedReason = canRotatePrimary
    ? ""
    : rotateBlockedReason || "Primary image is not available to rotate.";
  const pairedRotateBlockedReason = canRotatePaired
    ? ""
    : rotateBlockedReason || "Back image is not available to rotate.";
  const swapBlockedReason = canSwapImages
    ? ""
    : rotateBlockedReason ||
      (!card.backFile
        ? "Add a back image before swapping front/back."
        : "Both front and back image files must be available before swapping.");
  const priceButtonBlockedReason = !compPrice
    ? "No comp-based price is available yet. Refresh comps or enter a listing price manually."
    : card.status !== "done"
      ? "Price shortcuts unlock after this row finishes scanning."
      : "";
  const canSaveCorrections = !batchBusy && isCorrectionSavableBatchCard(card);
  const canRefreshComps = canSaveCorrections;
  const saveCorrectionsBlockedReason = batchBusy
    ? "Finish the current InstaComp™ batch action before saving corrections."
    : "Run Batch InstaComp™ first so this row has a saved lot record, then save corrections.";
  const refreshCompsBlockedReason = batchBusy
    ? "Finish the current InstaComp™ batch action before refreshing comps."
    : "Run Batch InstaComp™ first so this row has a saved lot record, then refresh comps.";
  const savingCorrections = activeAction === "saving_corrections";
  const refreshingComps = activeAction === "refreshing_comps";
  const saveCorrectionsLabel = instaCompBatchRowActionLabel({
    action: savingCorrections ? activeAction : null,
    fallback: "Save Corrections",
  });
  const refreshCompsLabel = instaCompBatchRowActionLabel({
    action: refreshingComps ? activeAction : null,
    fallback: "Refresh Comps",
  });
  const canAddToTrade =
    !batchBusy &&
    card.status === "done" &&
    Boolean(card.result) &&
    card.draftStatus !== "created" &&
    card.draftStatus !== "drafting" &&
    card.tradeStatus !== "created" &&
    card.tradeStatus !== "adding";
  const addToTradeBlockedReason = batchBusy
    ? "Finish the current InstaComp™ batch action before adding this row to trade."
    : card.status !== "done" || !card.result
      ? "Finish the scan before adding this card to trade."
      : card.draftStatus === "created"
        ? "This card already has a sell draft, so it cannot also be trade inventory."
        : card.tradeStatus === "created"
          ? "This card is already Available for Trade."
          : card.tradeStatus === "adding"
            ? "This card is already being added to Available for Trade."
            : "This row is not ready for trade inventory.";
  const rowBorder = draftErrors.length
    ? "1px solid #e3a2a2"
    : reviewWarnings.length
      ? "1px solid #e7c979"
      : "1px solid #eee";
  const rowBackground =
    card.status === "error"
      ? "#fff5f5"
      : draftErrors.length
        ? "#fff7f7"
        : reviewWarnings.length
          ? "#fffaf0"
          : "#fafafa";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(96px, 208px) minmax(0, 1fr)",
        gap: 12,
        alignItems: "start",
        border: rowBorder,
        borderRadius: 10,
        padding: 12,
        background: rowBackground,
      }}
    >
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Thumbnail
          url={card.previewUrl}
          canRotate={canRotatePrimary}
          rotateBlockedReason={primaryRotateBlockedReason}
          onUnavailable={onBlockedAction}
          onRotateLeft={() => void onRotateImage(card.id, "primary", "left")}
          onRotateRight={() => void onRotateImage(card.id, "primary", "right")}
        />
        {card.backPreviewUrl ? (
          <Thumbnail
            url={card.backPreviewUrl}
            canRotate={canRotatePaired}
            rotateBlockedReason={pairedRotateBlockedReason}
            onUnavailable={onBlockedAction}
            onRotateLeft={() => void onRotateImage(card.id, "paired", "left")}
            onRotateRight={() => void onRotateImage(card.id, "paired", "right")}
          />
        ) : null}
        {card.backPreviewUrl ? (
          <button
            type="button"
            onClick={() => {
              if (!canSwapImages) {
                onBlockedAction(swapBlockedReason);
                return;
              }

              onSwapImages(card.id);
            }}
            aria-disabled={!canSwapImages}
            title={
              canSwapImages
                ? "Swap front and back images, then Retry Row to rescan the corrected pair."
                : swapBlockedReason
            }
            style={{
              ...secondaryButtonStyle,
              alignSelf: "end",
              padding: "7px 9px",
              borderColor: "#1d4ed8",
              color: "#1d4ed8",
              opacity: canSwapImages ? 1 : 0.5,
              cursor: canSwapImages ? "pointer" : "not-allowed",
            }}
          >
            Swap Front/Back
          </button>
        ) : null}
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ color: "#666", fontSize: 12, fontWeight: 800 }}>
              Card #{index + 1} - {card.status.toUpperCase()}
            </div>
            <label
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                marginTop: 4,
              }}
            >
              <input
                type="checkbox"
                checked={card.selected && canSelectRow}
                disabled={!canSelectRow}
                onChange={(event) =>
                  onSelectedChange(card.id, event.target.checked)
                }
              />
              <span style={{ fontWeight: 900 }}>{title}</span>
            </label>
            <small style={{ color: "#666" }}>
              Confidence {confidence}
              {card.backFile ? " - Front/back paired" : " - Front only"}
              {card.result?.ai.parallel ? ` - ${card.result.ai.parallel}` : ""}
              {card.result?.ai.cardNumber
                ? ` - #${card.result.ai.cardNumber}`
                : ""}
            </small>
            {card.result ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginTop: 8,
                }}
              >
                <span
                  style={{
                    border: serialNumber
                      ? "1px solid #047857"
                      : "1px solid #d1d5db",
                    borderRadius: 999,
                    background: serialNumber ? "#ecfdf5" : "white",
                    color: serialNumber ? "#065f46" : "#6b7280",
                    fontSize: 12,
                    fontWeight: 900,
                    padding: "3px 8px",
                  }}
                >
                  Serial #: {serialNumber || "none detected"}
                </span>
                {grading ? (
                  <span
                    style={{
                      border: "1px solid #7c3aed",
                      borderRadius: 999,
                      background: "#f5f3ff",
                      color: "#5b21b6",
                      fontSize: 12,
                      fontWeight: 900,
                      padding: "3px 8px",
                    }}
                    title={card.result?.ai.gradingEvidence || "Detected grading slab details."}
                  >
                    Grading: {grading}
                    {gradingHref ? (
                      <>
                        {" "}
                        <a
                          href={gradingHref}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "#5b21b6" }}
                        >
                          verify
                        </a>
                      </>
                    ) : null}
                  </span>
                ) : null}
                {card.knowledgeEntryId ? (
                  <span
                    style={{
                      border:
                        card.knowledgeTrustStatus === "tcos_trusted"
                          ? "1px solid #047857"
                          : "1px solid #1d4ed8",
                      borderRadius: 999,
                      background:
                        card.knowledgeTrustStatus === "tcos_trusted"
                          ? "#ecfdf5"
                          : "#eff6ff",
                      color:
                        card.knowledgeTrustStatus === "tcos_trusted"
                          ? "#065f46"
                          : "#1d4ed8",
                      fontSize: 12,
                      fontWeight: 900,
                      padding: "3px 8px",
                    }}
                    title="TCOS trusts a card identity after 3 confirmed sightings."
                  >
                    TCOS DB:{" "}
                    {card.knowledgeTrustStatus === "tcos_trusted"
                      ? "trusted"
                      : "learning"}{" "}
                    ({card.knowledgeConfirmedCount || 0}/3)
                  </span>
                ) : null}
              </div>
            ) : null}
            {card.status === "done" && card.result ? (
              <div
                style={{
                  display: "inline-flex",
                  gap: 8,
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginTop: 8,
                }}
              >
                <label
                  style={{
                    display: "inline-flex",
                    gap: 8,
                    alignItems: "center",
                    padding: "6px 10px",
                    border: card.operatorMarkedWrong
                      ? "1px solid #dc2626"
                      : "1px solid #d1d5db",
                    borderRadius: 999,
                    background: card.operatorMarkedWrong ? "#fef2f2" : "white",
                    color: card.operatorMarkedWrong ? "#991b1b" : "#374151",
                    fontSize: 12,
                    fontWeight: 900,
                  }}
                  title="Check this when the scanner got the card wrong. Trial export will grade these as misses."
                >
                  <input
                    type="checkbox"
                    checked={Boolean(card.operatorMarkedWrong)}
                    onChange={(event) =>
                      onOperatorMarkedWrongChange(card.id, event.target.checked)
                    }
                  />
                  Wrong / needs fix
                </label>
                <label
                  style={{
                    display: "inline-flex",
                    gap: 8,
                    alignItems: "center",
                    padding: "6px 10px",
                    border: card.operatorNeedsMoreInfo
                      ? "1px solid #b45309"
                      : "1px solid #d1d5db",
                    borderRadius: 999,
                    background: card.operatorNeedsMoreInfo ? "#fffbeb" : "white",
                    color: card.operatorNeedsMoreInfo ? "#92400e" : "#374151",
                    fontSize: 12,
                    fontWeight: 900,
                  }}
                  title="Check this when the scan needs more proof before it should count as good. Trial export grades these as misses."
                >
                  <input
                    type="checkbox"
                    checked={Boolean(card.operatorNeedsMoreInfo)}
                    onChange={(event) =>
                      onOperatorNeedsMoreInfoChange(card.id, event.target.checked)
                    }
                  />
                  Needs more info
                </label>
              </div>
            ) : null}
            {card.operatorMarkedWrong ? (
              <div
                style={{
                  marginTop: 8,
                  border: "1px solid #fecaca",
                  borderRadius: 10,
                  background: "#fff1f2",
                  color: "#991b1b",
                  padding: "8px 10px",
                  fontSize: 12,
                  fontWeight: 900,
                }}
              >
                Wrong scan marked. Use “Remove Wrong Row” below to drop it from this
                batch, or edit the row and retry if the images are still useful.
              </div>
            ) : null}
            {(draftErrors.length > 0 || displayReviewWarnings.length > 0) && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginTop: 8,
                }}
              >
                {draftErrors.map((error) => (
                  <span
                    key={`${card.id}-fix-${error}`}
                    style={{
                      border: "1px solid #e3a2a2",
                      borderRadius: 999,
                      background: "white",
                      color: "#8a1f1f",
                      fontSize: 12,
                      fontWeight: 900,
                      padding: "3px 8px",
                    }}
                  >
                    Fix: {error}
                  </span>
                ))}
                {displayReviewWarnings.map((warning) => (
                  <span
                    key={`${card.id}-${warning}`}
                    style={{
                      border: "1px solid #e7c979",
                      borderRadius: 999,
                      background: "white",
                      color: "#7a4f00",
                      fontSize: 12,
                      fontWeight: 900,
                      padding: "3px 8px",
                    }}
                  >
                    {warning}
                  </span>
                ))}
              </div>
            )}
            {card.customTitle.trim() && card.customTitle.trim() !== aiTitle && (
              <div style={{ marginTop: 4, color: "#555", fontSize: 12 }}>
                AI title: {aiTitle}
              </div>
            )}
            <OcrDiagnosticsMini result={card.result} />
            <ConsensusMini result={card.result} />
            <ExternalSearchMini result={card.result} />
            {card.result ? (
              <TcosCardSearchActions query={tcosSearchQuery} compact />
            ) : null}
          </div>

          <div style={{ textAlign: "right", minWidth: 150 }}>
            <div style={{ color: "#666", fontSize: 12, fontWeight: 800 }}>
              InstaComp™ Suggested
            </div>
            <div style={{ fontWeight: 900, fontSize: 20 }}>
              {money(compPrice)}
            </div>
            {evidenceCompCount ? (
              <button
                type="button"
                onClick={() => setShowUsableComps((current) => !current)}
                aria-expanded={showUsableComps}
                style={{
                  marginTop: 2,
                  border: "none",
                  background: "transparent",
                  color: "#1d4ed8",
                  fontSize: 11,
                  fontWeight: 900,
                  padding: 0,
                  cursor: "pointer",
                  textDecoration: "underline",
                  textAlign: "right",
                }}
                title="Open the usable comp links used by InstaComp™ Suggested."
              >
                {compBasis}
                {compRange ? ` / ${compRange}` : ""} ▾
              </button>
            ) : (
              <div style={{ color: "#555", fontSize: 11, fontWeight: 800 }}>
                {compBasis}
              </div>
            )}
            <div style={{ marginTop: 7, color: "#666", fontSize: 11, fontWeight: 800 }}>
              Market guidance
            </div>
            <div style={{ fontWeight: 900, fontSize: 14, color: "#444" }}>
              {money(marketPrice)}
            </div>
            {draftPrice.price ? (
              <div style={{ color: "#555", fontSize: 12, fontWeight: 800 }}>
                Draft price: {money(draftPrice.price)}
                {draftPrice.source === "instacomp_market"
                  ? " - InstaComp™ comps"
                  : " - manual"}
              </div>
            ) : null}
            {!card.customPrice.trim() && compPrice ? (
              <div style={{ color: "#0f5132", fontSize: 12, fontWeight: 800 }}>
                Blank price will use comps.
              </div>
            ) : null}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "flex-end",
                gap: 8,
                marginTop: 10,
              }}
            >
              {onCopySummary && (
                <button
                  type="button"
                  onClick={() => void onCopySummary(card, index)}
                  style={{
                    ...secondaryButtonStyle,
                    padding: "8px 10px",
                    borderColor: "#111",
                    color: "#111",
                  }}
                >
                  Copy Summary
                </button>
              )}

              {onCopyDraftPayload && (
                <button
                  type="button"
                  onClick={() => {
                    if (!canCopyDraftPayload) {
                      onBlockedAction(copyDraftPayloadBlockedReason);
                      return;
                    }

                    void onCopyDraftPayload(card, index);
                  }}
                  aria-disabled={!canCopyDraftPayload}
                  title={
                    canCopyDraftPayload
                      ? "Copy the exact draft payload TCOS will send for this row."
                      : copyDraftPayloadBlockedReason
                  }
                  style={{
                    ...secondaryButtonStyle,
                    padding: "8px 10px",
                    borderColor: "#0f5132",
                    color: "#0f5132",
                    opacity: canCopyDraftPayload ? 1 : 0.5,
                    cursor: canCopyDraftPayload ? "pointer" : "not-allowed",
                  }}
                >
                  Copy Draft Payload
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (!canSaveCorrections) {
                    onBlockedAction(saveCorrectionsBlockedReason);
                    return;
                  }

                  void onSaveCorrections(card.id);
                }}
                aria-disabled={!canSaveCorrections}
                aria-busy={savingCorrections}
                title={
                  canSaveCorrections
                    ? "Save edited title, quantity, price, and review marks to this saved InstaComp™ lot row."
                    : saveCorrectionsBlockedReason
                }
                style={{
                  ...secondaryButtonStyle,
                  padding: "8px 10px",
                  borderColor: "#0f5132",
                  color: "#0f5132",
                  opacity: canSaveCorrections ? 1 : 0.5,
                  cursor: canSaveCorrections ? "pointer" : "not-allowed",
                }}
              >
                {saveCorrectionsLabel}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!canRefreshComps) {
                    onBlockedAction(refreshCompsBlockedReason);
                    return;
                  }

                  void onRefreshComps(card.id);
                }}
                aria-disabled={!canRefreshComps}
                aria-busy={refreshingComps}
                title={
                  canRefreshComps
                    ? "Refresh comps and market price for this saved InstaComp™ row."
                    : refreshCompsBlockedReason
                }
                style={{
                  ...secondaryButtonStyle,
                  padding: "8px 10px",
                  borderColor: "#7c3aed",
                  color: "#5b21b6",
                  opacity: canRefreshComps ? 1 : 0.5,
                  cursor: canRefreshComps ? "pointer" : "not-allowed",
                }}
              >
                {refreshCompsLabel}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!canAddToTrade) {
                    onBlockedAction(addToTradeBlockedReason);
                    return;
                  }

                  void onAddToTrade(card.id);
                }}
                aria-disabled={!canAddToTrade}
                aria-busy={card.tradeStatus === "adding"}
                title={
                  canAddToTrade
                    ? "Add this completed scan row to Available for Trade."
                    : addToTradeBlockedReason
                }
                style={{
                  ...secondaryButtonStyle,
                  padding: "8px 10px",
                  borderColor: "#1d4ed8",
                  color: "#1d4ed8",
                  opacity: canAddToTrade ? 1 : 0.5,
                  cursor: canAddToTrade ? "pointer" : "not-allowed",
                }}
              >
                {card.tradeStatus === "adding"
                  ? "Adding to Trade..."
                  : card.tradeStatus === "created"
                    ? "Available for Trade"
                    : card.draftStatus === "created"
                      ? "Already For Sale"
                      : "Add to Available for Trade"}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!canRetry) {
                    onBlockedAction(
                      retryBlockedReason ||
                        "Retry becomes available after this row finishes scanning or errors.",
                    );
                    return;
                  }

                  onRetry(card.id);
                }}
                aria-disabled={!canRetry}
                title={retryBlockedReason || "Retry this row with the current image/title/serial corrections."}
                style={{
                  ...secondaryButtonStyle,
                  padding: "8px 10px",
                  opacity: canRetry ? 1 : 0.5,
                  cursor: canRetry ? "pointer" : "not-allowed",
                }}
              >
                Retry Row
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!canRemove) {
                    onBlockedAction(removeBlockedReason || "This row cannot be removed right now.");
                    return;
                  }

                  void onRemove(card.id);
                }}
                aria-disabled={!canRemove}
                aria-busy={isRemoving}
                title={
                  isRemoving
                    ? "This row is being removed from the visible batch and cancelled in storage when applicable."
                    : removeBlockedReason
                      ? removeBlockedReason
                    : card.operatorMarkedWrong
                      ? "Remove this wrong scan result from the visible batch and cancel its saved queue row when available."
                    : card.status === "queued" || card.status === "scanning"
                      ? "End this queued or active scan row, remove it from the visible batch, and cancel its saved queue row when available."
                      : card.persistentJobId && card.persistentItemId
                    ? "Cancel this saved InstaComp™ row and remove it from the visible batch."
                    : "Remove this local upload row from the visible batch."
                }
                style={{
                  ...secondaryButtonStyle,
                  padding: "8px 10px",
                  borderColor: "#d7b3b3",
                  color: "#8a1f1f",
                  opacity: canRemove ? 1 : 0.5,
                  cursor: canRemove ? "pointer" : "not-allowed",
                }}
              >
                {instaCompBatchRowRemovalLabel({
                  operatorMarkedWrong: card.operatorMarkedWrong,
                  status: card.status,
                  isRemoving,
                })}
              </button>
            </div>
            {removeBlockedReason ? (
              <div
                role="status"
                aria-live="polite"
                style={{
                  marginTop: 8,
                  border: "1px solid #fed7aa",
                  borderRadius: 10,
                  background: "#fff7ed",
                  color: "#9a3412",
                  padding: "7px 9px",
                  fontSize: 11,
                  fontWeight: 900,
                  textAlign: "left",
                }}
              >
                Remove blocked: {removeBlockedReason}
              </div>
            ) : isRemoving ? (
              <div
                role="status"
                aria-live="polite"
                style={{
                  marginTop: 8,
                  border: "1px solid #bfdbfe",
                  borderRadius: 10,
                  background: "#eff6ff",
                  color: "#1d4ed8",
                  padding: "7px 9px",
                  fontSize: 11,
                  fontWeight: 900,
                  textAlign: "left",
                }}
              >
                Removing row and cancelling saved InstaComp™ storage when present...
              </div>
            ) : null}
          </div>
        </div>

        {showUsableComps && evidenceCompCount ? (
          <div
            style={{
              marginTop: 12,
              border: "1px solid #bfdbfe",
              borderRadius: 10,
              background: "#eff6ff",
              padding: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                gap: 8,
                alignItems: "baseline",
              }}
            >
              <strong>
                Comp evidence for InstaComp™ Suggested ({evidenceCompCount})
              </strong>
              <span style={{ color: "#1d4ed8", fontSize: 12, fontWeight: 900 }}>
                {money(compPrice)}
              </span>
            </div>
            <p style={{ margin: "6px 0 10px", color: "#555", fontSize: 12 }}>
              {pricingCompCount} current comp{pricingCompCount === 1 ? "" : "s"}{" "}
              drive the suggested price
              {historicalCompCount
                ? `; ${historicalCompCount} older sold comp${
                    historicalCompCount === 1 ? "" : "s"
                  } stay visible as history but do not price.`
                : "."}
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              {evidenceComps.map((comp, compIndex) => (
                <a
                  key={`${card.id}-usable-comp-${comp.url}-${compIndex}`}
                  href={comp.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    gap: 10,
                    alignItems: "center",
                    border: "1px solid #dbeafe",
                    borderRadius: 8,
                    padding: "8px 10px",
                    background: "white",
                    color: "inherit",
                    textDecoration: "none",
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontWeight: 900,
                      }}
                    >
                      {comp.title}
                    </span>
                    <small style={{ color: "#555", fontWeight: 800 }}>
                      {comp.sourceLabel || comp.source} ·{" "}
                      {compPriceBasisLabel(comp)} · Match {comp.matchScore}
                      {compGuidanceLabel(comp)
                        ? ` · ${compGuidanceLabel(comp)}`
                        : ""}
                      {compFreshnessLabel(comp)
                        ? ` · ${compFreshnessLabel(comp)}`
                        : ""}
                    </small>
                  </span>
                  <strong>{money(comp.price)}</strong>
                </a>
              ))}
            </div>
          </div>
        ) : null}

        {card.error && (
          <p style={{ color: "crimson", fontWeight: 700 }}>{card.error}</p>
        )}

        {card.draftStatus !== "idle" && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 10px",
              borderRadius: 8,
              background:
                card.draftStatus === "created"
                  ? "#f0fff4"
                  : card.draftStatus === "error"
                    ? "#fff5f5"
                    : "#f6f6f6",
              border:
                card.draftStatus === "created"
                  ? "1px solid #b7ebc6"
                  : card.draftStatus === "error"
                    ? "1px solid #f3c2c2"
                    : "1px solid #e5e5e5",
              fontWeight: 800,
            }}
          >
            {card.draftStatus === "drafting" && "Creating draft listing..."}
            {card.draftStatus === "created" && (
              <>
                Draft created
                {card.draftSku ? ` - ${card.draftSku}` : ""}
                {" - "}
                <a href={draftHref}>
                  Open in InstaComp™ drafts
                </a>
              </>
            )}
            {card.draftStatus === "error" && (
              <span style={{ color: "crimson" }}>
                {card.draftError || "Draft was not created."}
              </span>
            )}
            {card.draftStatus === "created" && card.draftError && (
              <div style={{ color: "#8a5a00", marginTop: 4 }}>
                {card.draftError}
              </div>
            )}
            {card.draftStatus === "created" && card.draftDuplicateAlert && (
              <div
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "#fff8e1",
                  border: "1px solid #f1c75b",
                  color: "#7a4a00",
                }}
              >
                <div>{card.draftDuplicateAlert.message}</div>
                {card.draftDuplicateAlert.matches.length > 0 && (
                  <small style={{ display: "block", marginTop: 4 }}>
                    Existing: {card.draftDuplicateAlert.matches[0].title}
                    {" · "}
                    {money(card.draftDuplicateAlert.matches[0].price)}
                    {" · Qty "}
                    {card.draftDuplicateAlert.matches[0].quantity}
                  </small>
                )}
                <a
                  href={card.draftDuplicateAlert.mergeUrl || "/admin/ebay/duplicates"}
                  style={{ display: "inline-block", marginTop: 6 }}
                >
                  Open duplicate finder / merge
                </a>
              </div>
            )}
          </div>
        )}

        {card.tradeStatus !== "idle" && (
          <div
            style={{
              marginTop: 10,
              padding: "8px 10px",
              borderRadius: 8,
              background:
                card.tradeStatus === "created"
                  ? "#eff6ff"
                  : card.tradeStatus === "error"
                    ? "#fff5f5"
                    : "#f6f6f6",
              border:
                card.tradeStatus === "created"
                  ? "1px solid #bfdbfe"
                  : card.tradeStatus === "error"
                    ? "1px solid #f3c2c2"
                    : "1px solid #e5e5e5",
              color:
                card.tradeStatus === "created"
                  ? "#1d4ed8"
                  : card.tradeStatus === "error"
                    ? "crimson"
                    : "#111",
              fontWeight: 800,
            }}
          >
            {card.tradeStatus === "adding" && "Adding to Available for Trade..."}
            {card.tradeStatus === "created" && (
              <>
                Available for Trade
                {card.tradeCollectionItemId
                  ? ` - ${card.tradeCollectionItemId.slice(0, 8)}`
                  : ""}
                {card.tradeError ? (
                  <div style={{ color: "#8a5a00", marginTop: 4 }}>
                    {card.tradeError}
                  </div>
                ) : null}
              </>
            )}
            {card.tradeStatus === "error" && (
              <span>{card.tradeError || "Could not add this card to trade."}</span>
            )}
          </div>
        )}

        <div
          style={{
            display: "grid",
            gap: 10,
            marginTop: 12,
          }}
        >
          <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
            Draft Title
            <input
              type="text"
              value={card.customTitle}
              onChange={(event) => onTitleChange(card.id, event.target.value)}
              placeholder={aiTitle}
              style={{
                border: "1px solid #ccc",
                borderRadius: 8,
                padding: "10px 12px",
                fontWeight: 800,
                width: "100%",
                boxSizing: "border-box",
              }}
            />
          </label>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 10,
              alignItems: "end",
            }}
          >
            <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
              Serial #
              <input
                type="text"
                value={card.customSerialNumber}
                onChange={(event) =>
                  onSerialChange(card.id, event.target.value)
                }
                placeholder="Blank = no serial, e.g. 12/150"
                style={{
                  border: "1px solid #ccc",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontWeight: 800,
                }}
              />
            </label>

            <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
              Quantity
              <input
                type="number"
                min="1"
                step="1"
                value={card.customQuantity}
                onChange={(event) =>
                  onQuantityChange(card.id, event.target.value)
                }
                style={{
                  border: "1px solid #ccc",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontWeight: 800,
                }}
              />
            </label>

            <label style={{ display: "grid", gap: 6, fontWeight: 800 }}>
              Listing Price
              <input
                type="number"
                min="0"
                step="0.01"
                value={card.customPrice}
                onChange={(event) => onPriceChange(card.id, event.target.value)}
                placeholder={marketPrice ? marketPrice.toFixed(2) : "0.00"}
                style={{
                  border: "1px solid #ccc",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontWeight: 800,
                }}
              />
            </label>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {PRICE_BUTTONS.map((button) => (
                <button
                  key={`${card.id}-${button.label}`}
                  type="button"
                  onClick={() => {
                    if (priceButtonsDisabled) {
                      onBlockedAction(priceButtonBlockedReason);
                      return;
                    }

                    onApplyPrice(card.id, button.multiplier);
                  }}
                  aria-disabled={priceButtonsDisabled}
                  title={
                    priceButtonsDisabled
                      ? priceButtonBlockedReason
                      : `Apply ${button.label} to this row's listing price.`
                  }
                  style={{
                    ...secondaryButtonStyle,
                    padding: "8px 10px",
                    opacity: priceButtonsDisabled ? 0.5 : 1,
                    cursor: priceButtonsDisabled ? "not-allowed" : "pointer",
                  }}
                >
                  {button.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImageRotationControls({
  disabled,
  disabledReason = "Image rotation is unavailable right now.",
  onUnavailable,
  onRotateLeft,
  onRotateRight,
}: {
  disabled?: boolean;
  disabledReason?: string;
  onUnavailable?: (message: string) => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
}) {
  function rotate(direction: "left" | "right") {
    if (disabled) {
      onUnavailable?.(disabledReason);
      return;
    }

    if (direction === "left") {
      onRotateLeft();
      return;
    }

    onRotateRight();
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        justifyContent: "center",
        marginTop: 6,
      }}
    >
      <button
        type="button"
        onClick={() => rotate("left")}
        aria-disabled={disabled}
        aria-label="Rotate image left"
        title={disabled ? disabledReason : "Rotate left"}
        style={{
          ...secondaryButtonStyle,
          padding: "5px 8px",
          minWidth: 34,
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        ↺
      </button>
      <button
        type="button"
        onClick={() => rotate("right")}
        aria-disabled={disabled}
        aria-label="Rotate image right"
        title={disabled ? disabledReason : "Rotate right"}
        style={{
          ...secondaryButtonStyle,
          padding: "5px 8px",
          minWidth: 34,
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        ↻
      </button>
    </div>
  );
}

function ImagePreviewWithRotation({
  url,
  alt,
  disabled,
  disabledReason,
  onUnavailable,
  onRotateLeft,
  onRotateRight,
}: {
  url: string;
  alt: string;
  disabled?: boolean;
  disabledReason?: string;
  onUnavailable?: (message: string) => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={alt}
        style={{
          width: "100%",
          maxHeight: 320,
          objectFit: "contain",
          border: "1px solid #eee",
          borderRadius: 8,
          background: "#fafafa",
        }}
      />
      <ImageRotationControls
        disabled={disabled}
        disabledReason={disabledReason}
        onUnavailable={onUnavailable}
        onRotateLeft={onRotateLeft}
        onRotateRight={onRotateRight}
      />
    </div>
  );
}

function Thumbnail({
  url,
  canRotate,
  rotateBlockedReason,
  onUnavailable,
  onRotateLeft,
  onRotateRight,
}: {
  url: string;
  canRotate: boolean;
  rotateBlockedReason: string;
  onUnavailable: (message: string) => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div style={{ display: "grid", gap: 4 }}>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        title="View larger image"
        style={{
          border: 0,
          padding: 0,
          background: "transparent",
          cursor: "zoom-in",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Card image preview"
          style={{
            width: 96,
            height: 128,
            objectFit: "contain",
            border: "1px solid #eee",
            borderRadius: 8,
            background: "white",
            display: "block",
          }}
        />
      </button>
      {isOpen ? (
        <ImageLightbox
          url={url}
          onClose={() => setIsOpen(false)}
          canRotate={canRotate}
          rotateBlockedReason={rotateBlockedReason}
          onUnavailable={onUnavailable}
          onRotateLeft={onRotateLeft}
          onRotateRight={onRotateRight}
        />
      ) : null}
      <ImageRotationControls
        disabled={!canRotate}
        disabledReason={rotateBlockedReason}
        onUnavailable={onUnavailable}
        onRotateLeft={onRotateLeft}
        onRotateRight={onRotateRight}
      />
    </div>
  );
}

function ImageLightbox({
  url,
  canRotate,
  rotateBlockedReason,
  onUnavailable,
  onClose,
  onRotateLeft,
  onRotateRight,
}: {
  url: string;
  canRotate: boolean;
  rotateBlockedReason: string;
  onUnavailable: (message: string) => void;
  onClose: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(17, 17, 17, 0.72)",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          display: "grid",
          gap: 10,
          maxWidth: "min(92vw, 980px)",
          maxHeight: "92vh",
          background: "white",
          borderRadius: 14,
          padding: 14,
          boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <strong>Image preview</strong>
          <button
            type="button"
            onClick={onClose}
            style={{
              ...secondaryButtonStyle,
              padding: "6px 10px",
            }}
          >
            Close
          </button>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt="Large card preview"
          style={{
            maxWidth: "calc(92vw - 56px)",
            maxHeight: "calc(92vh - 120px)",
            objectFit: "contain",
            border: "1px solid #eee",
            borderRadius: 10,
            background: "white",
          }}
        />
        <ImageRotationControls
          disabled={!canRotate}
          disabledReason={rotateBlockedReason}
          onUnavailable={onUnavailable}
          onRotateLeft={onRotateLeft}
          onRotateRight={onRotateRight}
        />
        <small style={{ color: "#555", fontWeight: 800, textAlign: "center" }}>
          Rotate moves 45° per click. Retry Row after the image is corrected.
        </small>
      </div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #111",
  background: "#111",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #bbb",
  background: "white",
  color: "#111",
  fontWeight: 800,
};

function SourceCoverage({ sources }: { sources: SourceCoverageItem[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 10,
      }}
    >
      {sources.map((source) => (
        <div
          key={`${source.category}-${source.label}`}
          style={{
            border: "1px solid #eee",
            borderRadius: 10,
            padding: 12,
            background: source.includedInMarketValue ? "#f0fff4" : "#fafafa",
          }}
        >
          <div style={{ fontWeight: 900 }}>{source.label}</div>
          <small style={{ color: "#666" }}>
            {sourceCategoryLabels[source.category]} Â·{" "}
            {sourceStatusLabel(source.status)} Â· {source.resultCount} matches
          </small>
          {source.message && (
            <div style={{ marginTop: 6, color: "#555", fontSize: 12 }}>
              {source.message}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
