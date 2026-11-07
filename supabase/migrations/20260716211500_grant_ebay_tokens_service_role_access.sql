grant usage on schema public to service_role;

grant select, insert, update, delete on table public.ebay_tokens
  to service_role;

do $$
begin
  if to_regclass('public.ebay_tokens_id_seq') is not null then
    grant usage, select, update on sequence public.ebay_tokens_id_seq
      to service_role;
  end if;
end $$;
