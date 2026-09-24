create index if not exists tcos_kingmaker_rematch_checklist_version_idx
  on public.tcos_kingmaker_beckett_rematch_runs (checklist_version_id);

create index if not exists tcos_kingmaker_decisions_signal_idx
  on public.tcos_kingmaker_decisions (signal_id);

create index if not exists tcos_kingmaker_observations_source_run_idx
  on public.tcos_kingmaker_observations (source_run_id);

create index if not exists tcos_kingmaker_opportunities_identity_idx
  on public.tcos_kingmaker_opportunities (collectible_identity_id);

create index if not exists tcos_kingmaker_price_entries_high_observation_idx
  on public.tcos_kingmaker_price_entries (high_observation_id);

create index if not exists tcos_kingmaker_price_entries_import_run_idx
  on public.tcos_kingmaker_price_entries (import_run_id);

create index if not exists tcos_kingmaker_price_entries_low_observation_idx
  on public.tcos_kingmaker_price_entries (low_observation_id);

create index if not exists tcos_kingmaker_price_pages_import_run_idx
  on public.tcos_kingmaker_price_pages (import_run_id);

create index if not exists tcos_kingmaker_price_review_queue_entry_idx
  on public.tcos_kingmaker_price_review_queue (entry_id);

create index if not exists tcos_kingmaker_price_review_queue_guide_idx
  on public.tcos_kingmaker_price_review_queue (guide_id);

create index if not exists tcos_kingmaker_signal_evidence_observation_idx
  on public.tcos_kingmaker_signal_evidence (observation_id);
