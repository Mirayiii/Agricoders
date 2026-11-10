-- Fixes found in the Phases 0 to 10 integration review (4 November 2026).
--
-- 1. generate_upcoming_notifications() could be called without signing in.
--    Supabase grants new functions to anon by default, and the earlier
--    "revoke ... from public" does not remove that grant. Signed out, the
--    function skipped its account check (it allows a missing user so a
--    scheduled job can run it) and wrote reminder notifications. It now needs
--    a signed-in account; scheduled jobs run as the database owner or
--    service_role, which keep access.
revoke execute on function public.generate_upcoming_notifications() from anon;
grant execute on function public.generate_upcoming_notifications() to authenticated, service_role;

-- 2. Recording refused offline changes (D-OF4) failed for everyone except
--    administrators. The app sends them with "ignore duplicates" (INSERT ...
--    ON CONFLICT DO NOTHING) so a half-sent report can be sent again, and
--    PostgreSQL only allows that when the person may also read the rows they
--    write. People may now read their own rows; only administrators see
--    everyone's.
drop policy if exists "own_sync_rejections_read" on public.sync_rejections;
create policy "own_sync_rejections_read" on public.sync_rejections
  for select to authenticated using (user_id = auth.uid());

-- 3. A pruned request can never run again (D-OF3, raised by Jac on 4 November
--    2026). The 30-day limit uses queued_at, which the phone sends, so a
--    modified client could send an old request id with a new time after its
--    duplicate-protection record was pruned at 90 days, and an order could be
--    created twice. Pruning now keeps a small permanent record of the request
--    id (no arguments or results), and every request id is checked against it
--    on the server first, before the phone's time is looked at. A request id
--    that ever ran is refused for good, whatever time is sent with it.
--    Size: one short row per change, kept until a reliable expiry exists
--    (for example request ids that carry a server-signed time).
create table if not exists public.mutation_request_tombstones (
  user_id uuid not null,
  request_id uuid not null,
  rpc_name text not null,
  completed_at timestamptz,
  pruned_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table public.mutation_request_tombstones enable row level security;
revoke all on table public.mutation_request_tombstones from public, anon, authenticated;

create or replace function public.begin_client_request(p_rpc text, p_request_id uuid, p_args jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.mutation_requests;
  v_hash text := md5(coalesce(p_args, '{}'::jsonb)::text);
begin
  if p_request_id is null then
    raise exception 'A request id is required' using errcode = '22023';
  end if;
  -- Checked first, so no time sent by the phone can get past it.
  if exists (select 1 from public.mutation_request_tombstones t where t.user_id = auth.uid() and t.request_id = p_request_id) then
    raise exception 'This change was already applied more than 90 days ago, so it was not applied again.' using errcode = 'OFEXP';
  end if;
  insert into public.mutation_requests (user_id, request_id, rpc_name, args_hash)
  values (auth.uid(), p_request_id, p_rpc, v_hash)
  on conflict (user_id, request_id) do nothing;
  if found then
    return null;
  end if;
  select * into v_row from public.mutation_requests m
    where m.user_id = auth.uid() and m.request_id = p_request_id;
  if v_row.rpc_name <> p_rpc or v_row.args_hash <> v_hash then
    raise exception 'request_id_reused' using errcode = 'P0001';
  end if;
  return coalesce(v_row.result, '{}'::jsonb) || jsonb_build_object('replayed', true);
end;
$$;
revoke all on function public.begin_client_request(text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.prune_offline_records()
returns integer language plpgsql security definer set search_path = public as $$
declare v_deleted integer;
begin
  -- Only finished requests; a pending one (a multi-step change that stopped
  -- part way) is kept so a retry can continue it. Each removed request leaves
  -- its id behind, so it can never run again.
  with gone as (
    delete from public.mutation_requests
      where status = 'done' and coalesce(completed_at, created_at) < now() - interval '90 days'
      returning user_id, request_id, rpc_name, completed_at
  )
  insert into public.mutation_request_tombstones (user_id, request_id, rpc_name, completed_at)
    select user_id, request_id, rpc_name, completed_at from gone
    on conflict (user_id, request_id) do nothing;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.prune_offline_records() from public, anon, authenticated;
