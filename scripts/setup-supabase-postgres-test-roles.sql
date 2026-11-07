\set ON_ERROR_STOP on

-- Match the database role properties used by Supabase closely enough for
-- PostgreSQL integration tests. In particular, service_role bypasses RLS;
-- creating it as a plain NOLOGIN role makes owner-scoped fixtures invisible
-- to their own service-role reads and produces false null-ID failures.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  else
    alter role service_role bypassrls;
  end if;
end;
$$;
