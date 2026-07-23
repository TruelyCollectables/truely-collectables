-- Authoritative TCOS Market Intel Beta One ledger snapshot as of 2026-07-23.
-- Idempotent by BETA1 portfolio_id. Re-running this seed will not create duplicate buys.
-- Do not re-run after the production Portfolio Manager becomes the authoritative ledger
-- unless this snapshot is intentionally being used for reconciliation.

insert into public.tcos_acquisition_lots (
  id, portfolio_id, source, source_url, source_item_id, order_number,
  purchased_at, received_at, seller_name, quantity, remaining_quantity,
  delivered_cost, exact_unit_cost, remaining_cost_basis, status, notes
) values
  ('00000000-0000-4000-8000-000000000001','BETA1-LOT-001','eBay','https://www.ebay.com/itm/137259435746','137259435746',null,'2026-07-17T12:00:00Z',null,null,50,50,37.00,0.74000000,37.00,'awaiting_receipt','Ivan Demidov 2026 Upper Deck National Hockey Card Day Rookie Moments #NHCD-31, raw.'),
  ('00000000-0000-4000-8000-000000000002','BETA1-LOT-002','eBay','https://www.ebay.com/itm/147279828212','147279828212',null,'2026-07-20T12:00:00Z',null,null,100,100,61.83,0.61830000,61.83,'awaiting_receipt','Separate acquisition lot of the same Ivan Demidov NHCD-31; do not merge with BETA1-LOT-001.'),
  ('00000000-0000-4000-8000-000000000003','BETA1-LOT-003','eBay',null,null,null,'2026-07-22T12:00:00Z','2026-07-22T12:00:00Z',null,1,1,22.20,22.20000000,22.20,'in_inventory','Ivan Demidov 2025-26 OPC Platinum Marquee Rookies Rainbow #232, raw.'),
  ('00000000-0000-4000-8000-000000000004','BETA1-LOT-004','eBay',null,null,null,'2026-07-22T12:00:00Z','2026-07-22T12:00:00Z',null,1,1,18.16,18.16000000,18.16,'in_inventory','Separate purchase of the same Demidov Rainbow #232; not a duplicate.'),
  ('00000000-0000-4000-8000-000000000005','BETA1-LOT-005','eBay',null,null,null,'2026-07-22T12:00:00Z','2026-07-22T12:00:00Z',null,5,5,25.68,5.13600000,25.68,'in_inventory','Ivan Demidov 2025-26 OPC Platinum Marquee Rookies base #232, raw lot of five.'),
  ('00000000-0000-4000-8000-000000000006','BETA1-LOT-006','eBay',null,null,null,'2026-07-22T12:00:00Z','2026-07-22T12:00:00Z',null,1,1,12.54,12.54000000,12.54,'in_inventory','Ivan Demidov 2025-26 OPC Platinum Retro Rookies Rainbow #R-66, raw.'),
  ('00000000-0000-4000-8000-000000000007','BETA1-LOT-007','Mercari','https://www.mercari.com/us/item/m31722434561/','m31722434561',null,'2026-07-22T12:00:00Z',null,null,10,10,7.51,0.75100000,7.51,'awaiting_receipt','Rickea Jackson 10-card lot. Preliminary identities require back/condition verification after receipt.'),
  ('00000000-0000-4000-8000-000000000008','BETA1-LOT-008','eBay','https://www.ebay.com/itm/336684821180','336684821180',null,'2026-07-19T12:00:00Z',null,null,1,1,3.51,3.51000000,3.51,'awaiting_receipt','Seller-described Sonia Citron 2025 Select WNBA Silver RC; seller card number #122. Verify back.'),
  ('00000000-0000-4000-8000-000000000009','BETA1-LOT-009','eBay','https://www.ebay.com/itm/366538797875','366538797875',null,'2026-07-19T12:00:00Z',null,null,1,1,3.14,3.14000000,3.14,'awaiting_receipt','Seller-described Sonia Citron 2025 Prizm WNBA Blue Velocity RC; title says #122, checklist may indicate #148. Verify back.'),
  ('00000000-0000-4000-8000-000000000010','BETA1-LOT-010','eBay','https://www.ebay.com/itm/168531327336','168531327336',null,'2026-07-21T12:00:00Z',null,null,1,1,20.56,20.56000000,20.56,'awaiting_receipt','Sonia Citron 2025 Prizm WNBA #122 WNBA Logo Prizm RC; verify back.'),
  ('00000000-0000-4000-8000-000000000011','BETA1-LOT-011','eBay','https://www.ebay.com/itm/127860727210','127860727210',null,'2026-07-18T12:00:00Z',null,null,1,1,8.25,8.25000000,8.25,'awaiting_receipt','Dillon Head 2023 Bowman Draft Chrome Prospect Autographs #CDA-DHE, raw auto.'),
  ('00000000-0000-4000-8000-000000000012','BETA1-LOT-012','eBay','https://www.ebay.com/itm/236931858995','236931858995',null,'2026-07-18T12:00:00Z',null,null,1,1,5.02,5.02000000,5.02,'awaiting_receipt','Seller-described Dillon Head 2023 Bowman Draft Lava Refractor autograph, code BGA-DH, serial 29/75. Verify back.'),
  ('00000000-0000-4000-8000-000000000013','BETA1-LOT-013','eBay','https://www.ebay.com/itm/137475897149','137475897149',null,'2026-07-18T12:00:00Z',null,null,1,1,7.32,7.32000000,7.32,'awaiting_receipt','Seller-described Dylan Samberg 2022-23 Upper Deck Stature Wunderkind Autographs Green #W-27, 25/25. Verify back/serial.'),
  ('00000000-0000-4000-8000-000000000014','BETA1-LOT-014','eBay',null,null,'15-14926-03524','2026-07-23T15:10:00Z',null,'justincrediblecollects',20,20,32.38,1.61900000,32.38,'awaiting_receipt','2025 Panini Prizm WNBA 20-card Ice/Blue Velocity lot. Seven solid blue cards confirmed Blue Velocity, not /199.'),
  ('00000000-0000-4000-8000-000000000015','BETA1-LOT-015','eBay','https://www.ebay.com/itm/206423775401','206423775401','13-14930-31876','2026-07-23T17:07:00Z',null,'shackfu34',92,92,33.57,0.36489130,33.57,'awaiting_receipt','2025-26 WNBA Panini mixer. Listing photos overlap; do not double-count. Photo identities remain provisional until receipt/back verification.')
on conflict (portfolio_id) do update set
  source = excluded.source,
  source_url = excluded.source_url,
  source_item_id = excluded.source_item_id,
  order_number = excluded.order_number,
  seller_name = excluded.seller_name,
  quantity = excluded.quantity,
  delivered_cost = excluded.delivered_cost,
  exact_unit_cost = excluded.exact_unit_cost,
  notes = excluded.notes,
  updated_at = now();

-- One summarized acquisition item per known exact position. These deterministic IDs keep the seed idempotent.
insert into public.tcos_acquisition_items (id, lot_id, identity, identity_key, quantity, allocated_cost, status, notes) values
  ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','{"sport":"hockey","player":"Ivan Demidov","year":"2026","manufacturer":"Upper Deck","product":"National Hockey Card Day","subset":"Rookie Moments","cardNumber":"NHCD-31","rawOrGraded":"raw"}'::jsonb,'2026 upper deck national hockey card day rookie moments ivan demidov nhcd 31 no auto no mem raw',50,37.00,'awaiting_receipt',null),
  ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','{"sport":"hockey","player":"Ivan Demidov","year":"2026","manufacturer":"Upper Deck","product":"National Hockey Card Day","subset":"Rookie Moments","cardNumber":"NHCD-31","rawOrGraded":"raw"}'::jsonb,'2026 upper deck national hockey card day rookie moments ivan demidov nhcd 31 no auto no mem raw',100,61.83,'awaiting_receipt','Separate acquisition lot.'),
  ('10000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003','{"sport":"hockey","player":"Ivan Demidov","year":"2025-26","manufacturer":"O-Pee-Chee","product":"Platinum","subset":"Marquee Rookies","cardNumber":"232","parallel":"Rainbow","rawOrGraded":"raw"}'::jsonb,'2025 26 o pee chee platinum marquee rookies ivan demidov 232 rainbow no auto no mem raw',1,22.20,'in_inventory',null),
  ('10000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000004','{"sport":"hockey","player":"Ivan Demidov","year":"2025-26","manufacturer":"O-Pee-Chee","product":"Platinum","subset":"Marquee Rookies","cardNumber":"232","parallel":"Rainbow","rawOrGraded":"raw"}'::jsonb,'2025 26 o pee chee platinum marquee rookies ivan demidov 232 rainbow no auto no mem raw',1,18.16,'in_inventory','Separate purchase, not duplicate.'),
  ('10000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000005','{"sport":"hockey","player":"Ivan Demidov","year":"2025-26","manufacturer":"O-Pee-Chee","product":"Platinum","subset":"Marquee Rookies","cardNumber":"232","parallel":"Base","rawOrGraded":"raw"}'::jsonb,'2025 26 o pee chee platinum marquee rookies ivan demidov 232 base no auto no mem raw',5,25.68,'in_inventory',null),
  ('10000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000006','{"sport":"hockey","player":"Ivan Demidov","year":"2025-26","manufacturer":"O-Pee-Chee","product":"Platinum","subset":"Retro Rookies","cardNumber":"R-66","parallel":"Rainbow","rawOrGraded":"raw"}'::jsonb,'2025 26 o pee chee platinum retro rookies ivan demidov r 66 rainbow no auto no mem raw',1,12.54,'in_inventory',null),
  ('10000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000007','{"sport":"basketball","player":"Rickea Jackson","year":"2024-2025","manufacturer":"Panini","product":"Mixed WNBA lot","rawOrGraded":"raw"}'::jsonb,'2024 2025 panini mixed wnba lot rickea jackson no auto no mem raw',10,7.51,'awaiting_receipt','Component identities provisional.'),
  ('10000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000008','{"sport":"basketball","player":"Sonia Citron","year":"2025","manufacturer":"Panini","product":"Select WNBA","cardNumber":"122","parallel":"Seller-described Silver","rawOrGraded":"raw"}'::jsonb,'2025 panini select wnba sonia citron 122 seller described silver no auto no mem raw',1,3.51,'awaiting_receipt','Verify exact number and Silver identity.'),
  ('10000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000009','{"sport":"basketball","player":"Sonia Citron","year":"2025","manufacturer":"Panini","product":"Prizm WNBA","cardNumber":"122 provisional","parallel":"Blue Velocity","rawOrGraded":"raw"}'::jsonb,'2025 panini prizm wnba sonia citron 122 provisional blue velocity no auto no mem raw',1,3.14,'awaiting_receipt','May be card #148; verify back.'),
  ('10000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000010','{"sport":"basketball","player":"Sonia Citron","year":"2025","manufacturer":"Panini","product":"Prizm WNBA","cardNumber":"122","parallel":"WNBA Logo Prizm","rawOrGraded":"raw"}'::jsonb,'2025 panini prizm wnba sonia citron 122 wnba logo prizm no auto no mem raw',1,20.56,'awaiting_receipt','Verify back.'),
  ('10000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000011','{"sport":"baseball","player":"Dillon Head","year":"2023","manufacturer":"Bowman","product":"Bowman Draft Chrome","subset":"Chrome Prospect Autographs","cardNumber":"CDA-DHE","autograph":true,"rawOrGraded":"raw"}'::jsonb,'2023 bowman bowman draft chrome chrome prospect autographs dillon head cda dhe auto no mem raw',1,8.25,'awaiting_receipt',null),
  ('10000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000012','{"sport":"baseball","player":"Dillon Head","year":"2023","manufacturer":"Bowman","product":"Bowman Draft","cardNumber":"BGA-DH provisional","parallel":"Lava Refractor","serialTier":"/75","serialNumber":"29/75","autograph":true,"rawOrGraded":"raw"}'::jsonb,'2023 bowman bowman draft dillon head bga dh provisional lava refractor 75 29 75 auto no mem raw',1,5.02,'awaiting_receipt','Verify exact code and Lava identity.'),
  ('10000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000013','{"sport":"hockey","player":"Dylan Samberg","year":"2022-23","manufacturer":"Upper Deck","product":"Stature","subset":"Wunderkind Autographs","cardNumber":"W-27","parallel":"Green","serialTier":"/25","serialNumber":"25/25","autograph":true,"rawOrGraded":"raw"}'::jsonb,'2022 23 upper deck stature wunderkind autographs dylan samberg w 27 green 25 25 25 auto no mem raw',1,7.32,'awaiting_receipt','Verify back and serial.'),
  ('10000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000014','{"sport":"basketball","year":"2025","manufacturer":"Panini","product":"Prizm WNBA","parallel":"Ice and Blue Velocity mixed lot","rawOrGraded":"raw"}'::jsonb,'2025 panini prizm wnba ice and blue velocity mixed lot no auto no mem raw',20,32.38,'awaiting_receipt','Individual components provisional until receipt.'),
  ('10000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000015','{"sport":"basketball","year":"2025-26","manufacturer":"Panini","product":"WNBA mixer","rawOrGraded":"raw"}'::jsonb,'2025 26 panini wnba mixer no auto no mem raw',92,33.57,'awaiting_receipt','Listing images overlap; exact component inventory remains provisional.')
on conflict (id) do nothing;

-- Reconciliation assertion: this snapshot must total 15 lots, 286 cards, and $298.67.
do $$
declare
  v_lots integer;
  v_cards integer;
  v_cost numeric(12,2);
begin
  select count(*), sum(quantity), sum(delivered_cost)
  into v_lots, v_cards, v_cost
  from public.tcos_acquisition_lots
  where portfolio_id like 'BETA1-LOT-%';

  if v_lots <> 15 or v_cards <> 286 or v_cost <> 298.67 then
    raise exception 'Beta One seed reconciliation failed: lots %, cards %, cost %', v_lots, v_cards, v_cost;
  end if;
end $$;
