-- Phase 10: offline support (D-OF1 to D-OF4).
--
-- Changes made offline are queued on the phone and sent later through the
-- offline_* functions below. Each one:
--   1. checks the caller's role first (a deactivated account is refused),
--   2. returns the stored result if this request already ran (duplicate replay),
--   3. refuses changes queued more than 30 days ago (D-OF3),
--   4. re-checks what the person saw (assignment, status, record versions)
--      and refuses with a reason when the record changed since (D-OF1),
--   5. runs the normal function, so every existing rule still applies.
-- A refusal changes nothing. The app shows the reason and asks the person to
-- review it; nothing newer is overwritten silently.
--
-- Error codes the app reads: OFCON (changed since, needs review), OFEXP
-- (older than 30 days), OFPRC (prices changed on a queued new order).

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- The wrapper owns the request id; the function it calls gets a different id
-- derived from it, so both can keep their own duplicate protection.
create or replace function public.offline_inner_request_id(p_request_id uuid)
returns uuid language sql immutable set search_path = public as $$
  select md5(p_request_id::text || ':offline-inner')::uuid;
$$;

create or replace function public.check_offline_age(p_offline jsonb)
returns void language plpgsql stable set search_path = public as $$
declare
  v_queued timestamptz := nullif(coalesce(p_offline, '{}'::jsonb)->>'queued_at', '')::timestamptz;
begin
  if v_queued is null then
    raise exception 'This offline change has no saved time' using errcode = '22023';
  end if;
  -- A phone clock a little ahead is allowed; a time far in the future is not a real offline save.
  if v_queued > now() + interval '1 day' then
    raise exception 'This offline change has a saved time in the future. Check the phone''s date and time.' using errcode = 'OFEXP';
  end if;
  if v_queued < now() - interval '30 days' then
    raise exception 'This change was saved offline more than 30 days ago, so it was not applied. Enter it again if it is still needed.' using errcode = 'OFEXP';
  end if;
end;
$$;

revoke all on function public.offline_inner_request_id(uuid) from public, anon, authenticated;
revoke all on function public.check_offline_age(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Deliveries: mark delivered
-- ---------------------------------------------------------------------------
create or replace function public.offline_complete_delivery(p_delivery_id uuid, p_received_by text, p_client_request_id uuid, p_offline jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_seen jsonb := coalesce(p_offline->'seen', '{}'::jsonb);
  v_replay jsonb;
  v_row public.deliveries;
  v_order public.orders;
  v_driver text;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff', 'delivery_staff']::public.profile_role[]) then
    raise exception 'Your account can no longer confirm deliveries' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('offline_complete_delivery', p_client_request_id,
    jsonb_build_object('delivery_id', p_delivery_id, 'received_by', p_received_by));
  if v_replay is not null then return v_replay; end if;
  perform public.check_offline_age(p_offline);

  select * into v_row from public.deliveries where id = p_delivery_id;
  if v_row.id is null then raise exception 'This delivery no longer exists.' using errcode = 'OFCON'; end if;
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[])
     and v_row.assigned_driver_id is distinct from auth.uid() then
    select coalesce(nullif(trim(full_name), ''), username) into v_driver from public.profiles where id = v_row.assigned_driver_id;
    raise exception '%', case when v_driver is null then 'This stop was unassigned from you, so it was not marked delivered.'
      else format('This stop was reassigned to %s, so it was not marked delivered.', v_driver) end using errcode = 'OFCON';
  end if;
  if v_row.status = 'completed' then
    raise exception 'Someone else already marked this delivery delivered.' using errcode = 'OFCON';
  end if;
  if v_seen ? 'scheduled_date' and v_row.scheduled_date::text is distinct from v_seen->>'scheduled_date' then
    raise exception 'This stop was moved to %, so it was not marked delivered. Check it with the office.', to_char(v_row.scheduled_date, 'Dy DD Mon') using errcode = 'OFCON';
  end if;
  select * into v_order from public.orders where id = v_row.order_id;
  if v_order.status = 'cancelled' then
    raise exception 'The order was cancelled, so it was not marked delivered.' using errcode = 'OFCON';
  end if;
  if v_seen ? 'order_updated_at' and v_order.updated_at > (v_seen->>'order_updated_at')::timestamptz + interval '1 second' then
    raise exception 'The order was changed after your list was last updated, so it was not marked delivered. Open it, check the items, and mark it again.' using errcode = 'OFCON';
  end if;

  v_result := public.complete_delivery(p_delivery_id, p_received_by, public.offline_inner_request_id(p_client_request_id));
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Purchasing: tick or untick a packed line
-- ---------------------------------------------------------------------------
create or replace function public.offline_set_item_packed(p_item_id uuid, p_packed boolean, p_client_request_id uuid, p_offline jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_seen jsonb := coalesce(p_offline->'seen', '{}'::jsonb);
  v_replay jsonb;
  v_item public.order_items;
  v_name text;
  v_by text;
  v_now_packed boolean;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[]) then
    raise exception 'Your account can no longer pack orders' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('offline_set_item_packed', p_client_request_id,
    jsonb_build_object('item_id', p_item_id, 'packed', p_packed));
  if v_replay is not null then return v_replay; end if;
  perform public.check_offline_age(p_offline);

  select * into v_item from public.order_items where id = p_item_id;
  if v_item.id is null then
    raise exception 'This item was removed from the order, so the change was not applied.' using errcode = 'OFCON';
  end if;
  select product_name into v_name from public.products where id = v_item.product_id;
  if (v_seen ? 'quantity' and v_item.quantity <> (v_seen->>'quantity')::numeric)
     or (v_seen ? 'unit' and lower(v_item.unit_of_measurement) <> lower(v_seen->>'unit')) then
    raise exception '% changed to % % after your list was last updated. Check it before packing.', coalesce(v_name, 'This item'), trim_scale(v_item.quantity), v_item.unit_of_measurement using errcode = 'OFCON';
  end if;
  -- Never undo someone else's newer change: if the line changed state since
  -- the person saw it, and they're asking for the opposite, refuse.
  v_now_packed := v_item.preparation_status = 'completed';
  if v_seen ? 'packed' and (v_seen->>'packed')::boolean <> v_now_packed and p_packed <> v_now_packed then
    select coalesce(nullif(trim(full_name), ''), username) into v_by from public.profiles where id = coalesce(v_item.prepared_by, v_item.preparation_started_by);
    raise exception '% was % by % after your list was last updated, so your change was not applied.', coalesce(v_name, 'This item'),
      case when v_now_packed then 'ticked packed' else 'unticked' end, coalesce(v_by, 'someone else') using errcode = 'OFCON';
  end if;

  v_result := public.set_item_packed(p_item_id, p_packed, public.offline_inner_request_id(p_client_request_id));
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Orders: confirm an order that is For verification
-- ---------------------------------------------------------------------------
create or replace function public.offline_confirm_order(p_order_id uuid, p_client_request_id uuid, p_offline jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_seen jsonb := coalesce(p_offline->'seen', '{}'::jsonb);
  v_replay jsonb;
  v_order public.orders;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'Your account can no longer confirm orders' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('offline_confirm_order', p_client_request_id, jsonb_build_object('order_id', p_order_id));
  if v_replay is not null then return v_replay; end if;
  perform public.check_offline_age(p_offline);

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then raise exception 'This order no longer exists.' using errcode = 'OFCON'; end if;
  if v_order.status <> 'for_verification' then
    raise exception 'This order is already %, so it was not confirmed again.', replace(v_order.status::text, '_', ' ') using errcode = 'OFCON';
  end if;
  -- The app never queues a flagged order; one flagged after it was queued must be checked first.
  if v_order.requires_attention then
    raise exception 'This order is flagged for checking, so it was not confirmed. Clear the flag and confirm it again.' using errcode = 'OFCON';
  end if;
  if v_seen ? 'updated_at' and v_order.updated_at > (v_seen->>'updated_at')::timestamptz + interval '1 second' then
    raise exception 'The order was changed after your list was last updated, so it was not confirmed. Open it, check it, and confirm again.' using errcode = 'OFCON';
  end if;

  perform public.transition_order_status(p_order_id, 'confirmed', jsonb_build_object('offline', true));
  v_result := jsonb_build_object('order_id', p_order_id, 'status', 'confirmed');
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- New order: save, but stop if prices changed since it was entered
-- ---------------------------------------------------------------------------
-- p_offline.seen_prices: [{product_id, unit, price}] as shown when the order
-- was entered. If any line's price is different now, nothing is saved and the
-- app shows old and new prices for review (OFPRC). Submitting again with
-- p_offline.accept_current_prices = true saves at today's prices.
create or replace function public.offline_create_order(p_order jsonb, p_items jsonb, p_client_request_id uuid, p_offline jsonb, p_source_order_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_replay jsonb;
  v_result jsonb;
  v_changes jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'Your account can no longer create orders' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('offline_create_order', p_client_request_id,
    jsonb_build_object('order', p_order, 'items', p_items, 'source_order_id', p_source_order_id));
  if v_replay is not null then return v_replay; end if;
  perform public.check_offline_age(p_offline);

  v_result := public.create_order(p_order, p_items, public.offline_inner_request_id(p_client_request_id), p_source_order_id);

  if not coalesce((p_offline->>'accept_current_prices')::boolean, false) then
    select jsonb_agg(jsonb_build_object('product_id', s.product_id, 'product_name', p.product_name, 'unit', s.unit,
             'seen_price', s.price, 'current_price', oi.unit_price) order by p.product_name)
      into v_changes
    from jsonb_to_recordset(coalesce(p_offline->'seen_prices', '[]'::jsonb)) as s(product_id uuid, unit text, price numeric)
    join public.order_items oi on oi.order_id = (v_result->>'order_id')::uuid and oi.product_id = s.product_id and lower(oi.unit_of_measurement) = lower(s.unit)
      and oi.special_price is null
    left join public.products p on p.id = s.product_id
    where oi.unit_price is distinct from s.price;
    if v_changes is not null then
      -- Rolls back the order and both request records.
      raise exception 'Prices changed since this order was entered' using errcode = 'OFPRC', detail = v_changes::text;
    end if;
  end if;

  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;

revoke all on function public.offline_complete_delivery(uuid, text, uuid, jsonb) from public, anon;
revoke all on function public.offline_set_item_packed(uuid, boolean, uuid, jsonb) from public, anon;
revoke all on function public.offline_confirm_order(uuid, uuid, jsonb) from public, anon;
revoke all on function public.offline_create_order(jsonb, jsonb, uuid, jsonb, uuid) from public, anon;
grant execute on function public.offline_complete_delivery(uuid, text, uuid, jsonb) to authenticated;
grant execute on function public.offline_set_item_packed(uuid, boolean, uuid, jsonb) to authenticated;
grant execute on function public.offline_confirm_order(uuid, uuid, jsonb) to authenticated;
grant execute on function public.offline_create_order(jsonb, jsonb, uuid, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Sync rejections (D-OF4)
-- ---------------------------------------------------------------------------
-- When the server refuses a queued change, the app records it here as soon as
-- it can reach the server, so administrators can see it. Changes discarded
-- while the phone never reached the server can't be recorded, and the app
-- doesn't claim they were.
create table if not exists public.sync_rejections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  request_id uuid not null,
  action text not null check (char_length(action) between 1 and 200),
  rpc_name text not null check (char_length(rpc_name) between 1 and 80),
  kind text not null check (kind in ('conflict', 'expired', 'price_changed', 'permission', 'signed_out', 'error', 'discarded')),
  reason text not null check (char_length(reason) between 1 and 1000),
  queued_at timestamptz not null,
  rejected_at timestamptz not null default now(),
  unique (user_id, request_id)
);
alter table public.sync_rejections enable row level security;
revoke all on table public.sync_rejections from anon, authenticated;
grant select on table public.sync_rejections to authenticated;
grant insert (request_id, action, rpc_name, kind, reason, queued_at) on table public.sync_rejections to authenticated;

-- Anyone signed in records their own rejections, even just after being
-- deactivated (their session is ending, but the token is valid a few minutes).
drop policy if exists "own_sync_rejections_insert" on public.sync_rejections;
create policy "own_sync_rejections_insert" on public.sync_rejections
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "administrators_read_sync_rejections" on public.sync_rejections;
create policy "administrators_read_sync_rejections" on public.sync_rejections
  for select to authenticated using (public.is_active_administrator());

-- ---------------------------------------------------------------------------
-- Retention (D-OF3): duplicate-protection records are kept at least 90 days,
-- three times the 30-day limit on queued changes. Run daily from a scheduled
-- job once Jac approves the schedule; nothing calls it automatically yet.
-- ---------------------------------------------------------------------------
create or replace function public.prune_offline_records()
returns integer language plpgsql security definer set search_path = public as $$
declare v_deleted integer;
begin
  -- Only finished requests. A request still marked pending (a multi-step
  -- account change that stopped part way) is kept so a retry can continue it.
  delete from public.mutation_requests
    where status = 'done' and coalesce(completed_at, created_at) < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.prune_offline_records() from public, anon, authenticated;
