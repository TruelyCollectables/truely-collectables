alter table public.tcos_card_knowledge_entries
  add column if not exists latest_submitted_by_account_id uuid
    references public.account_profiles(id) on delete set null,
  add column if not exists latest_submitted_by_actor_type text,
  add column if not exists latest_submitted_at timestamptz;

alter table public.tcos_card_knowledge_entries
  drop constraint if exists tcos_card_knowledge_entries_submitter_actor_check;

alter table public.tcos_card_knowledge_entries
  add constraint tcos_card_knowledge_entries_submitter_actor_check
    check (
      latest_submitted_by_actor_type is null
      or latest_submitted_by_actor_type in ('seller', 'admin')
    );

alter table public.tcos_card_knowledge_observations
  add column if not exists submitted_by_account_id uuid
    references public.account_profiles(id) on delete set null,
  add column if not exists submitted_by_actor_type text not null default 'admin',
  add column if not exists submitted_store_id uuid
    references public.stores(id) on delete set null;

alter table public.tcos_card_knowledge_observations
  drop constraint if exists tcos_card_knowledge_observations_submitter_actor_check;

alter table public.tcos_card_knowledge_observations
  add constraint tcos_card_knowledge_observations_submitter_actor_check
    check (submitted_by_actor_type in ('seller', 'admin'));

create index if not exists tcos_card_knowledge_entries_latest_submitter_idx
  on public.tcos_card_knowledge_entries(
    latest_submitted_by_account_id,
    latest_submitted_by_actor_type,
    updated_at desc
  );

create index if not exists tcos_card_knowledge_observations_submitter_idx
  on public.tcos_card_knowledge_observations(
    submitted_by_account_id,
    submitted_by_actor_type,
    observed_at desc
  );

create index if not exists tcos_card_knowledge_observations_store_submitter_idx
  on public.tcos_card_knowledge_observations(
    submitted_store_id,
    submitted_by_account_id,
    observed_at desc
  );
