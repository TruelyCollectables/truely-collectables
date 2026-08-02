\set ON_ERROR_STOP on

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
  '{"consensus":{"trustedForIdentity":true},"compSearchDecision":{"allowed":true},"checklistRegistry":{"matched":true,"identityId":"registry-identity-1"},"catalogEvidence":{"status":"catalog_confirmed","catalogConfirmed":true,"selectedMatch":{"catalogId":"registry-identity-1"}}}'::jsonb,
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
