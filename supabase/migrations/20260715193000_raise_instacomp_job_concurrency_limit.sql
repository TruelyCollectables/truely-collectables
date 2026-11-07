alter table public.instacomp_scan_jobs
  drop constraint if exists instacomp_scan_jobs_concurrency_check;

alter table public.instacomp_scan_jobs
  add constraint instacomp_scan_jobs_concurrency_check
  check (requested_concurrency between 1 and 12);
