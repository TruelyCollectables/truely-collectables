import {
  KINGMAKER_SOURCE_TYPES,
  canonicalizeKingmakerObservation,
  isKingmakerObservationFresh,
  type CanonicalKingmakerObservation,
  type KingmakerObservationInput,
  type KingmakerSource,
} from "./kingmaker-intelligence-fusion";

export type KingmakerIngestionRejectCode =
  | "unsupported_source"
  | "missing_source_record_key"
  | "missing_entity_key"
  | "missing_observation_type"
  | "invalid_observed_at"
  | "future_observation"
  | "expired_observation"
  | "invalid_confidence"
  | "invalid_currency"
  | "invalid_direct_url"
  | "empty_evidence"
  | "duplicate_fingerprint";

export type KingmakerIngestionRejection = {
  index: number;
  sourceRecordKey: string | null;
  code: KingmakerIngestionRejectCode;
};

export type KingmakerIngestionBatchResult = {
  source: KingmakerSource;
  received: number;
  accepted: CanonicalKingmakerObservation[];
  rejected: KingmakerIngestionRejection[];
  duplicateCount: number;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function validUrl(value: string | null | undefined) {
  if (!value) return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function rejection(
  index: number,
  input: Partial<KingmakerObservationInput>,
  code: KingmakerIngestionRejectCode,
): KingmakerIngestionRejection {
  return {
    index,
    sourceRecordKey: clean(input.sourceRecordKey) || null,
    code,
  };
}

export function validateKingmakerObservation(
  input: Partial<KingmakerObservationInput>,
  now = new Date(),
): KingmakerIngestionRejectCode | null {
  if (!KINGMAKER_SOURCE_TYPES.includes(input.source as KingmakerSource)) return "unsupported_source";
  if (!clean(input.sourceRecordKey)) return "missing_source_record_key";
  if (!clean(input.entityKey)) return "missing_entity_key";
  if (!clean(input.observationType)) return "missing_observation_type";

  const observedAt = Date.parse(clean(input.observedAt));
  if (!Number.isFinite(observedAt)) return "invalid_observed_at";
  if (observedAt > now.getTime() + 5 * 60_000) return "future_observation";

  if (input.expiresAt) {
    const expiresAt = Date.parse(input.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return "expired_observation";
  }

  if (
    input.confidence !== null &&
    input.confidence !== undefined &&
    (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)
  ) {
    return "invalid_confidence";
  }

  if (input.currency && !/^[A-Za-z]{3}$/.test(input.currency.trim())) return "invalid_currency";
  if (!validUrl(input.directUrl)) return "invalid_direct_url";
  if (!input.evidence || Object.keys(input.evidence).length === 0) return "empty_evidence";
  return null;
}

export function ingestKingmakerObservationBatch(input: {
  source: KingmakerSource;
  observations: Partial<KingmakerObservationInput>[];
  existingFingerprints?: Iterable<string>;
  now?: Date;
}): KingmakerIngestionBatchResult {
  const now = input.now || new Date();
  const accepted: CanonicalKingmakerObservation[] = [];
  const rejected: KingmakerIngestionRejection[] = [];
  const fingerprints = new Set(input.existingFingerprints || []);
  let duplicateCount = 0;

  input.observations.forEach((candidate, index) => {
    const normalizedCandidate = { ...candidate, source: input.source };
    const invalid = validateKingmakerObservation(normalizedCandidate, now);
    if (invalid) {
      rejected.push(rejection(index, normalizedCandidate, invalid));
      return;
    }

    const observation = canonicalizeKingmakerObservation(
      normalizedCandidate as KingmakerObservationInput,
    );
    if (!isKingmakerObservationFresh(observation, now)) {
      rejected.push(rejection(index, normalizedCandidate, "expired_observation"));
      return;
    }
    if (fingerprints.has(observation.fingerprint)) {
      duplicateCount += 1;
      rejected.push(rejection(index, normalizedCandidate, "duplicate_fingerprint"));
      return;
    }

    fingerprints.add(observation.fingerprint);
    accepted.push(observation);
  });

  return {
    source: input.source,
    received: input.observations.length,
    accepted,
    rejected,
    duplicateCount,
  };
}
