begin;

-- Seller disconnects run only through authenticated server routes. Browser roles
-- remain unable to read or mutate encrypted marketplace credentials directly.
revoke delete on table public.seller_marketplace_connection_tokens
  from anon, authenticated;

grant delete on table public.seller_marketplace_connection_tokens
  to service_role;

commit;
