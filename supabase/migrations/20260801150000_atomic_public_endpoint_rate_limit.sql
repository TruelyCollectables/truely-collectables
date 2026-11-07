-- Atomic rate-limit decision and audit insert. Advisory locking prevents two
-- simultaneous requests from both passing a query-then-insert race.

create or replace function public.tcos_take_public_endpoint_rate_limit(
  p_store_id uuid,
  p_endpoint_key text,
  p_subject_key text,
  p_ip_address text,
  p_user_agent text,
  p_identity_risk text,
  p_identity_evidence jsonb,
  p_window_seconds integer,
  p_max_attempts integer,
  p_burst_window_seconds integer default null,
  p_burst_max_attempts integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_endpoint text := lower(left(btrim(coalesce(p_endpoint_key, 'unknown')), 120));
  v_subject text := nullif(lower(left(btrim(coalesce(p_subject_key, '')), 180)), '');
  v_ip text := lower(left(btrim(coalesce(p_ip_address, 'unknown')), 120));
  v_window integer := greatest(1, least(coalesce(p_window_seconds, 60), 86400 * 30));
  v_max integer := greatest(1, least(coalesce(p_max_attempts, 1), 100000));
  v_burst_window integer := case
    when p_burst_window_seconds is null then null
    else greatest(1, least(p_burst_window_seconds, v_window))
  end;
  v_burst_max integer := case
    when p_burst_max_attempts is null then null
    else greatest(1, least(p_burst_max_attempts, v_max))
  end;
  v_attempts integer := 0;
  v_burst_attempts integer := 0;
  v_oldest timestamptz;
  v_burst_oldest timestamptz;
  v_blocked boolean := false;
  v_reason text := null;
  v_retry_after integer := null;
  v_now timestamptz := clock_timestamp();
begin
  if p_store_id is null then
    raise exception 'Rate-limit store ID is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      concat_ws('|', p_store_id::text, v_endpoint, coalesce(v_subject, '∅'), v_ip),
      0
    )
  );

  select count(*)::integer, min(created_at)
  into v_attempts, v_oldest
  from public.public_endpoint_rate_limit_events
  where store_id = p_store_id
    and endpoint_key = v_endpoint
    and created_at >= v_now - make_interval(secs => v_window)
    and (
      (v_subject is not null and subject_key = v_subject)
      or ip_address = v_ip
    );

  if v_burst_window is not null and v_burst_max is not null then
    select count(*)::integer, min(created_at)
    into v_burst_attempts, v_burst_oldest
    from public.public_endpoint_rate_limit_events
    where store_id = p_store_id
      and endpoint_key = v_endpoint
      and created_at >= v_now - make_interval(secs => v_burst_window)
      and (
        (v_subject is not null and subject_key = v_subject)
        or ip_address = v_ip
      );
  end if;

  if v_attempts >= v_max then
    v_blocked := true;
    v_reason := 'too_many_attempts';
    v_retry_after := greatest(
      1,
      ceil(extract(epoch from ((v_oldest + make_interval(secs => v_window)) - v_now)))::integer
    );
  elsif v_burst_window is not null
        and v_burst_max is not null
        and v_burst_attempts >= v_burst_max then
    v_blocked := true;
    v_reason := 'burst_limit';
    v_retry_after := greatest(
      1,
      ceil(extract(epoch from ((v_burst_oldest + make_interval(secs => v_burst_window)) - v_now)))::integer
    );
  end if;

  insert into public.public_endpoint_rate_limit_events(
    store_id,
    endpoint_key,
    subject_key,
    ip_address,
    user_agent,
    blocked,
    block_reason,
    window_seconds,
    max_attempts,
    identity_risk,
    identity_evidence,
    created_at
  ) values (
    p_store_id,
    v_endpoint,
    v_subject,
    v_ip,
    left(coalesce(p_user_agent, ''), 1000),
    v_blocked,
    v_reason,
    v_window,
    v_max,
    left(coalesce(p_identity_risk, ''), 120),
    coalesce(p_identity_evidence, '{}'::jsonb),
    v_now
  );

  return jsonb_build_object(
    'allowed', not v_blocked,
    'reason', v_reason,
    'retryAfterSeconds', v_retry_after,
    'attemptsInWindow', v_attempts + 1,
    'maxAttempts', v_max,
    'windowSeconds', v_window,
    'burstAttempts', case
      when v_burst_window is null then null
      else v_burst_attempts + 1
    end,
    'burstMaxAttempts', v_burst_max,
    'burstWindowSeconds', v_burst_window
  );
end;
$$;

revoke all on function public.tcos_take_public_endpoint_rate_limit(
  uuid,text,text,text,text,text,jsonb,integer,integer,integer,integer
) from public, anon, authenticated;

grant execute on function public.tcos_take_public_endpoint_rate_limit(
  uuid,text,text,text,text,text,jsonb,integer,integer,integer,integer
) to service_role;
