-- Preserve the currently active Checklist Registry version when a replacement
-- import requires validation. The previous version is superseded only after the
-- new import has completed without validation errors.

do $migration$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef(
    'public.tcos_apply_checklist_import_plan(jsonb,text,text,bigint,text,text,text)'::regprocedure
  )
  into v_definition;

  if v_definition ~* E'if\\s+v_previous_version_id\\s+is\\s+not\\s+null\\s+then\\s+update\\s+public\\.checklist_versions\\s+set\\s+is_active\\s*=\\s*false,\\s*status\\s*=\\s*''superseded''\\s+where\\s+id\\s*=\\s*v_previous_version_id;\\s+end\\s+if;' then
    v_patched := regexp_replace(
      v_definition,
      E'if\\s+v_previous_version_id\\s+is\\s+not\\s+null\\s+then\\s+update\\s+public\\.checklist_versions\\s+set\\s+is_active\\s*=\\s*false,\\s*status\\s*=\\s*''superseded''\\s+where\\s+id\\s*=\\s*v_previous_version_id;\\s+end\\s+if;',
      E'if v_error_count = 0 and v_previous_version_id is not null then\n    update public.checklist_versions\n    set is_active = false,\n        status = ''superseded''\n    where id = v_previous_version_id;\n  end if;',
      'i'
    );

    if v_patched = v_definition then
      raise exception
        'Could not patch Checklist Registry active-version preservation';
    end if;

    execute v_patched;
  end if;

  select pg_get_functiondef(
    'public.tcos_apply_checklist_import_plan(jsonb,text,text,bigint,text,text,text)'::regprocedure
  )
  into v_definition;

  if v_definition !~* E'if\\s+v_error_count\\s*=\\s*0\\s+and\\s+v_previous_version_id\\s+is\\s+not\\s+null\\s+then' then
    raise exception
      'Checklist Registry writer still supersedes the active version before successful validation';
  end if;
end;
$migration$;
