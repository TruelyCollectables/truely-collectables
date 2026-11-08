\set ON_ERROR_STOP on

do $$
declare
  v_store uuid := '00000000-0000-4000-8000-000000000001';
  v_receipt jsonb;
  v_index integer;
begin
  delete from public.public_endpoint_rate_limit_events
  where store_id = v_store
    and endpoint_key like 'instacomp-hardening-%';

  v_receipt := public.tcos_take_public_endpoint_rate_limit(
    v_store,
    'instacomp-hardening-burst',
    'admin:test',
    '203.0.113.10',
    'hardening-test',
    'low',
    '{}'::jsonb,
    86400,
    250,
    60,
    2
  );
  if coalesce((v_receipt->>'allowed')::boolean, false) is not true then
    raise exception 'First atomic burst request was unexpectedly blocked: %', v_receipt;
  end if;

  v_receipt := public.tcos_take_public_endpoint_rate_limit(
    v_store,
    'instacomp-hardening-burst',
    'admin:test',
    '203.0.113.10',
    'hardening-test',
    'low',
    '{}'::jsonb,
    86400,
    250,
    60,
    2
  );
  if coalesce((v_receipt->>'allowed')::boolean, false) is not true then
    raise exception 'Second atomic burst request was unexpectedly blocked: %', v_receipt;
  end if;

  v_receipt := public.tcos_take_public_endpoint_rate_limit(
    v_store,
    'instacomp-hardening-burst',
    'admin:test',
    '203.0.113.10',
    'hardening-test',
    'low',
    '{}'::jsonb,
    86400,
    250,
    60,
    2
  );
  if coalesce((v_receipt->>'allowed')::boolean, true) is not false
     or v_receipt->>'reason' <> 'burst_limit' then
    raise exception 'Atomic burst limit did not block the third request: %', v_receipt;
  end if;

  -- Subject limits must survive an IP change rather than creating a new bucket.
  v_receipt := public.tcos_take_public_endpoint_rate_limit(
    v_store,
    'instacomp-hardening-subject',
    'seller:account-1',
    '203.0.113.20',
    'hardening-test',
    'low',
    '{}'::jsonb,
    3600,
    1,
    null,
    null
  );
  if coalesce((v_receipt->>'allowed')::boolean, false) is not true then
    raise exception 'First subject-scoped request was unexpectedly blocked: %', v_receipt;
  end if;

  v_receipt := public.tcos_take_public_endpoint_rate_limit(
    v_store,
    'instacomp-hardening-subject',
    'seller:account-1',
    '198.51.100.99',
    'hardening-test',
    'low',
    '{}'::jsonb,
    3600,
    1,
    null,
    null
  );
  if coalesce((v_receipt->>'allowed')::boolean, true) is not false
     or v_receipt->>'reason' <> 'too_many_attempts' then
    raise exception 'Changing IP bypassed the subject quota: %', v_receipt;
  end if;

  -- The max-attempt check and audit insert are one atomic operation. Exactly
  -- three requests pass a max of three; the fourth is blocked.
  for v_index in 1..4 loop
    v_receipt := public.tcos_take_public_endpoint_rate_limit(
      v_store,
      'instacomp-hardening-daily',
      'admin:daily',
      '203.0.113.30',
      'hardening-test',
      'low',
      '{}'::jsonb,
      86400,
      3,
      null,
      null
    );

    if v_index <= 3 and coalesce((v_receipt->>'allowed')::boolean, false) is not true then
      raise exception 'Daily request % was blocked too early: %', v_index, v_receipt;
    end if;
    if v_index = 4 and coalesce((v_receipt->>'allowed')::boolean, true) is not false then
      raise exception 'Fourth daily request bypassed the max: %', v_receipt;
    end if;
  end loop;
end;
$$;

select 'Atomic InstaComp quota and burst limits verified.' as result;
