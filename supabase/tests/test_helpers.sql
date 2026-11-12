-- Test-only helpers (never a migration): the packing version a screen would
-- have shown, so tests can send it the way the app does.
create schema if not exists tests;
grant usage on schema tests to authenticated;
create or replace function tests.pv_order(p_order_id uuid) returns integer language sql stable security definer set search_path = public as $$
  select packing_version from public.orders where id = p_order_id;
$$;
create or replace function tests.pv_item(p_item_id uuid) returns integer language sql stable security definer set search_path = public as $$
  select o.packing_version from public.orders o join public.order_items i on i.order_id = o.id where i.id = p_item_id;
$$;
create or replace function tests.pv_delivery(p_delivery_id uuid) returns integer language sql stable security definer set search_path = public as $$
  select o.packing_version from public.orders o join public.deliveries d on d.order_id = o.id where d.id = p_delivery_id;
$$;
-- The offline payload with the version added (unchanged when the row is unknown).
create or replace function tests.with_pv_item(p_item_id uuid, p_offline jsonb) returns jsonb language sql stable as $$
  select coalesce(p_offline, '{}'::jsonb) || coalesce(jsonb_build_object('packing_version', tests.pv_item(p_item_id)), '{}'::jsonb)
    - case when tests.pv_item(p_item_id) is null then 'packing_version' else '' end;
$$;
create or replace function tests.with_pv_delivery(p_delivery_id uuid, p_offline jsonb) returns jsonb language sql stable as $$
  select coalesce(p_offline, '{}'::jsonb) || coalesce(jsonb_build_object('packing_version', tests.pv_delivery(p_delivery_id)), '{}'::jsonb)
    - case when tests.pv_delivery(p_delivery_id) is null then 'packing_version' else '' end;
$$;
grant execute on all functions in schema tests to authenticated;
