-- Restore the Checklist Registry identity uniqueness contract on production
-- schemas that predate the final core-table constraint.
--
-- The transactional writer intentionally uses:
--   ON CONFLICT (identity_schema, fingerprint_sha256) DO NOTHING
-- Production must therefore expose a non-partial unique index over exactly those
-- two columns. Preserve the oldest identity row, repoint every single-column FK
-- that references checklist_card_identities(id), and delete only redundant IDs.

do $$
declare
  duplicate_group record;
  fk record;
  keeper_id uuid;
  duplicate_ids uuid[];
  identity_id_attnum smallint;
  unsupported_fk_count integer;
begin
  if to_regclass('public.checklist_card_identities') is null then
    raise exception 'checklist_card_identities is missing';
  end if;

  select attnum into identity_id_attnum
  from pg_attribute
  where attrelid = 'public.checklist_card_identities'::regclass
    and attname = 'id'
    and not attisdropped;

  if identity_id_attnum is null then
    raise exception 'checklist_card_identities.id is missing';
  end if;

  select count(*) into unsupported_fk_count
  from pg_constraint constraint_row
  where constraint_row.contype = 'f'
    and constraint_row.confrelid = 'public.checklist_card_identities'::regclass
    and identity_id_attnum = any(constraint_row.confkey)
    and (
      array_length(constraint_row.conkey, 1) <> 1
      or array_length(constraint_row.confkey, 1) <> 1
    );

  if unsupported_fk_count > 0 then
    raise exception 'Checklist identity repair found % unsupported composite foreign keys', unsupported_fk_count;
  end if;

  for duplicate_group in
    select
      identity_schema,
      fingerprint_sha256,
      array_agg(id order by created_at, id) as identity_ids
    from public.checklist_card_identities
    group by identity_schema, fingerprint_sha256
    having count(*) > 1
  loop
    keeper_id := duplicate_group.identity_ids[1];
    duplicate_ids := array_remove(duplicate_group.identity_ids, keeper_id);

    for fk in
      select
        format('%I.%I', child_namespace.nspname, child_table.relname) as child_relation,
        child_column.attname as child_column
      from pg_constraint constraint_row
      join pg_class child_table
        on child_table.oid = constraint_row.conrelid
      join pg_namespace child_namespace
        on child_namespace.oid = child_table.relnamespace
      join pg_attribute child_column
        on child_column.attrelid = constraint_row.conrelid
       and child_column.attnum = constraint_row.conkey[1]
      where constraint_row.contype = 'f'
        and constraint_row.confrelid = 'public.checklist_card_identities'::regclass
        and array_length(constraint_row.conkey, 1) = 1
        and array_length(constraint_row.confkey, 1) = 1
        and constraint_row.confkey[1] = identity_id_attnum
    loop
      execute format(
        'update %s set %I = $1 where %I = any($2)',
        fk.child_relation,
        fk.child_column,
        fk.child_column
      ) using keeper_id, duplicate_ids;
    end loop;

    delete from public.checklist_card_identities
    where id = any(duplicate_ids);
  end loop;
end;
$$;

create unique index if not exists checklist_card_identities_schema_fingerprint_repair_unique
  on public.checklist_card_identities(identity_schema, fingerprint_sha256);

-- Prove both explicit ON CONFLICT targets used by the transactional writer are
-- backed by non-partial unique indexes before the workflow can proceed.
do $$
declare
  identity_schema_attnum smallint;
  fingerprint_attnum smallint;
  release_id_attnum smallint;
  source_type_attnum smallint;
  source_url_attnum smallint;
begin
  select attnum into identity_schema_attnum
  from pg_attribute
  where attrelid = 'public.checklist_card_identities'::regclass
    and attname = 'identity_schema'
    and not attisdropped;
  select attnum into fingerprint_attnum
  from pg_attribute
  where attrelid = 'public.checklist_card_identities'::regclass
    and attname = 'fingerprint_sha256'
    and not attisdropped;

  if not exists (
    select 1
    from pg_index index_row
    where index_row.indrelid = 'public.checklist_card_identities'::regclass
      and index_row.indisunique
      and index_row.indpred is null
      and index_row.indexprs is null
      and index_row.indnkeyatts = 2
      and index_row.indkey::text = format('%s %s', identity_schema_attnum, fingerprint_attnum)
  ) then
    raise exception 'Checklist identity ON CONFLICT target still lacks an exact unique index';
  end if;

  select attnum into release_id_attnum
  from pg_attribute
  where attrelid = 'public.checklist_release_sources'::regclass
    and attname = 'release_id'
    and not attisdropped;
  select attnum into source_type_attnum
  from pg_attribute
  where attrelid = 'public.checklist_release_sources'::regclass
    and attname = 'source_type'
    and not attisdropped;
  select attnum into source_url_attnum
  from pg_attribute
  where attrelid = 'public.checklist_release_sources'::regclass
    and attname = 'source_url'
    and not attisdropped;

  if not exists (
    select 1
    from pg_index index_row
    where index_row.indrelid = 'public.checklist_release_sources'::regclass
      and index_row.indisunique
      and index_row.indpred is null
      and index_row.indexprs is null
      and index_row.indnkeyatts = 3
      and index_row.indkey::text = format('%s %s %s', release_id_attnum, source_type_attnum, source_url_attnum)
  ) then
    raise exception 'Checklist release-source ON CONFLICT target still lacks an exact unique index';
  end if;

  perform pg_notify('pgrst', 'reload schema');
end;
$$;
