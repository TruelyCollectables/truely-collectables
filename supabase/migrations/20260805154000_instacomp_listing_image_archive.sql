-- Permanent public image storage for front/back photos recovered from the
-- authenticated Mac-local InstaComp scan archive. Objects are written only by
-- trusted service-role routes and are intentionally public for storefront and
-- marketplace listing delivery.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'instacomp-listing-images',
  'instacomp-listing-images',
  true,
  12582912,
  array['image/jpeg']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
