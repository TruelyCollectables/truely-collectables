-- TCOS Market Intel™ market-observation permission repair
-- Grants the private server-side Supabase service role access to read and maintain
-- dated market observations while RLS remains enabled for all client-facing roles.

grant usage on schema public to service_role;

grant select, insert, update, delete
on table public.tcos_mi_market_observations
to service_role;

notify pgrst, 'reload schema';
