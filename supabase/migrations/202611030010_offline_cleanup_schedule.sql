-- Phase 10 (D-OF3): the daily cleanup of duplicate-protection records,
-- prepared but NOT switched on. Nothing in this migration schedules a job.
--
-- prune_offline_records() (202611030009) deletes finished request records
-- older than 90 days. Queued offline changes expire after 30 days, so any
-- request old enough to be deleted is also too old to be applied: if a phone
-- ever sends it again, check_offline_age refuses it (OFEXP) before anything is
-- saved. Requests still marked pending are never deleted.
--
-- To switch it on, after Jac's approval, on a project where the pg_cron
-- extension is enabled (Supabase: Database > Extensions), run as the project
-- owner in the SQL editor:
--     select public.enable_offline_cleanup_schedule();
-- To switch it off:
--     select public.disable_offline_cleanup_schedule();

create or replace function public.enable_offline_cleanup_schedule()
returns text
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'pg_cron is not enabled on this database. Enable it first (Supabase: Database > Extensions).';
  end if;
  -- Every day at 03:15 Manila time (19:15 UTC), when nobody is working.
  -- cron.schedule replaces a job with the same name, so running this twice is safe.
  execute $sql$select cron.schedule('meah-prune-offline-records', '15 19 * * *', 'select public.prune_offline_records()')$sql$;
  return 'Scheduled meah-prune-offline-records daily at 19:15 UTC (03:15 Manila)';
end;
$$;

create or replace function public.disable_offline_cleanup_schedule()
returns text
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return 'pg_cron is not enabled; nothing is scheduled';
  end if;
  execute $sql$select cron.unschedule(jobid) from cron.job where jobname = 'meah-prune-offline-records'$sql$;
  return 'Unscheduled meah-prune-offline-records';
end;
$$;

-- Only the database owner runs these, by hand. The app cannot.
revoke all on function public.enable_offline_cleanup_schedule() from public, anon, authenticated, service_role;
revoke all on function public.disable_offline_cleanup_schedule() from public, anon, authenticated, service_role;
