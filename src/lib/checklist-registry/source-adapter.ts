import type { ChecklistIdentityFingerprint } from "./identity";
import type { ChecklistSourceStorageReceipt } from "./storage";

export type ChecklistSourceAuthority =
  | "official_manufacturer"
  | "approved_distributor"
  | "manual_official_file";

export type ChecklistSourceArtifact = {
  sourceUrl: string;
  originalFilename: string;
  mimeType: string;
  content: string | Uint8Array;
  retrievedAt: string;
  authority: ChecklistSourceAuthority;
  redistributionAllowed: boolean;
};

export type ChecklistImportValidationIssue = {
  code: string;
  severity: "warning" | "error";
  message: string;
  rowReference?: string | null;
};

export type ChecklistImportSet = {
  sourceKey: string;
  name: string;
  normalizedName: string;
  setType:
    | "base"
    | "subset"
    | "insert"
    | "autograph"
    | "memorabilia"
    | "other";
};

export type ChecklistImportCard = {
  sourceKey: string;
  setSourceKey: string;
  cardNumber: string;
  players: string[];
  teams: string[];
  rookieDesignation: boolean | null;
  firstBowmanDesignation: boolean | null;
  autographStatus: string;
  memorabiliaStatus: string;
  variation: string | null;
  sourceNotes: string | null;
};

export type ChecklistImportParallel = {
  sourceKey: string;
  setSourceKey: string;
  name: string;
  serialRun: number | null;
  configurationExclusivity: string | null;
};

export type ChecklistImportIdentity = {
  cardSourceKey: string;
  parallelSourceKey: string | null;
  fingerprint: ChecklistIdentityFingerprint;
};

export type ChecklistImportPlan = {
  schema: "tcos.checklist.importPlan.v1";
  adapterId: string;
  adapterVersion: string;
  source: {
    sourceUrl: string;
    retrievedAt: string;
    authority: ChecklistSourceAuthority;
    redistributionAllowed: boolean;
    privateArchiveRequired: true;
    normalizedFactsInternalOnly: true;
    storage: ChecklistSourceStorageReceipt;
  };
  release: {
    manufacturer: string;
    brand: string | null;
    product: string;
    releaseYear: string | null;
    season: string | null;
    sport: string;
    league: string | null;
    releaseSlug: string;
  };
  sets: ChecklistImportSet[];
  cards: ChecklistImportCard[];
  parallels: ChecklistImportParallel[];
  identities: ChecklistImportIdentity[];
  validation: {
    status: "passed" | "validation_required";
    issues: ChecklistImportValidationIssue[];
    counts: {
      sets: number;
      cards: number;
      parallels: number;
      identities: number;
    };
  };
};

export interface ChecklistSourceAdapter {
  readonly id: string;
  readonly version: string;
  supports(artifact: ChecklistSourceArtifact): boolean;
  parse(artifact: ChecklistSourceArtifact): ChecklistImportPlan;
}
