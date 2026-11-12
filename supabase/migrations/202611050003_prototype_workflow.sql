-- Order workflow from MEAH-Prototype 2.html, which Jac made the logic
-- reference on 5 Nov 2026 ("prototype wins" over the earlier decisions):
--
--   * Edit order: the office (and the administrator) may change an order at
--     any open status, not only For verification. The status stays as it is.
--     Every line comes back unpacked, so the warehouse packs the new list.
--     Completed and cancelled orders stay locked, so their records and totals
--     never change.
--   * No scheduling step: when an order is packed (For delivery), its delivery
--     is created at once for the order's delivery date and start time, with no
--     driver yet. The office can still change the date, time and driver.
--   * Mark delivered: the administrator, administrative staff and the
--     assigned driver. A driver no longer has to be assigned first. This
--     replaces DE-04 (4 Nov).
--
-- Functions are changed in place by exact text replacement, so each keeps its
-- body, grants and owner. Every replacement must match, otherwise the
-- migration stops.

create or replace function pg_temp.patch_all(p_function regprocedure, p_from text, p_to text, p_expected int default 1)
returns void language plpgsql as $$
declare
  v_def text := replace(pg_get_functiondef(p_function), E'\r', '');
  v_from text := replace(p_from, E'\r', '');
  v_count int := (length(v_def) - length(replace(v_def, v_from, ''))) / greatest(length(v_from), 1);
begin
  if v_count <> p_expected then
    raise exception 'patch_all: expected % match(es) in %, found % for: %', p_expected, p_function, v_count, p_from;
  end if;
  execute replace(v_def, v_from, replace(p_to, E'\r', ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Edit order at any open status
-- ---------------------------------------------------------------------------

do $$ begin perform pg_temp.patch_all('public.edit_order_with_items(uuid, jsonb, jsonb)'::regprocedure,
  'if v_order.status <> ''for_verification'' then raise exception ''Only orders awaiting verification can be edited''; end if;',
  'if v_order.status in (''completed'', ''cancelled'') then raise exception ''Completed and cancelled orders can''''t be edited''; end if;'); end $$;

-- A moved delivery date moves the open delivery too.
do $$ begin perform pg_temp.patch_all('public.edit_order_with_items(uuid, jsonb, jsonb)'::regprocedure,
  '  select * into v_order from public.orders where id = p_order_id;
  v_subtotal := public.order_subtotal(v_order);',
  '  update public.deliveries set scheduled_date = (p_order->>''requested_delivery_date'')::date
    where order_id = p_order_id and status in (''scheduled'', ''for_delivery'')
      and scheduled_date is distinct from (p_order->>''requested_delivery_date'')::date;

  select * into v_order from public.orders where id = p_order_id;
  v_subtotal := public.order_subtotal(v_order);'); end $$;

-- The activity entry says which status the order was edited in and that the
-- packing ticks were cleared.
do $$ begin perform pg_temp.patch_all('public.edit_order_with_items(uuid, jsonb, jsonb)'::regprocedure,
  'jsonb_build_object(''before'', v_before, ''after'', v_after)',
  'jsonb_build_object(''before'', v_before, ''after'', v_after, ''status'', v_order.status,
      ''packing_reset'', v_order.status in (''for_preparation'', ''for_delivery''))'); end $$;

-- ---------------------------------------------------------------------------
-- 2. Packed orders get their delivery straight away
-- ---------------------------------------------------------------------------

create or replace function public.orders_create_delivery_when_packed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_delivery_id uuid;
begin
  if new.status = 'for_delivery' and old.status is distinct from 'for_delivery'
     and not exists (select 1 from public.deliveries where order_id = new.id) then
    insert into public.deliveries(order_id, scheduled_date, scheduled_time)
    values (new.id, new.requested_delivery_date, new.delivery_time_start)
    returning id into v_delivery_id;
    insert into public.order_activity(order_id, user_id, action, details)
    values (new.id, auth.uid(), 'delivery_created',
      jsonb_build_object('delivery_id', v_delivery_id, 'scheduled_date', new.requested_delivery_date,
        'scheduled_time', new.delivery_time_start, 'assigned_driver_id', null, 'reason', 'packed'));
  end if;
  return new;
end;
$$;
revoke all on function public.orders_create_delivery_when_packed() from public, anon, authenticated;
drop trigger if exists orders_create_delivery_when_packed on public.orders;
create trigger orders_create_delivery_when_packed after update of status on public.orders
  for each row execute procedure public.orders_create_delivery_when_packed();

-- Orders already packed and waiting for a schedule get theirs now.
with created as (
  insert into public.deliveries(order_id, scheduled_date, scheduled_time)
  select o.id, o.requested_delivery_date, o.delivery_time_start
  from public.orders o
  where o.status = 'for_delivery' and not exists (select 1 from public.deliveries d where d.order_id = o.id)
  returning id, order_id, scheduled_date, scheduled_time
)
insert into public.order_activity(order_id, user_id, action, details)
select order_id, null, 'delivery_created',
  jsonb_build_object('delivery_id', id, 'scheduled_date', scheduled_date, 'scheduled_time', scheduled_time,
    'assigned_driver_id', null, 'reason', 'packed')
from created;

-- ---------------------------------------------------------------------------
-- 3. Mark delivered: administrator, administrative staff, assigned driver
-- ---------------------------------------------------------------------------

do $$ begin perform pg_temp.patch_all('public.complete_delivery(uuid, text, uuid)'::regprocedure,
  'v_is_management boolean := public.is_active_administrator();',
  'v_is_management boolean := public.has_app_role(array[''administrator'', ''administrative_staff'']::public.profile_role[]);'); end $$;
do $$ begin perform pg_temp.patch_all('public.complete_delivery(uuid, text, uuid)'::regprocedure,
  '  if not public.has_app_role(array[''administrator'', ''delivery_staff'']::public.profile_role[]) then
    raise exception ''Only delivery staff and administrators can mark deliveries delivered'' using errcode = ''42501'';',
  '  if not public.has_app_role(array[''administrator'', ''administrative_staff'', ''delivery_staff'']::public.profile_role[]) then
    raise exception ''You do not have permission to mark deliveries delivered'' using errcode = ''42501'';'); end $$;
do $$ begin perform pg_temp.patch_all('public.complete_delivery(uuid, text, uuid)'::regprocedure,
  '
  if v_row.assigned_driver_id is null then
    raise exception ''Assign a driver before marking this delivery delivered'' using errcode = ''42501'';
  end if;', ''); end $$;

do $$ begin perform pg_temp.patch_all('public.offline_complete_delivery(uuid, text, uuid, jsonb)'::regprocedure,
  'if not public.has_app_role(array[''administrator'', ''delivery_staff'']::public.profile_role[]) then',
  'if not public.has_app_role(array[''administrator'', ''administrative_staff'', ''delivery_staff'']::public.profile_role[]) then'); end $$;
do $$ begin perform pg_temp.patch_all('public.offline_complete_delivery(uuid, text, uuid, jsonb)'::regprocedure,
  '  if not public.is_active_administrator()
     and v_row.assigned_driver_id is distinct from auth.uid() then',
  '  if not public.has_app_role(array[''administrator'', ''administrative_staff'']::public.profile_role[])
     and v_row.assigned_driver_id is distinct from auth.uid() then'); end $$;

do $$ begin perform pg_temp.patch_all('public.update_delivery_status(uuid, public.delivery_status, text)'::regprocedure,
  '    if v_is_management and not public.is_active_administrator() then
      raise exception ''Only delivery staff and administrators can mark deliveries delivered'' using errcode = ''42501'';
    end if;
', ''); end $$;

-- The triggers that guard every route (online, offline sync, the general
-- status action) now ask only for the right person, not for a driver.
create or replace function public.deliveries_complete_rules()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed'
     and public.is_app_call()
     and not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[])
     and new.assigned_driver_id is distinct from auth.uid() then
    raise exception 'Only the assigned driver, the office or an administrator can mark this delivery delivered' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- An order becomes Completed only through its completed delivery.
create or replace function public.orders_complete_rules()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and public.is_app_call()
     and not exists (select 1 from public.deliveries d where d.order_id = new.id and d.status = 'completed') then
    raise exception 'An order is completed by marking its delivery delivered' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Changing the delivery the packed order already has
-- ---------------------------------------------------------------------------
-- Older screens and queued offline changes still call create_delivery. For an
-- order whose delivery was created when it was packed, the call now sets that
-- delivery's date, time, driver and notes instead of being refused.

do $$ begin perform pg_temp.patch_all('public.create_delivery(uuid, date, time, uuid, text)'::regprocedure,
  '  if exists (select 1 from public.deliveries where order_id = p_order_id) then
    raise exception ''This order already has a delivery record'';
  end if;

  perform public.validate_delivery_driver(p_assigned_driver_id);
  insert into public.deliveries(order_id, assigned_driver_id, scheduled_date, scheduled_time, notes)
  values (p_order_id, p_assigned_driver_id, p_scheduled_date, p_scheduled_time, nullif(trim(p_notes), ''''))
  returning id into v_delivery_id;',
  '  perform public.validate_delivery_driver(p_assigned_driver_id);
  update public.deliveries
    set assigned_driver_id = p_assigned_driver_id, scheduled_date = p_scheduled_date,
        scheduled_time = p_scheduled_time, notes = nullif(trim(p_notes), '''')
    where order_id = p_order_id and status = ''scheduled''
    returning id into v_delivery_id;
  if v_delivery_id is null then
    if exists (select 1 from public.deliveries where order_id = p_order_id) then
      raise exception ''This order already has a delivery record'';
    end if;
    insert into public.deliveries(order_id, assigned_driver_id, scheduled_date, scheduled_time, notes)
    values (p_order_id, p_assigned_driver_id, p_scheduled_date, p_scheduled_time, nullif(trim(p_notes), ''''))
    returning id into v_delivery_id;
  end if;'); end $$;
