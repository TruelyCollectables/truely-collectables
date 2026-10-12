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
  foreach k in array array['price','marketPrice','listingPrice','listingPriceSource','suggestedPrice','marketSummary','priceGuide','soldCompEvidence','activeCompetition','providerCoverage','pricingCheckedAt','pricingStatus','pricingReason','pricing','market','compEvidence','marketComp','marketSearch','pricingWorkOrder','pricingAnalysis','pricingGroupBasePrice','pricingChosenAt','pricingGroupKey','commercialQuantity','commercialKeeperInventoryItemId'] loop
    old_ic:=old_ic-k; new_ic:=new_ic-k;
  end loop;
  if old_ic is distinct from new_ic then raise exception 'VERIFIED_CSV_IMMUTABLE: identity and image receipt cannot change'; end if;
  return new;
end $$;

create or replace function public.kingmaker_verified_csv_product_guard()
returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.inventory_items i where i.legacy_product_id=old.id and i.metadata #>> '{verifiedCsv,authority}'='seller_verified_csv_v1') then
   if TG_OP='DELETE' then raise exception 'VERIFIED_CSV_IMMUTABLE: linked verified product cannot be deleted'; end if;
   if (new.sku,new.title,new.player,new.sport,new.image_url) is distinct from (old.sku,old.title,old.player,old.sport,old.image_url)
   then raise exception 'VERIFIED_CSV_IMMUTABLE: linked product identity and image cannot change'; end if;
 end if;
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.kingmaker_verified_csv_product_guard() from public,anon,authenticated;
create trigger kingmaker_verified_csv_product_lock before update or delete on public.products
for each row execute function public.kingmaker_verified_csv_product_guard();
