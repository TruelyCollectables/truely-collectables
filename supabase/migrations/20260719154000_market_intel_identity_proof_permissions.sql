begin;

grant usage on schema public to service_role;

grant select, insert, update, delete on table
  public.tcos_mi_search_candidates,
  public.tcos_mi_identity_proof_reviews
  to service_role;

notify pgrst, 'reload schema';

commit;
