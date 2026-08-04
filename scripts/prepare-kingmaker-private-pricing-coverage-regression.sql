-- Keep the synthetic coverage fixtures independent from the Registry's
-- canonical seeded sports while preserving all seeded foreign-key links.
update public.checklist_sports
set
  name = concat('Seed ', name),
  slug = concat('seed-', slug)
where slug in ('baseball', 'football', 'hockey', 'basketball');
