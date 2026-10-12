-- Seller-certified CSV authority. Additive: no existing rows rewritten.
create or replace function public.kingmaker_verified_csv_identity_guard()
returns trigger language plpgsql set search_path = '' as $$
declare old_ic jsonb; new_ic jsonb; k text;
begin
  if old.metadata #>> '{verifiedCsv,authority}' is distinct from 'seller_verified_csv_v1' then
    if TG_OP='DELETE' then return old; end if;
    return new;
  end if;
  if TG_OP='DELETE' then raise exception 'VERIFIED_CSV_IMMUTABLE: archive instead of delete'; end if;
  if (new.id,new.sku,new.title,new.category,new.condition,new.card_uuid,new.seller_account_id,new.store_id)
     is distinct from (old.id,old.sku,old.title,old.category,old.condition,old.card_uuid,old.seller_account_id,old.store_id)
  then raise exception 'VERIFIED_CSV_IMMUTABLE: card identity cannot change'; end if;
  foreach k in array array['verifiedCsv','verified_reference','identity','card_identity','sale_identity','collectible_asset','seller_review'] loop
    if new.metadata->k is distinct from old.metadata->k then
      raise exception 'VERIFIED_CSV_IMMUTABLE: verified metadata cannot change';
    end if;
  end loop;
  old_ic:=coalesce(old.metadata->'instacomp','{}'::jsonb);
  new_ic:=coalesce(new.metadata->'instacomp','{}'::jsonb);
  foreach k in array array['price','marketPrice','listingPrice','listingPriceSource','suggestedPrice','marketSummary','priceGuide','soldCompEvidence','activeCompetition','providerCoverage','pricingCheckedAt','pricingStatus','pricingReason','pricing','market','compEvidence','marketComp','marketSearch','pricingWorkOrder'] loop
    old_ic:=old_ic-k; new_ic:=new_ic-k;
  end loop;
  if old_ic is distinct from new_ic then raise exception 'VERIFIED_CSV_IMMUTABLE: identity and image receipt cannot change'; end if;
  return new;
end $$;
revoke all on function public.kingmaker_verified_csv_identity_guard() from public, anon, authenticated;
create trigger kingmaker_verified_csv_identity_lock before update or delete on public.inventory_items
for each row execute function public.kingmaker_verified_csv_identity_guard();

create or replace function public.kingmaker_verified_csv_image_guard()
returns trigger language plpgsql set search_path = '' as $$
declare item_id uuid; meta jsonb;
begin
  if TG_OP='DELETE' then item_id:=old.inventory_item_id; else item_id:=new.inventory_item_id; end if;
  select metadata into meta from public.inventory_items where id=item_id;
  if meta #>> '{verifiedCsv,authority}'='seller_verified_csv_v1' then
    if TG_OP='DELETE' then raise exception 'VERIFIED_CSV_IMMUTABLE: images cannot be deleted'; end if;
    if TG_OP='UPDATE' and to_jsonb(new) is distinct from to_jsonb(old) then
      raise exception 'VERIFIED_CSV_IMMUTABLE: images cannot change';
    end if;
    if TG_OP='INSERT' and not (
      (new.image_url=meta #>> '{instacomp,frontImageUrl}' and new.alt_text='Verified front' and new.sort_order=0 and new.is_primary)
      or (new.image_url=meta #>> '{instacomp,backImageUrl}' and new.alt_text='Verified back' and new.sort_order=1 and not new.is_primary)
    ) then raise exception 'VERIFIED_CSV_IMMUTABLE: only certified front and back images allowed'; end if;
  end if;
  if TG_OP='UPDATE' and old.inventory_item_id is distinct from new.inventory_item_id and exists(
    select 1 from public.inventory_items where id=old.inventory_item_id and metadata #>> '{verifiedCsv,authority}'='seller_verified_csv_v1'
  ) then raise exception 'VERIFIED_CSV_IMMUTABLE: image reassignment blocked'; end if;
  if TG_OP='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.kingmaker_verified_csv_image_guard() from public, anon, authenticated;
create trigger kingmaker_verified_csv_image_lock before insert or update or delete on public.inventory_images
for each row execute function public.kingmaker_verified_csv_image_guard();

create unique index kingmaker_verified_csv_external_id_idx on public.inventory_items (
  store_id,seller_account_id,(metadata #>> '{verifiedCsv,externalId}')
) where metadata #>> '{verifiedCsv,authority}'='seller_verified_csv_v1';
create unique index kingmaker_verified_csv_image_pair_idx on public.inventory_items (
  (metadata #>> '{instacomp,imagePairSha256}')
) where metadata #>> '{verifiedCsv,authority}'='seller_verified_csv_v1';

create or replace function public.kingmaker_mirror_verified_csv(p_owner uuid,p_store uuid,p_items jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item jsonb; existing public.inventory_items; meta jsonb; item_id uuid; total int:=0; side text; image_id uuid; image_url text; image_row public.inventory_images;
begin
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>200 then raise exception 'Expected at most 200 verified cards'; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    item_id:=(item->>'inventoryItemId')::uuid; meta:=item->'metadata';
    if meta #>> '{verifiedCsv,authority}'<>'seller_verified_csv_v1' or meta #>> '{verifiedCsv,ownerId}'<>p_owner::text
       or meta #>> '{instacomp,cardUuid}'<>item_id::text then raise exception 'Invalid verified authority or owner'; end if;
    insert into public.inventory_items(id,store_id,seller_account_id,card_uuid,sku,title,description,category,condition,status,quantity,price,metadata)
    values(item_id,p_store,p_owner,item_id,item->>'sku',item->>'title',item->>'description',item->>'category',item->>'condition','draft',1,0,meta)
    on conflict(id) do nothing;
    select * into existing from public.inventory_items where id=item_id for update;
    if existing.seller_account_id is distinct from p_owner or existing.store_id is distinct from p_store
       or existing.metadata #>> '{verifiedCsv,contentSha256}' is distinct from meta #>> '{verifiedCsv,contentSha256}'
    then raise exception 'Verified CSV mirror conflict; existing record preserved'; end if;
    foreach side in array array['front','back'] loop
      image_id:=md5(item_id::text||':verified-csv:'||side)::uuid;
      image_url:=meta #>> array['instacomp',side||'ImageUrl'];
      insert into public.inventory_images(id,inventory_item_id,image_url,alt_text,sort_order,is_primary)
      values(image_id,item_id,image_url,'Verified '||side,case when side='front' then 0 else 1 end,side='front')
      on conflict(id) do nothing;
      select * into image_row from public.inventory_images where id=image_id;
      if image_row.inventory_item_id<>item_id or image_row.image_url<>image_url then raise exception 'Verified image conflict'; end if;
    end loop;
    total:=total+1;
  end loop;
  return jsonb_build_object('ok',true,'mirrored',total,'queue','pending_listings');
end $$;
revoke all on function public.kingmaker_mirror_verified_csv(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.kingmaker_mirror_verified_csv(uuid,uuid,jsonb) to service_role;
create or replace function public.kingmaker_verified_csv_guard_ready()
returns boolean language sql security invoker set search_path='' as $$
 select count(*)=2 from pg_catalog.pg_trigger where tgname in ('kingmaker_verified_csv_identity_lock','kingmaker_verified_csv_image_lock') and tgenabled='O'
$$;
revoke all on function public.kingmaker_verified_csv_guard_ready() from public,anon,authenticated;
grant execute on function public.kingmaker_verified_csv_guard_ready() to service_role;
