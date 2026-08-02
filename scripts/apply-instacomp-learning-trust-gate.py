#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BRANCH = "fix/instacomp-learning-trust-gate"


def run(args: list[str], *, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess[str]:
    print("+", " ".join(args), flush=True)
    result = subprocess.run(
        args,
        cwd=ROOT,
        text=True,
        check=False,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.STDOUT if capture else None,
    )
    if capture and result.stdout:
        print(result.stdout, end="" if result.stdout.endswith("\n") else "\n")
    if check and result.returncode != 0:
        raise SystemExit(result.returncode)
    return result


def replace_once(relative_path: str, old: str, new: str) -> None:
    path = ROOT / relative_path
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one match in {relative_path}, found {count}")
    path.write_text(text.replace(old, new, 1))


def write(relative_path: str, content: str) -> None:
    path = ROOT / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


current_branch = run(["git", "branch", "--show-current"], capture=True).stdout.strip().splitlines()[-1]
if current_branch != BRANCH:
    raise RuntimeError(f"Run this script on {BRANCH}; current branch is {current_branch}")

# Core scan persistence: only trusted catalog evidence can enter automatic learning.
replace_once(
    "src/app/api/instacomp/scan/route.ts",
    '''  catalogEvidence?: unknown;
  imageOrientation?: unknown;
}) {''',
    '''  catalogEvidence?: unknown;
  catalogCandidateEvidence?: unknown;
  consensus?: unknown;
  compSearchDecision?: unknown;
  checklistRegistry?: unknown;
  imageOrientation?: unknown;
}) {''',
)

replace_once(
    "src/app/api/instacomp/scan/route.ts",
    '''        sourceLinks: input.links,
        catalogEvidence: input.catalogEvidence || null,
        imageOrientation: input.imageOrientation || null,''',
    '''        sourceLinks: input.links,
        catalogEvidence: input.catalogEvidence || null,
        catalogCandidateEvidence: input.catalogCandidateEvidence || null,
        consensus: input.consensus || null,
        compSearchDecision: input.compSearchDecision || null,
        checklistRegistry: input.checklistRegistry || null,
        imageOrientation: input.imageOrientation || null,''',
)

replace_once(
    "src/app/api/instacomp/scan/route.ts",
    '''    const sourceCoverage = buildSourceCoverage(links, providers);

    const scanId = ephemeralBenchmark''',
    '''    const sourceCoverage = buildSourceCoverage(links, providers);
    const checklistRegistrySnapshot = registryMatch
      ? {
          matched: true,
          identityId: registryMatch.identityId,
          fingerprintSha256: registryMatch.fingerprintSha256,
          score: registryMatch.score,
          sourceLabel: registryMatch.sourceLabel,
        }
      : null;
    const catalogEvidenceTrustedForLearning =
      compSearchDecision.allowed && consensus.trustedForIdentity;

    const scanId = ephemeralBenchmark''',
)

replace_once(
    "src/app/api/instacomp/scan/route.ts",
    '''          catalogEvidence,
          imageOrientation,
        });''',
    '''          catalogEvidence: catalogEvidenceTrustedForLearning
            ? catalogEvidence
            : null,
          catalogCandidateEvidence: catalogEvidenceTrustedForLearning
            ? null
            : catalogEvidence,
          consensus,
          compSearchDecision,
          checklistRegistry: checklistRegistrySnapshot,
          imageOrientation,
        });''',
)

replace_once(
    "src/app/api/instacomp/scan/route.ts",
    '''      checklistRegistry: registryMatch
        ? {
            matched: true,
            identityId: registryMatch.identityId,
            fingerprintSha256: registryMatch.fingerprintSha256,
            score: registryMatch.score,
            sourceLabel: registryMatch.sourceLabel,
          }
        : null,''',
    '''      checklistRegistry: checklistRegistrySnapshot,''',
)

# Learning server: explicit trust decision, contradiction quarantine, and manual confirmation guard.
replace_once(
    "src/lib/instacomp-learning-server.ts",
    '''function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}
''',
    '''function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

const OPERATOR_CONFIRMATION_IDENTITY_FIELDS = [
  "player",
  "year",
  "brand",
  "setName",
  "cardNumber",
  "parallel",
] as const;

function hasMeaningfulValue(value: unknown) {
  return typeof value === "string"
    ? value.trim().length > 0
    : value !== null && value !== undefined;
}

export type InstaCompLearningPromotionDecision = {
  allowed: boolean;
  reason: "trusted_exact_identity" | "identity_review_required";
  identityId: string | null;
  reviewReasons: string[];
  explanation: string;
};

export function decideInstaCompLearningPromotion(
  payload: Record<string, any>,
): InstaCompLearningPromotionDecision {
  const consensus = record(payload.consensus);
  const compSearchDecision = record(payload.compSearchDecision);
  const checklistRegistry = record(payload.checklistRegistry);
  const catalogEvidence = record(payload.catalogEvidence);
  const selectedMatch = record(catalogEvidence.selectedMatch);
  const checklistIdentityId = String(checklistRegistry.identityId || "").trim();
  const catalogIdentityId = String(selectedMatch.catalogId || "").trim();
  const identityId = checklistIdentityId || catalogIdentityId || null;
  const reviewReasons: string[] = [];

  if (consensus.trustedForIdentity !== true) {
    reviewReasons.push("consensus_identity_not_trusted");
  }
  if (compSearchDecision.allowed !== true) {
    reviewReasons.push("comp_search_identity_gate_blocked");
  }
  if (checklistRegistry.matched !== true || !checklistIdentityId) {
    reviewReasons.push("missing_trusted_checklist_registry_match");
  }
  if (
    catalogEvidence.status !== "catalog_confirmed" ||
    catalogEvidence.catalogConfirmed !== true ||
    !catalogIdentityId
  ) {
    reviewReasons.push("catalog_evidence_not_confirmed");
  }
  if (
    checklistIdentityId &&
    catalogIdentityId &&
    checklistIdentityId !== catalogIdentityId
  ) {
    reviewReasons.push("catalog_identity_disagrees_with_registry_match");
  }

  const allowed = reviewReasons.length === 0;
  return {
    allowed,
    reason: allowed ? "trusted_exact_identity" : "identity_review_required",
    identityId,
    reviewReasons,
    explanation: allowed
      ? "Consensus, comp-search gate, and checklist catalog agree on one exact identity."
      : "Reusable catalog knowledge is blocked until consensus and checklist evidence agree on one trusted exact identity.",
  };
}

export type InstaCompOperatorConfirmationDecision = {
  allowed: boolean;
  reason:
    | "trusted_identity_confirmation"
    | "explicit_operator_identity"
    | "explicit_identity_corrections_required"
    | "non_confirming_status";
  missingCorrections: string[];
  explanation: string;
};

export function decideInstaCompOperatorConfirmation(params: {
  payload: Record<string, any>;
  corrections: Record<string, unknown>;
  status: "operator_confirmed" | "operator_rejected" | "needs_more_info";
}): InstaCompOperatorConfirmationDecision {
  if (params.status !== "operator_confirmed") {
    return {
      allowed: true,
      reason: "non_confirming_status",
      missingCorrections: [],
      explanation: "Reject and needs-more-information actions do not promote reusable identity knowledge.",
    };
  }

  const consensus = record(params.payload.consensus);
  const compSearchDecision = record(params.payload.compSearchDecision);
  if (
    consensus.trustedForIdentity === true &&
    compSearchDecision.allowed === true
  ) {
    return {
      allowed: true,
      reason: "trusted_identity_confirmation",
      missingCorrections: [],
      explanation: "The operator is confirming an identity already trusted by consensus.",
    };
  }

  const missingCorrections = OPERATOR_CONFIRMATION_IDENTITY_FIELDS.filter(
    (field) => !hasMeaningfulValue(params.corrections[field]),
  ) as string[];
  const ai = record(params.payload.ai);
  const consensusIdentity = record(consensus.finalIdentity);
  const serialRequired =
    hasMeaningfulValue(ai.serialNumber) ||
    hasMeaningfulValue(consensusIdentity.serialNumber);
  if (
    serialRequired &&
    !hasMeaningfulValue(params.corrections.serialNumber)
  ) {
    missingCorrections.push("serialNumber");
  }

  const allowed = missingCorrections.length === 0;
  return {
    allowed,
    reason: allowed
      ? "explicit_operator_identity"
      : "explicit_identity_corrections_required",
    missingCorrections,
    explanation: allowed
      ? "The owner supplied a complete explicit identity instead of promoting unresolved scanner guesses."
      : "Operator confirmation requires explicit corrected identity fields when scanner consensus is not trusted.",
  };
}

function quarantineInstaCompCatalogEvidence(
  value: unknown,
  reviewReasons: string[],
) {
  const evidence = record(value);
  if (!Object.keys(evidence).length) return evidence;
  const actionPermissions = record(evidence.actionPermissions);

  return {
    ...evidence,
    status: "review_required",
    operatorState: "needs_review",
    catalogConfirmed: false,
    reviewReasons: Array.from(
      new Set([
        ...(Array.isArray(evidence.reviewReasons)
          ? evidence.reviewReasons.map(String)
          : []),
        ...reviewReasons,
      ]),
    ),
    operatorAction:
      "Resolve the identity contradiction before promoting this observation to reusable knowledge.",
    safeUseBoundary:
      "This is candidate catalog evidence only. It cannot authorize exact comps, pricing, listings, or reusable identity knowledge.",
    actionPermissions: {
      ...actionPermissions,
      exactCompSearchAllowed: false,
      trustedForExactComps: false,
      publicListingClaimAllowed: false,
      autoPriceAllowed: false,
      tradeValueRecommendationAllowed: false,
    },
  };
}
''',
)

replace_once(
    "src/lib/instacomp-learning-server.ts",
    '''  const registryMatch = await findChecklistRegistryMatch(params.payload.ai || {});
  const payload = registryMatch
    ? {
        ...params.payload,
        catalogEvidence: buildChecklistRegistryCatalogEvidence(registryMatch),
        checklistRegistry: {
          matched: true,
          identityId: registryMatch.identityId,
          fingerprintSha256: registryMatch.fingerprintSha256,
          score: registryMatch.score,
        },
      }
    : params.payload;
''',
    '''  const promotionDecision = decideInstaCompLearningPromotion(params.payload);
  const registryCandidate = promotionDecision.allowed
    ? await findChecklistRegistryMatch(params.payload.ai || {})
    : null;
  const registryMatch =
    registryCandidate &&
    promotionDecision.identityId === registryCandidate.identityId
      ? registryCandidate
      : null;
  let effectivePromotionDecision = promotionDecision;

  if (promotionDecision.allowed && !registryMatch) {
    effectivePromotionDecision = {
      allowed: false,
      reason: "identity_review_required",
      identityId: promotionDecision.identityId,
      reviewReasons: [
        ...promotionDecision.reviewReasons,
        "registry_revalidation_failed_or_identity_changed",
      ],
      explanation:
        "Reusable catalog knowledge was blocked because the live registry no longer reproduced the trusted identity.",
    };
    warnings.push("catalog_promotion_blocked:registry_revalidation_failed_or_identity_changed");
  }

  const existingChecklistRegistry = record(params.payload.checklistRegistry);
  const payload = registryMatch
    ? {
        ...params.payload,
        catalogEvidence: buildChecklistRegistryCatalogEvidence(registryMatch),
        checklistRegistry: {
          ...existingChecklistRegistry,
          matched: true,
          identityId: registryMatch.identityId,
          fingerprintSha256: registryMatch.fingerprintSha256,
          score: registryMatch.score,
          trustedForKnowledge: true,
        },
        knowledgePromotionDecision: effectivePromotionDecision,
      }
    : {
        ...params.payload,
        catalogEvidence: quarantineInstaCompCatalogEvidence(
          params.payload.catalogEvidence,
          effectivePromotionDecision.reviewReasons,
        ),
        checklistRegistry: Object.keys(existingChecklistRegistry).length
          ? {
              ...existingChecklistRegistry,
              trustedForKnowledge: false,
            }
          : null,
        knowledgePromotionDecision: effectivePromotionDecision,
      };
''',
)

replace_once(
    "src/lib/instacomp-learning-server.ts",
    '''  const supabase = serviceClient();
  const { data, error } = await supabase.rpc(
    "tcos_instacomp_confirm_scan_knowledge",
    {
      p_scan_id: params.scanId,
      p_corrections: params.corrections,
      p_confirmation_status: params.status,
    },
  );

  if (error) throw new Error(error.message || "Could not confirm InstaComp knowledge.");
  return data;
}''',
    '''  const supabase = serviceClient();
  const { data: scan, error: scanError } = await supabase
    .from("instacomp_scans")
    .select("raw_ai_result,raw_comp_results")
    .eq("id", params.scanId)
    .maybeSingle();

  if (scanError) {
    throw new Error(scanError.message || "Could not load InstaComp scan evidence.");
  }
  if (!scan) throw new Error("InstaComp scan not found.");

  const rawCompResults = record(scan.raw_comp_results);
  const confirmationDecision = decideInstaCompOperatorConfirmation({
    payload: {
      ai: record(scan.raw_ai_result),
      consensus: record(rawCompResults.consensus),
      compSearchDecision: record(rawCompResults.compSearchDecision),
    },
    corrections: params.corrections,
    status: params.status,
  });

  if (!confirmationDecision.allowed) {
    const missing = confirmationDecision.missingCorrections.join(", ");
    throw new Error(
      `${confirmationDecision.explanation} Missing: ${missing}.`,
    );
  }

  const { data, error } = await supabase.rpc(
    "tcos_instacomp_confirm_scan_knowledge",
    {
      p_scan_id: params.scanId,
      p_corrections: params.corrections,
      p_confirmation_status: params.status,
    },
  );

  if (error) throw new Error(error.message || "Could not confirm InstaComp knowledge.");
  return data;
}''',
)

# Confirmation endpoint returns a client error for incomplete explicit identity evidence.
replace_once(
    "src/app/api/instacomp/knowledge/confirm/route.ts",
    '''    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not confirm InstaComp knowledge.",
      },
      { status: 500 },
    );''',
    '''    const message =
      error instanceof Error
        ? error.message
        : "Could not confirm InstaComp knowledge.";
    const status = message.startsWith(
      "Operator confirmation requires explicit corrected identity fields",
    )
      ? 400
      : 500;

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status },
    );''',
)

migration = r'''-- Fail-closed trust gate for InstaComp reusable learning.
-- Catalog and operator confirmations may not promote unresolved scanner guesses.

begin;

create or replace function public.tcos_instacomp_consensus_identity_trusted(
  p_consensus jsonb
)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_consensus->>'trustedForIdentity', 'false')) = 'true';
$$;

create or replace function public.tcos_instacomp_operator_identity_complete(
  p_corrections jsonb,
  p_ai jsonb
)
returns boolean
language sql
immutable
as $$
  select
    nullif(btrim(coalesce(p_corrections->>'player', '')), '') is not null
    and nullif(btrim(coalesce(p_corrections->>'year', '')), '') is not null
    and nullif(btrim(coalesce(p_corrections->>'brand', '')), '') is not null
    and nullif(btrim(coalesce(p_corrections->>'setName', '')), '') is not null
    and nullif(btrim(coalesce(p_corrections->>'cardNumber', '')), '') is not null
    and nullif(btrim(coalesce(p_corrections->>'parallel', '')), '') is not null
    and (
      nullif(btrim(coalesce(p_ai->>'serialNumber', '')), '') is null
      or nullif(btrim(coalesce(p_corrections->>'serialNumber', '')), '') is not null
    );
$$;

create or replace function public.tcos_instacomp_enforce_observation_identity_trust()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.confirmation_status = 'catalog_confirmed'
     and not (
       public.tcos_instacomp_consensus_identity_trusted(coalesce(new.consensus, '{}'::jsonb))
       and lower(coalesce(new.catalog_evidence->>'catalogConfirmed', 'false')) = 'true'
     ) then
    new.confirmation_status := 'scanner_observed';
  end if;

  if new.confirmation_status = 'operator_confirmed'
     and not public.tcos_instacomp_consensus_identity_trusted(coalesce(new.consensus, '{}'::jsonb))
     and not public.tcos_instacomp_operator_identity_complete(
       coalesce(new.operator_corrections, '{}'::jsonb),
       coalesce(new.ai_result, '{}'::jsonb)
     ) then
    new.confirmation_status := 'needs_more_info';
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.tcos_card_knowledge_observations') is not null then
    drop trigger if exists tcos_instacomp_observation_identity_trust_gate
      on public.tcos_card_knowledge_observations;
    create trigger tcos_instacomp_observation_identity_trust_gate
    before insert or update of confirmation_status, consensus, catalog_evidence,
      operator_corrections, ai_result
    on public.tcos_card_knowledge_observations
    for each row execute function public.tcos_instacomp_enforce_observation_identity_trust();
  end if;
end;
$$;

create or replace function public.tcos_instacomp_enforce_cache_identity_trust()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payload jsonb := coalesce(new.response_payload, '{}'::jsonb);
  v_consensus jsonb := coalesce(v_payload->'consensus', '{}'::jsonb);
  v_corrections jsonb := coalesce(v_payload->'operatorCorrections', '{}'::jsonb);
  v_ai jsonb := coalesce(v_payload->'ai', '{}'::jsonb);
begin
  if new.confirmation_status = 'catalog_confirmed'
     and not (
       public.tcos_instacomp_consensus_identity_trusted(v_consensus)
       and lower(coalesce(v_payload #>> '{catalogEvidence,catalogConfirmed}', 'false')) = 'true'
     ) then
    new.confirmation_status := 'scanner_observed';
  end if;

  if new.confirmation_status = 'operator_confirmed'
     and not public.tcos_instacomp_consensus_identity_trusted(v_consensus)
     and not public.tcos_instacomp_operator_identity_complete(v_corrections, v_ai) then
    new.confirmation_status := 'needs_more_info';
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.instacomp_scan_knowledge_cache') is not null then
    drop trigger if exists tcos_instacomp_cache_identity_trust_gate
      on public.instacomp_scan_knowledge_cache;
    create trigger tcos_instacomp_cache_identity_trust_gate
    before insert or update of confirmation_status, response_payload
    on public.instacomp_scan_knowledge_cache
    for each row execute function public.tcos_instacomp_enforce_cache_identity_trust();
  end if;
end;
$$;

create temporary table instacomp_learning_gate_impacted_entries (
  id uuid primary key
) on commit drop;

insert into instacomp_learning_gate_impacted_entries(id)
select distinct knowledge_entry_id
from public.tcos_card_knowledge_observations
where knowledge_entry_id is not null
  and (
    (
      confirmation_status = 'catalog_confirmed'
      and not (
        public.tcos_instacomp_consensus_identity_trusted(coalesce(consensus, '{}'::jsonb))
        and lower(coalesce(catalog_evidence->>'catalogConfirmed', 'false')) = 'true'
      )
    )
    or (
      confirmation_status = 'operator_confirmed'
      and not public.tcos_instacomp_consensus_identity_trusted(coalesce(consensus, '{}'::jsonb))
      and not public.tcos_instacomp_operator_identity_complete(
        coalesce(operator_corrections, '{}'::jsonb),
        coalesce(ai_result, '{}'::jsonb)
      )
    )
  )
on conflict do nothing;

update public.tcos_card_knowledge_observations
set confirmation_status = 'scanner_observed'
where confirmation_status = 'catalog_confirmed'
  and not (
    public.tcos_instacomp_consensus_identity_trusted(coalesce(consensus, '{}'::jsonb))
    and lower(coalesce(catalog_evidence->>'catalogConfirmed', 'false')) = 'true'
  );

update public.tcos_card_knowledge_observations
set confirmation_status = 'needs_more_info'
where confirmation_status = 'operator_confirmed'
  and not public.tcos_instacomp_consensus_identity_trusted(coalesce(consensus, '{}'::jsonb))
  and not public.tcos_instacomp_operator_identity_complete(
    coalesce(operator_corrections, '{}'::jsonb),
    coalesce(ai_result, '{}'::jsonb)
  );

update public.instacomp_scan_knowledge_cache
set confirmation_status = 'scanner_observed'
where confirmation_status = 'catalog_confirmed'
  and not (
    public.tcos_instacomp_consensus_identity_trusted(
      coalesce(response_payload->'consensus', '{}'::jsonb)
    )
    and lower(coalesce(response_payload #>> '{catalogEvidence,catalogConfirmed}', 'false')) = 'true'
  );

update public.instacomp_scan_knowledge_cache
set confirmation_status = 'needs_more_info'
where confirmation_status = 'operator_confirmed'
  and not public.tcos_instacomp_consensus_identity_trusted(
    coalesce(response_payload->'consensus', '{}'::jsonb)
  )
  and not public.tcos_instacomp_operator_identity_complete(
    coalesce(response_payload->'operatorCorrections', '{}'::jsonb),
    coalesce(response_payload->'ai', '{}'::jsonb)
  );

do $$
declare
  v_entry_id uuid;
begin
  for v_entry_id in
    select id from instacomp_learning_gate_impacted_entries
  loop
    perform public.tcos_instacomp_refresh_knowledge_entry(v_entry_id);
  end loop;
end;
$$;

revoke all on function public.tcos_instacomp_consensus_identity_trusted(jsonb)
  from public, anon, authenticated;
revoke all on function public.tcos_instacomp_operator_identity_complete(jsonb,jsonb)
  from public, anon, authenticated;
revoke all on function public.tcos_instacomp_enforce_observation_identity_trust()
  from public, anon, authenticated;
revoke all on function public.tcos_instacomp_enforce_cache_identity_trust()
  from public, anon, authenticated;
grant execute on function public.tcos_instacomp_consensus_identity_trusted(jsonb)
  to service_role;
grant execute on function public.tcos_instacomp_operator_identity_complete(jsonb,jsonb)
  to service_role;

commit;
'''
write(
    "supabase/migrations/20260801225000_instacomp_learning_identity_trust_gate.sql",
    migration,
)

ts_regression = r'''import { readFileSync } from "node:fs";
import {
  decideInstaCompLearningPromotion,
  decideInstaCompOperatorConfirmation,
} from "../src/lib/instacomp-learning-server";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const trustedPayload = {
  ai: {
    player: "Cam Ward",
    year: "2025",
    brand: "Panini",
    setName: "Origins",
    cardNumber: "107",
    parallel: "Gold",
    serialNumber: "17/199",
  },
  consensus: {
    trustedForIdentity: true,
    finalIdentity: { serialNumber: "17/199" },
  },
  compSearchDecision: { allowed: true },
  checklistRegistry: {
    matched: true,
    identityId: "origins-107-gold-199",
  },
  catalogEvidence: {
    status: "catalog_confirmed",
    catalogConfirmed: true,
    selectedMatch: { catalogId: "origins-107-gold-199" },
  },
};

const trustedPromotion = decideInstaCompLearningPromotion(trustedPayload);
assert(trustedPromotion.allowed, "Trusted exact identity should promote to reusable knowledge");

const untrustedPromotion = decideInstaCompLearningPromotion({
  ...trustedPayload,
  consensus: { trustedForIdentity: false },
  compSearchDecision: { allowed: false },
});
assert(!untrustedPromotion.allowed, "Untrusted identity must not promote");
assert(
  untrustedPromotion.reviewReasons.includes("consensus_identity_not_trusted"),
  "Expected consensus trust failure reason",
);

const mismatchedPromotion = decideInstaCompLearningPromotion({
  ...trustedPayload,
  catalogEvidence: {
    ...trustedPayload.catalogEvidence,
    selectedMatch: { catalogId: "different-registry-identity" },
  },
});
assert(!mismatchedPromotion.allowed, "Disagreeing catalog identities must quarantine");

const trustedOperator = decideInstaCompOperatorConfirmation({
  payload: trustedPayload,
  corrections: {},
  status: "operator_confirmed",
});
assert(trustedOperator.allowed, "Trusted identity may be owner-confirmed without retyping it");

const blockedOperator = decideInstaCompOperatorConfirmation({
  payload: {
    ...trustedPayload,
    consensus: { trustedForIdentity: false, finalIdentity: { serialNumber: "17/199" } },
    compSearchDecision: { allowed: false },
  },
  corrections: { player: "Cam Ward" },
  status: "operator_confirmed",
});
assert(!blockedOperator.allowed, "Untrusted identity requires complete explicit corrections");
assert(
  blockedOperator.missingCorrections.includes("serialNumber"),
  "Numbered cards require an explicit corrected serial number",
);

const explicitOperator = decideInstaCompOperatorConfirmation({
  payload: {
    ...trustedPayload,
    consensus: { trustedForIdentity: false, finalIdentity: { serialNumber: "17/199" } },
    compSearchDecision: { allowed: false },
  },
  corrections: {
    player: "Cam Ward",
    year: "2025",
    brand: "Panini",
    setName: "Origins",
    cardNumber: "107",
    parallel: "Gold",
    serialNumber: "17/199",
  },
  status: "operator_confirmed",
});
assert(explicitOperator.allowed, "Complete owner-entered identity may promote");

const scanRoute = readFileSync("src/app/api/instacomp/scan/route.ts", "utf8");
assert(
  scanRoute.includes("catalogEvidenceTrustedForLearning"),
  "Scan persistence must gate catalog evidence before automatic learning",
);
assert(
  scanRoute.includes("catalogCandidateEvidence"),
  "Rejected catalog evidence must remain candidate audit evidence",
);
assert(
  scanRoute.includes("consensus: input.consensus || null"),
  "Permanent scan ledger must retain consensus for database trust enforcement",
);
assert(
  scanRoute.includes("compSearchDecision: input.compSearchDecision || null"),
  "Permanent scan ledger must retain the comp-search identity decision",
);

console.log("InstaComp learning trust gate regressions passed (10 assertions).");
'''
write("scripts/run-instacomp-learning-trust-gate-regressions.ts", ts_regression)

sql_regression = r'''\set ON_ERROR_STOP on

begin;

insert into public.instacomp_scan_knowledge_cache (
  image_fingerprint,
  front_image_sha256,
  response_payload,
  confirmation_status
) values (
  'trust-gate-blocked-catalog',
  repeat('a', 64),
  '{"consensus":{"trustedForIdentity":false},"catalogEvidence":{"catalogConfirmed":true}}'::jsonb,
  'catalog_confirmed'
);

insert into public.instacomp_scan_knowledge_cache (
  image_fingerprint,
  front_image_sha256,
  response_payload,
  confirmation_status
) values (
  'trust-gate-trusted-catalog',
  repeat('b', 64),
  '{"consensus":{"trustedForIdentity":true},"catalogEvidence":{"catalogConfirmed":true}}'::jsonb,
  'catalog_confirmed'
);

insert into public.instacomp_scan_knowledge_cache (
  image_fingerprint,
  front_image_sha256,
  response_payload,
  confirmation_status
) values (
  'trust-gate-blocked-operator',
  repeat('c', 64),
  '{"consensus":{"trustedForIdentity":false},"ai":{"serialNumber":"17/199"},"operatorCorrections":{"player":"Cam Ward"}}'::jsonb,
  'operator_confirmed'
);

insert into public.instacomp_scan_knowledge_cache (
  image_fingerprint,
  front_image_sha256,
  response_payload,
  confirmation_status
) values (
  'trust-gate-explicit-operator',
  repeat('d', 64),
  '{"consensus":{"trustedForIdentity":false},"ai":{"serialNumber":"17/199"},"operatorCorrections":{"player":"Cam Ward","year":"2025","brand":"Panini","setName":"Origins","cardNumber":"107","parallel":"Gold","serialNumber":"17/199"}}'::jsonb,
  'operator_confirmed'
);

do $$
declare
  v_status text;
begin
  select confirmation_status into v_status
  from public.instacomp_scan_knowledge_cache
  where image_fingerprint = 'trust-gate-blocked-catalog';
  if v_status <> 'scanner_observed' then
    raise exception 'Unsafe catalog confirmation was not demoted: %', v_status;
  end if;

  select confirmation_status into v_status
  from public.instacomp_scan_knowledge_cache
  where image_fingerprint = 'trust-gate-trusted-catalog';
  if v_status <> 'catalog_confirmed' then
    raise exception 'Trusted catalog confirmation was incorrectly demoted: %', v_status;
  end if;

  select confirmation_status into v_status
  from public.instacomp_scan_knowledge_cache
  where image_fingerprint = 'trust-gate-blocked-operator';
  if v_status <> 'needs_more_info' then
    raise exception 'Incomplete operator confirmation was not quarantined: %', v_status;
  end if;

  select confirmation_status into v_status
  from public.instacomp_scan_knowledge_cache
  where image_fingerprint = 'trust-gate-explicit-operator';
  if v_status <> 'operator_confirmed' then
    raise exception 'Complete operator identity was incorrectly blocked: %', v_status;
  end if;
end;
$$;

rollback;
'''
write("scripts/verify-instacomp-learning-trust-gate.sql", sql_regression)

# Wire the migration and both regressions into the dedicated Postgres workflow.
replace_once(
    ".github/workflows/instacomp-learning-registry-postgres.yml",
    '''      - "supabase/migrations/20260801201000_checklist_registry_preserve_active_version.sql"
      - "src/lib/checklist-registry/**"''',
    '''      - "supabase/migrations/20260801201000_checklist_registry_preserve_active_version.sql"
      - "supabase/migrations/20260801225000_instacomp_learning_identity_trust_gate.sql"
      - "src/lib/checklist-registry/**"''',
)
replace_once(
    ".github/workflows/instacomp-learning-registry-postgres.yml",
    '''      - "scripts/verify-instacomp-learning-registry.sql"
      - ".github/workflows/instacomp-learning-registry-postgres.yml"''',
    '''      - "scripts/verify-instacomp-learning-registry.sql"
      - "scripts/verify-instacomp-learning-trust-gate.sql"
      - "scripts/run-instacomp-learning-trust-gate-regressions.ts"
      - ".github/workflows/instacomp-learning-registry-postgres.yml"''',
)
replace_once(
    ".github/workflows/instacomp-learning-registry-postgres.yml",
    '''      REGISTRY_PRESERVE_ACTIVE_VERSION_MIGRATION: supabase/migrations/20260801201000_checklist_registry_preserve_active_version.sql
''',
    '''      REGISTRY_PRESERVE_ACTIVE_VERSION_MIGRATION: supabase/migrations/20260801201000_checklist_registry_preserve_active_version.sql
      LEARNING_TRUST_GATE_MIGRATION: supabase/migrations/20260801225000_instacomp_learning_identity_trust_gate.sql
''',
)
replace_once(
    ".github/workflows/instacomp-learning-registry-postgres.yml",
    '''          psql -v ON_ERROR_STOP=1 --file "$REGISTRY_PRESERVE_ACTIVE_VERSION_MIGRATION"

      - name: Reapply additive migrations to prove idempotence''',
    '''          psql -v ON_ERROR_STOP=1 --file "$REGISTRY_PRESERVE_ACTIVE_VERSION_MIGRATION"
          psql -v ON_ERROR_STOP=1 --file "$LEARNING_TRUST_GATE_MIGRATION"

      - name: Reapply additive migrations to prove idempotence''',
)
replace_once(
    ".github/workflows/instacomp-learning-registry-postgres.yml",
    '''          psql -v ON_ERROR_STOP=1 --file "$REGISTRY_PRESERVE_ACTIVE_VERSION_MIGRATION"

      - name: Verify learning, trust, cache, backfill, and Registry transactions
        run: psql -v ON_ERROR_STOP=1 --file scripts/verify-instacomp-learning-registry.sql
''',
    '''          psql -v ON_ERROR_STOP=1 --file "$REGISTRY_PRESERVE_ACTIVE_VERSION_MIGRATION"
          psql -v ON_ERROR_STOP=1 --file "$LEARNING_TRUST_GATE_MIGRATION"

      - name: Verify learning, trust, cache, backfill, and Registry transactions
        run: |
          psql -v ON_ERROR_STOP=1 --file scripts/verify-instacomp-learning-registry.sql
          psql -v ON_ERROR_STOP=1 --file scripts/verify-instacomp-learning-trust-gate.sql
          npx tsx scripts/run-instacomp-learning-trust-gate-regressions.ts
''',
)

# The patcher must not appear in the final PR diff.
Path(__file__).unlink()

run(["git", "diff", "--check"])
run(["npx", "tsx", "scripts/run-instacomp-consensus-simulations.ts"])
run(["npx", "tsx", "scripts/run-instacomp-exact-market-proof-regressions.ts"])
run(["npx", "tsx", "scripts/run-instacomp-learning-trust-gate-regressions.ts"])
run([
    "npx",
    "eslint",
    "src/app/api/instacomp/scan/route.ts",
    "src/app/api/instacomp/scan-fast/route.ts",
    "src/app/api/instacomp/knowledge/confirm/route.ts",
    "src/lib/instacomp-learning-server.ts",
    "scripts/run-instacomp-learning-trust-gate-regressions.ts",
])
run(["npm", "run", "build"])
run(["git", "diff", "--check"])
run(["git", "status", "--short"])

run(["git", "add", "-A"])
run(["git", "commit", "-m", "Gate InstaComp learning on trusted identity"])
run(["git", "push", "-u", "origin", BRANCH])

existing = run(
    ["gh", "pr", "list", "--head", BRANCH, "--state", "open", "--json", "number", "--jq", ".[0].number"],
    capture=True,
    check=False,
).stdout.strip().splitlines()
pr_number = existing[-1].strip() if existing and existing[-1].strip().isdigit() else ""

if not pr_number:
    created = run(
        [
            "gh",
            "pr",
            "create",
            "--base",
            "main",
            "--head",
            BRANCH,
            "--title",
            "Gate InstaComp learning on trusted exact identity",
            "--body",
            "## What changed\n- automatic catalog learning now requires trusted consensus, an allowed comp-search decision, and matching checklist identity IDs\n- unresolved catalog evidence is quarantined as candidate evidence and cannot authorize exact comps, pricing, listings, or cache replay\n- owner confirmation of an untrusted scan requires a complete explicit identity, including serial number when present\n- database triggers demote unsafe catalog and operator confirmations in both observations and replayable cache rows\n- existing unsafe confirmation rows are demoted and affected knowledge entries are recalculated\n\n## Validation\n- consensus simulations\n- exact-market proof regressions\n- learning trust-gate TypeScript regressions\n- targeted ESLint\n- full Next.js production build\n- dedicated Postgres trust-gate regression in CI",
        ],
        capture=True,
    )
    for line in reversed(created.stdout.strip().splitlines()):
        if "/pull/" in line:
            pr_number = line.rsplit("/", 1)[-1]
            break

if not pr_number:
    raise RuntimeError("Could not determine pull request number")

print(f"Watching PR #{pr_number} checks...", flush=True)
run(["gh", "pr", "checks", pr_number, "--watch", "--interval", "10"])
run(["gh", "pr", "merge", pr_number, "--squash", "--delete-branch"])
run(["git", "switch", "main"])
run(["git", "pull", "--ff-only"])
run(["git", "status", "--short"])
run(["git", "log", "-1", "--oneline"])
print(f"DONE: PR #{pr_number} merged and local main synchronized.")
