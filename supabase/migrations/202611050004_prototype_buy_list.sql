-- To buy from MEAH-Prototype 2.html and the Figma "Purchasing · To buy"
-- frame (Jac, 5 Nov 2026, "prototype wins"; replaces PU-01 of 4 Nov):
--
--   * The list is read-only. Each line shows the demand for the range, the
--     stock on hand and "Buy X more" when the demand is more than the stock.
--     Lines are no longer ticked as bought.
--   * Orders still waiting for verification count too, with Confirmed and
--     Packing orders, so Purchasing sees everything that will need buying.
--   * Purchasing staff see the stock on the list (only for products with
--     Track inventory on), since the shortfall is worked out from it. Where
--     stock isn't tracked or recorded, no shortfall is shown: unknown stock is
--     not treated as zero.
--
-- Bought quantities already saved stay in buy_list_purchases as history; they
-- no longer change the list.

create or replace function public.buy_list_days(p_from date, p_to date)
returns table(product_id uuid, unit_key text, delivery_date date, needed numeric, bought numeric, order_count bigint, line_unit text)
language sql stable security definer set search_path = public as $$
  with lines as (
    select i.order_id, i.product_id, m.unit_key, m.factor, trim(i.unit_of_measurement) as unit_text,
      i.quantity * m.factor as quantity, o.requested_delivery_date as day
    from public.order_items i
    join public.orders o on o.id = i.order_id
    cross join lateral public.unit_measure(i.unit_of_measurement) m
    where o.status in ('for_verification', 'confirmed', 'for_preparation')
      and o.requested_delivery_date <= p_to
      and (p_from is null or o.requested_delivery_date >= p_from)
  )
  select l.product_id, l.unit_key, l.day, sum(l.quantity), 0::numeric,
    count(distinct l.order_id), min(l.unit_text) filter (where l.factor = 1)
  from lines l
  group by l.product_id, l.unit_key, l.day;
$$;
revoke all on function public.buy_list_days(date, date) from public, anon, authenticated;

create or replace function public.get_buy_list(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_items jsonb;
  v_overdue integer;
begin
  if not public.has_app_role(array['administrator', 'fulfillment_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to see the buy list' using errcode = '42501';
  end if;
  if p_to is null then raise exception 'Choose an end date'; end if;
  if p_from is not null and p_from > p_to then raise exception 'The start date must be on or before the end date'; end if;
  if p_from is not null and p_to - p_from > 92 then raise exception 'Choose a range of 93 days or fewer'; end if;

  with days as (select * from public.buy_list_days(p_from, p_to)),
  demand as (
    select d.product_id, d.unit_key, sum(d.needed) as quantity, sum(d.order_count) as order_count,
      min(d.line_unit) as line_unit
    from days d group by d.product_id, d.unit_key
  ),
  stock as (
    select ps.product_id, m.unit_key, sum(coalesce(inv.current_quantity, 0) * m.factor) as quantity
    from public.product_skus ps
    left join public.inventory inv on inv.sku_id = ps.id
    cross join lateral public.unit_measure(ps.unit_of_measurement) m
    where ps.status = 'active'
      and exists (select 1 from public.products tp where tp.id = ps.product_id and tp.track_stock)
    group by ps.product_id, m.unit_key
  ),
  shown as (
    select d.*, p.product_name, p.track_stock,
      coalesce(case when pm.unit_key = d.unit_key then trim(p.unit_of_measurement) end,
               case when d.unit_key in ('kg', 'l', 'pc') then d.unit_key end,
               d.line_unit, d.unit_key) as unit,
      case when pm.unit_key = d.unit_key then pm.factor else 1 end as shown_factor,
      st.quantity as stock,
      -- To buy: the demand less the stock on hand, both in the same base unit
      -- (g to kg, dozen to pc). Unknown when the product's stock isn't tracked
      -- or it has no stock record: that is not the same as zero stock.
      case when st.quantity is null then null else greatest(d.quantity - st.quantity, 0) end as to_buy
    from demand d
    join public.products p on p.id = d.product_id
    left join lateral public.unit_measure(p.unit_of_measurement) pm on true
    left join stock st on st.product_id = d.product_id and st.unit_key = d.unit_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', product_id,
      'product_name', product_name,
      'track_stock', track_stock,
      'unit', unit,
      'unit_key', unit_key,
      'quantity', round(quantity / shown_factor, 3),
      'order_count', order_count,
      'bought', 0,
      'remaining', case when to_buy is null then null else round(to_buy / shown_factor, 3) end,
      'stock', case when stock is null then null else round(stock / shown_factor, 3) end,
      'short_by', case when stock is null then null else round(greatest(quantity - stock, 0) / shown_factor, 3) end
    ) order by product_name, unit), '[]'::jsonb)
  into v_items from shown;

  select count(*) into v_overdue from public.orders
    where status in ('for_verification', 'confirmed', 'for_preparation') and requested_delivery_date < v_today
      and p_from is null and requested_delivery_date <= p_to;

  return jsonb_build_object('today', v_today, 'from', p_from, 'to', p_to, 'overdue_orders', v_overdue, 'items', v_items,
    'short_lines', (select count(*) from jsonb_array_elements(v_items) x where (x->>'short_by')::numeric > 0),
    'total_lines', jsonb_array_length(v_items));
end;
$$;
revoke all on function public.get_buy_list(date, date) from public, anon;
grant execute on function public.get_buy_list(date, date) to authenticated;

-- Ticking lines as bought is gone; old app versions get a clear answer.
create or replace function public.set_buy_list_bought(p_product_id uuid, p_unit_key text, p_from date, p_to date, p_bought boolean, p_client_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_app_role(array['administrator', 'fulfillment_staff']::public.profile_role[]) then
    raise exception 'Only purchasing staff and administrators can see the buy list' using errcode = '42501';
  end if;
  raise exception 'The buy list no longer has ticks. Update the app to see what is left to buy.' using errcode = '22023';
end;
$$;

-- Purchasing Home: orders due today with a line whose demand is more than
-- the stock on hand. Lines with untracked or unrecorded stock are not counted
-- as short, because their stock is unknown, not zero.
create or replace function public.get_purchasing_today()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_list jsonb;
begin
  if not public.has_app_role(array['administrator', 'fulfillment_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to see purchasing counts' using errcode = '42501';
  end if;
  v_list := public.get_buy_list(v_today, v_today);
  return jsonb_build_object(
    'date', v_today,
    'awaiting_buying', (
      select count(distinct o.id)
      from public.orders o
      join public.order_items i on i.order_id = o.id
      cross join lateral public.unit_measure(i.unit_of_measurement) m
      join jsonb_array_elements(v_list->'items') x
        on (x->>'product_id')::uuid = i.product_id and x->>'unit_key' = m.unit_key and (x->>'remaining')::numeric > 0
      where o.status in ('for_verification', 'confirmed', 'for_preparation') and o.requested_delivery_date = v_today),
    'awaiting_packing', (
      select count(*) from public.orders o
      where o.status in ('confirmed', 'for_preparation') and o.requested_delivery_date = v_today
        and (not exists (select 1 from public.order_items i where i.order_id = o.id)
             or exists (select 1 from public.order_items i where i.order_id = o.id and i.preparation_status <> 'completed'))));
end;
$$;
revoke all on function public.get_purchasing_today() from public, anon;
grant execute on function public.get_purchasing_today() to authenticated;
