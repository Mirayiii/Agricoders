-- Jac's decisions of 4 Nov 2026 on the requirements document (Revision 2.1):
--
--   * SI-02, PS-02: warehouse stock monitoring is the administrator's. Other
--     roles keep only the quantities their work needs (order lines, the To
--     Buy demand, a driver's own stops). Administrative staff keep the
--     in-stock / low / out tag on the New order screen (approved stock
--     warning, D-S1), through get_product_inventory_availability only.
--   * DE-04: a stop needs an assigned driver before anyone can complete it;
--     then only that driver or the administrator can. Enforced by triggers on
--     deliveries and orders, so every route (online, offline sync, the
--     general status action) follows it.
--   * DE-03: the DR number is fixed at first issue; until the delivery is
--     completed every download shows the latest saved order; on completion
--     the receipt is frozen.
--   * PU-01: bought quantities saved per product, unit and delivery day,
--     shared by purchasing staff and the administrator. Every date filter
--     reads the same records. Ticking tops the bought quantity up to the
--     day's demand; if demand later rises the line shows what is still needed.
--   * HD-03: Purchasing Home counts come from the same records.
--   * NO-02: usual quantity = median of the customer's last 10 confirmed-or-
--     later, non-cancelled orders with that product in the same unit, from at
--     least 3 such orders. The app warns above 3 times it.
--   * AS-03: push switches per event category, only for categories the role
--     already receives in the app (AS-02). Saved per person. Sending pushes
--     is not built (D-A1 and hosted setup); in-app notifications are separate.

create or replace function pg_temp.patch_function(p_function regprocedure, p_from text, p_to text)
returns void language plpgsql as $$
declare
  -- Line endings are ignored: a function created from a file checked out on
  -- Windows (CRLF) must patch the same as one created on Linux or macOS.
  v_def text := replace(pg_get_functiondef(p_function), E'\r', '');
  v_from text := replace(p_from, E'\r', '');
  v_count int := (length(v_def) - length(replace(v_def, v_from, ''))) / greatest(length(v_from), 1);
begin
  if v_count <> 1 then
    raise exception 'patch_function: expected 1 match in %, found % for: %', p_function, v_count, p_from;
  end if;
  execute replace(v_def, v_from, replace(p_to, E'\r', ''));
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Stock monitoring: administrator only
-- ---------------------------------------------------------------------------

drop policy if exists "operational_staff_read_inventory" on public.inventory;
create policy "administrator_read_inventory" on public.inventory for select to authenticated
  using (public.is_active_administrator());

drop policy if exists "inventory_managers_read_transactions" on public.inventory_transactions;
create policy "administrator_read_inventory_transactions" on public.inventory_transactions for select to authenticated
  using (public.is_active_administrator());

do $$ begin perform pg_temp.patch_function('public.get_inventory_list(text, public.inventory_status, integer, integer)'::regprocedure,
  'public.has_app_role(array[''administrator'', ''administrative_staff'', ''fulfillment_staff'', ''delivery_staff'']::public.profile_role[])',
  'public.is_active_administrator()'); end $$;
do $$ begin perform pg_temp.patch_function('public.get_inventory_activity(uuid, integer)'::regprocedure,
  'public.has_app_role(array[''administrator'', ''administrative_staff'', ''fulfillment_staff'']::public.profile_role[])',
  'public.is_active_administrator()'); end $$;
do $$ begin perform pg_temp.patch_function('public.get_products_overview()'::regprocedure,
  '  if not public.is_active_account() then
    raise exception ''You do not have permission to view products'' using errcode = ''42501'';',
  '  if not public.is_active_administrator() then
    raise exception ''Only an administrator can open Products & stock'' using errcode = ''42501'';'); end $$;
-- New order (administrator and administrative staff) shows in stock / low / out.
do $$ begin perform pg_temp.patch_function('public.get_product_inventory_availability(uuid[])'::regprocedure,
  'public.has_app_role(array[''administrator'', ''administrative_staff'', ''fulfillment_staff'', ''delivery_staff'']::public.profile_role[])',
  'public.has_app_role(array[''administrator'', ''administrative_staff'']::public.profile_role[])'); end $$;

-- ---------------------------------------------------------------------------
-- 2. Completing a delivery (DE-04)
-- ---------------------------------------------------------------------------

-- True for a request from a signed-in staff member through the API (the
-- request runs as the authenticated role, also inside security definer
-- functions); false for migrations, scheduled jobs and the service role.
create or replace function public.is_app_call()
returns boolean language sql stable as $$
  select auth.uid() is not null and coalesce(current_setting('role', true), '') = 'authenticated';
$$;

-- CU-01: the archive and restore rule uses the same test, so owner scripts
-- and jobs that happen to carry a user id are not refused.
create or replace function public.customers_archive_by_administrator()
returns trigger language plpgsql set search_path = public as $$
begin
  if public.is_app_call() and not public.is_active_administrator()
     and ((tg_op = 'INSERT' and new.status <> 'active') or (tg_op = 'UPDATE' and new.status is distinct from old.status)) then
    raise exception 'Only an administrator can archive or restore customers' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.deliveries_complete_rules()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    if new.assigned_driver_id is null then
      raise exception 'Assign a driver before marking this delivery delivered' using errcode = '42501';
    end if;
    -- Only calls from the app (signed-in staff) are checked; server jobs,
    -- migrations and the service role are not.
    if public.is_app_call() and not public.is_active_administrator() and new.assigned_driver_id is distinct from auth.uid() then
      raise exception 'Only the assigned driver or an administrator can mark this delivery delivered' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists deliveries_complete_rules on public.deliveries;
create trigger deliveries_complete_rules before update of status on public.deliveries
  for each row execute procedure public.deliveries_complete_rules();

-- An order becomes Completed only through a completed, assigned delivery.
create or replace function public.orders_complete_rules()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and public.is_app_call()
     and not exists (select 1 from public.deliveries d
                     where d.order_id = new.id and d.status = 'completed' and d.assigned_driver_id is not null) then
    raise exception 'An order is completed by marking its assigned delivery delivered' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists orders_complete_rules on public.orders;
create trigger orders_complete_rules before update of status on public.orders
  for each row execute procedure public.orders_complete_rules();

-- Clear message before the other checks in the main completion function.
do $$ begin perform pg_temp.patch_function('public.complete_delivery(uuid, text, uuid)'::regprocedure,
  '  if v_row.id is null then raise exception ''Delivery not found''; end if;',
  '  if v_row.id is null then raise exception ''Delivery not found''; end if;
  if v_row.assigned_driver_id is null then
    raise exception ''Assign a driver before marking this delivery delivered'' using errcode = ''42501'';
  end if;'); end $$;

-- ---------------------------------------------------------------------------
-- 3. Delivery receipt: live until the delivery is completed (DE-03)
-- ---------------------------------------------------------------------------

alter table public.delivery_receipts add column if not exists finalized_at timestamptz;
alter table public.delivery_receipts add column if not exists refreshed_at timestamptz;

-- Receipts already issued for completed (or cancelled) orders keep exactly
-- what they say: they are frozen now.
alter table public.delivery_receipts disable trigger delivery_receipts_no_change;
update public.delivery_receipts r set finalized_at = r.issued_at
  from public.orders o where o.id = r.order_id and o.status in ('completed', 'cancelled') and r.finalized_at is null;
alter table public.delivery_receipts enable trigger delivery_receipts_no_change;

-- Never deleted. Before completion only the contents may be refreshed; the
-- DR number, order, issuer and issue time never change. After that, nothing.
create or replace function public.delivery_receipts_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.finalized_at is null
     and new.id = old.id and new.order_id = old.order_id and new.dr_number = old.dr_number
     and new.issued_by = old.issued_by and new.issued_at = old.issued_at then
    return new;
  end if;
  raise exception 'Delivery receipts cannot be changed once issued';
end;
$$;

-- What a receipt says, from the order as it is saved now.
create or replace function public.delivery_receipt_content(p_order_id uuid, p_issued_by uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
      'layout', 'letter',
      'company_name', 'MEAH AGRICULTURAL PRODUCTS TRADING',
      'company_address', '162 F. Benitez St., Brgy. Pasadena, San Juan 1500',
      'company_phone', '0966-168-1602',
      'order_number', o.order_number,
      'customer_name', c.business_name,
      'delivery_address', c.delivery_address,
      'delivery_date', coalesce((select d.scheduled_date from public.deliveries d where d.order_id = o.id), o.requested_delivery_date),
      'sales_invoice_number', o.sales_invoice_number,
      'issued_by_name', (select coalesce(nullif(trim(p.full_name), ''), p.email) from public.profiles p where p.id = p_issued_by),
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
            'quantity', i.quantity,
            'unit', i.unit_of_measurement,
            'description', pr.product_name || coalesce(' (' || v.variety_name || ')', ''),
            'unit_price', i.unit_price,
            'amount', i.line_total) order by i.created_at, i.id)
        from public.order_items i
        join public.products pr on pr.id = i.product_id
        left join public.product_varieties v on v.id = i.variety_id
        where i.order_id = o.id), '[]'::jsonb))
    || public.order_money(o)
  from public.orders o join public.customers c on c.id = o.customer_id
  where o.id = p_order_id;
$$;
revoke all on function public.delivery_receipt_content(uuid, uuid) from public, anon, authenticated;

-- Internal: issue the receipt, or refresh it while the delivery is not
-- completed. Callers check permissions and lock the order first.
create or replace function public.issue_receipt_for(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_receipt public.delivery_receipts;
  v_status public.order_status;
  v_final boolean;
begin
  select status into v_status from public.orders where id = p_order_id;
  v_final := v_status in ('completed', 'cancelled');
  select * into v_receipt from public.delivery_receipts where order_id = p_order_id for update;
  if found then
    if v_receipt.finalized_at is null then
      update public.delivery_receipts
        set content = public.delivery_receipt_content(p_order_id, v_receipt.issued_by),
            refreshed_at = now(),
            finalized_at = case when v_final then now() end
        where id = v_receipt.id
        returning * into v_receipt;
    end if;
    return public.delivery_receipt_json(v_receipt);
  end if;

  insert into public.delivery_receipts (order_id, content, issued_by, finalized_at)
  values (p_order_id, public.delivery_receipt_content(p_order_id, auth.uid()), auth.uid(), case when v_final then now() end)
  returning * into v_receipt;
  insert into public.order_activity(order_id, user_id, action, details)
  values (p_order_id, auth.uid(), 'receipt_issued',
    jsonb_build_object('receipt_id', v_receipt.id, 'dr_number', v_receipt.dr_number));
  return public.delivery_receipt_json(v_receipt);
end;
$$;
revoke all on function public.issue_receipt_for(uuid) from public, anon, authenticated;

-- Opening or downloading a receipt: the latest version (null if none issued).
-- Same readers as the table: administrator, administrative staff and the
-- assigned driver.
create or replace function public.get_delivery_receipt(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_receipt public.delivery_receipts;
  v_status public.order_status;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[])
     and not (public.has_app_role(array['delivery_staff']::public.profile_role[])
              and exists (select 1 from public.deliveries d where d.order_id = p_order_id and d.assigned_driver_id = auth.uid())) then
    raise exception 'You do not have permission to see this receipt' using errcode = '42501';
  end if;
  select status into v_status from public.orders where id = p_order_id for update;
  select * into v_receipt from public.delivery_receipts where order_id = p_order_id;
  if not found then return null; end if;
  if v_receipt.finalized_at is null then perform public.issue_receipt_for(p_order_id); end if;
  select * into v_receipt from public.delivery_receipts where order_id = p_order_id;
  return jsonb_build_object('id', v_receipt.id, 'order_id', v_receipt.order_id, 'dr_number', v_receipt.dr_number,
    'issued_at', v_receipt.issued_at, 'finalized_at', v_receipt.finalized_at, 'content', v_receipt.content);
end;
$$;
revoke all on function public.get_delivery_receipt(uuid) from public, anon;
grant execute on function public.get_delivery_receipt(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. To Buy: bought quantities per product, unit and delivery day (PU-01)
-- ---------------------------------------------------------------------------

create table if not exists public.buy_list_purchases (
  product_id uuid not null references public.products(id) on delete restrict,
  unit_key text not null,
  delivery_date date not null,
  bought_quantity numeric not null check (bought_quantity >= 0),
  updated_by uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (product_id, unit_key, delivery_date)
);
alter table public.buy_list_purchases enable row level security;
revoke all on public.buy_list_purchases from anon, authenticated;
grant select on public.buy_list_purchases to authenticated;
drop policy if exists "purchasing_read_buy_list_purchases" on public.buy_list_purchases;
create policy "purchasing_read_buy_list_purchases" on public.buy_list_purchases for select to authenticated
  using (public.has_app_role(array['administrator', 'fulfillment_staff']::public.profile_role[]));

-- Demand per product, unit and delivery day for the orders on the buy list
-- (confirmed and being packed), with what has been bought for that day.
create or replace function public.buy_list_days(p_from date, p_to date)
returns table(product_id uuid, unit_key text, delivery_date date, needed numeric, bought numeric, order_count bigint, line_unit text)
language sql stable security definer set search_path = public as $$
  with lines as (
    select i.order_id, i.product_id, m.unit_key, m.factor, trim(i.unit_of_measurement) as unit_text,
      i.quantity * m.factor as quantity, o.requested_delivery_date as day
    from public.order_items i
    join public.orders o on o.id = i.order_id
    cross join lateral public.unit_measure(i.unit_of_measurement) m
    where o.status in ('confirmed', 'for_preparation')
      and o.requested_delivery_date <= p_to
      and (p_from is null or o.requested_delivery_date >= p_from)
  )
  select l.product_id, l.unit_key, l.day, sum(l.quantity), coalesce(max(b.bought_quantity), 0),
    count(distinct l.order_id), min(l.unit_text) filter (where l.factor = 1)
  from lines l
  left join public.buy_list_purchases b on b.product_id = l.product_id and b.unit_key = l.unit_key and b.delivery_date = l.day
  group by l.product_id, l.unit_key, l.day;
$$;
revoke all on function public.buy_list_days(date, date) from public, anon, authenticated;

-- The To Buy list (PU-01). Purchasing staff and the administrator. Each line
-- says how much is still needed after what was bought; stock on hand is shown
-- to the administrator only (PS-02).
create or replace function public.get_buy_list(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_admin boolean := public.is_active_administrator();
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
      sum(greatest(d.needed - d.bought, 0)) as remaining, sum(least(d.bought, d.needed)) as bought,
      min(d.line_unit) as line_unit
    from days d group by d.product_id, d.unit_key
  ),
  stock as (
    select ps.product_id, m.unit_key, sum(coalesce(inv.current_quantity, 0) * m.factor) as quantity
    from public.product_skus ps
    left join public.inventory inv on inv.sku_id = ps.id
    cross join lateral public.unit_measure(ps.unit_of_measurement) m
    where ps.status = 'active' and v_admin
    group by ps.product_id, m.unit_key
  ),
  shown as (
    select d.*, p.product_name,
      coalesce(case when pm.unit_key = d.unit_key then trim(p.unit_of_measurement) end,
               case when d.unit_key in ('kg', 'l', 'pc') then d.unit_key end,
               d.line_unit, d.unit_key) as unit,
      case when pm.unit_key = d.unit_key then pm.factor else 1 end as shown_factor,
      st.quantity as stock
    from demand d
    join public.products p on p.id = d.product_id
    left join lateral public.unit_measure(p.unit_of_measurement) pm on true
    left join stock st on st.product_id = d.product_id and st.unit_key = d.unit_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', product_id,
      'product_name', product_name,
      'unit', unit,
      'unit_key', unit_key,
      'quantity', round(quantity / shown_factor, 3),
      'order_count', order_count,
      'bought', round(bought / shown_factor, 3),
      'remaining', round(remaining / shown_factor, 3),
      'stock', case when stock is null then null else round(stock / shown_factor, 3) end,
      'short_by', case when stock is null then null else round(greatest(quantity - stock, 0) / shown_factor, 3) end
    ) order by remaining = 0, product_name, unit), '[]'::jsonb)
  into v_items from shown;

  select count(*) into v_overdue from public.orders
    where status in ('confirmed', 'for_preparation') and requested_delivery_date < v_today
      and p_from is null and requested_delivery_date <= p_to;

  return jsonb_build_object('today', v_today, 'from', p_from, 'to', p_to, 'overdue_orders', v_overdue, 'items', v_items,
    'bought_lines', (select count(*) from jsonb_array_elements(v_items) x where (x->>'remaining')::numeric = 0),
    'total_lines', jsonb_array_length(v_items));
end;
$$;
revoke all on function public.get_buy_list(date, date) from public, anon;
grant execute on function public.get_buy_list(date, date) to authenticated;

-- Tick or untick a To Buy line for the days in the chosen range. Ticking sets
-- each day's bought quantity to that day's demand (so 45 kg bought and 50 kg
-- needed becomes 50 kg); unticking clears those days. Retry-safe.
create or replace function public.set_buy_list_bought(p_product_id uuid, p_unit_key text, p_from date, p_to date, p_bought boolean, p_client_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_replay jsonb;
  v_days integer;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'fulfillment_staff']::public.profile_role[]) then
    raise exception 'Only purchasing staff and administrators can tick the buy list' using errcode = '42501';
  end if;
  if p_to is null or p_bought is null then raise exception 'Choose the line and the dates' using errcode = '22023'; end if;
  v_replay := public.begin_client_request('set_buy_list_bought', p_client_request_id,
    jsonb_build_object('product_id', p_product_id, 'unit_key', p_unit_key, 'from', p_from, 'to', p_to, 'bought', p_bought));
  if v_replay is not null then return v_replay; end if;

  if p_bought then
    insert into public.buy_list_purchases (product_id, unit_key, delivery_date, bought_quantity, updated_by, updated_at)
    select d.product_id, d.unit_key, d.delivery_date, d.needed, auth.uid(), now()
    from public.buy_list_days(p_from, p_to) d
    where d.product_id = p_product_id and d.unit_key = p_unit_key
    on conflict (product_id, unit_key, delivery_date) do update
      set bought_quantity = greatest(public.buy_list_purchases.bought_quantity, excluded.bought_quantity),
          updated_by = excluded.updated_by, updated_at = excluded.updated_at;
    get diagnostics v_days = row_count;
  else
    delete from public.buy_list_purchases b
    where b.product_id = p_product_id and b.unit_key = p_unit_key and b.delivery_date <= p_to
      and (p_from is null or b.delivery_date >= p_from);
    get diagnostics v_days = row_count;
  end if;

  v_result := jsonb_build_object('product_id', p_product_id, 'unit_key', p_unit_key, 'bought', p_bought, 'days', v_days);
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;
revoke all on function public.set_buy_list_bought(uuid, text, date, date, boolean, uuid) from public, anon;
grant execute on function public.set_buy_list_bought(uuid, text, date, date, boolean, uuid) to authenticated;

-- Purchasing Home (HD-03): today's orders still awaiting buying (a line whose
-- day is not fully bought) and awaiting packing (an item not packed yet).
create or replace function public.get_purchasing_today()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
begin
  if not public.has_app_role(array['administrator', 'fulfillment_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to see purchasing counts' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'date', v_today,
    'awaiting_buying', (
      select count(distinct i.order_id)
      from public.order_items i
      join public.orders o on o.id = i.order_id
      cross join lateral public.unit_measure(i.unit_of_measurement) m
      join public.buy_list_days(v_today, v_today) d on d.product_id = i.product_id and d.unit_key = m.unit_key
      where o.status in ('confirmed', 'for_preparation') and o.requested_delivery_date = v_today and d.bought < d.needed),
    'awaiting_packing', (
      select count(*) from public.orders o
      where o.status in ('confirmed', 'for_preparation') and o.requested_delivery_date = v_today
        and (not exists (select 1 from public.order_items i where i.order_id = o.id)
             or exists (select 1 from public.order_items i where i.order_id = o.id and i.preparation_status <> 'completed'))));
end;
$$;
revoke all on function public.get_purchasing_today() from public, anon;
grant execute on function public.get_purchasing_today() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Usual quantities for the high-quantity warning (NO-02)
-- ---------------------------------------------------------------------------

create or replace function public.get_usual_quantities(p_customer_id uuid)
returns table(product_id uuid, unit text, usual_quantity numeric, order_count integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to see order history' using errcode = '42501';
  end if;
  return query
    with per_order as (
      select o.id, o.requested_delivery_date, o.created_at, i.product_id, lower(trim(i.unit_of_measurement)) as unit, sum(i.quantity) as quantity
      from public.order_items i join public.orders o on o.id = i.order_id
      where o.customer_id = p_customer_id
        and o.status in ('confirmed', 'for_preparation', 'for_delivery', 'completed')
      group by o.id, o.requested_delivery_date, o.created_at, i.product_id, lower(trim(i.unit_of_measurement))
    ),
    recent as (
      select p.*, row_number() over (partition by p.product_id, p.unit order by p.requested_delivery_date desc, p.created_at desc) as rn
      from per_order p
    )
    select r.product_id, r.unit, percentile_cont(0.5) within group (order by r.quantity)::numeric, count(*)::int
    from recent r where r.rn <= 10
    group by r.product_id, r.unit
    having count(*) >= 3;
end;
$$;
revoke all on function public.get_usual_quantities(uuid) from public, anon;
grant execute on function public.get_usual_quantities(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Push switches (AS-03), saved per person
-- ---------------------------------------------------------------------------
--
-- Categories follow the in-app events each role already receives (AS-02):
--   new_orders         order_requires_verification   administrator, administrative staff
--   flagged_orders     order_attention                administrator, administrative staff
--   delivery_reminders upcoming_order, upcoming_delivery
--                                                     administrator, administrative staff,
--                                                     delivery staff (their own stops only)
-- Purchasing staff receive no in-app events today, so they get no switch.

alter table public.notification_preferences add column if not exists push_new_orders boolean not null default true;
alter table public.notification_preferences add column if not exists push_flagged_orders boolean not null default true;
alter table public.notification_preferences add column if not exists push_delivery_reminders boolean not null default true;
grant update (push_new_orders, push_flagged_orders, push_delivery_reminders) on table public.notification_preferences to authenticated;

create or replace function public.push_categories_for_role(p_role public.profile_role)
returns text[] language sql immutable as $$
  select case p_role
    when 'administrator' then array['new_orders', 'flagged_orders', 'delivery_reminders']
    when 'administrative_staff' then array['new_orders', 'flagged_orders', 'delivery_reminders']
    when 'delivery_staff' then array['delivery_reminders']
    else array[]::text[] end;
$$;

create or replace function public.push_category_for_type(p_type text)
returns text language sql immutable as $$
  select case p_type
    when 'order_requires_verification' then 'new_orders'
    when 'order_attention' then 'flagged_orders'
    when 'upcoming_order' then 'delivery_reminders'
    when 'upcoming_delivery' then 'delivery_reminders'
  end;
$$;

create or replace function public.set_my_push_preference(p_category text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role public.profile_role;
begin
  if not public.is_active_account() then
    raise exception 'Your account cannot do this right now' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = auth.uid();
  if p_on is null or not (p_category = any(public.push_categories_for_role(v_role))) then
    raise exception 'That switch is not available for your role' using errcode = '42501';
  end if;
  insert into public.notification_preferences (user_id, updated_at) values (auth.uid(), now())
    on conflict (user_id) do nothing;
  update public.notification_preferences set
      push_new_orders = case when p_category = 'new_orders' then p_on else push_new_orders end,
      push_flagged_orders = case when p_category = 'flagged_orders' then p_on else push_flagged_orders end,
      push_delivery_reminders = case when p_category = 'delivery_reminders' then p_on else push_delivery_reminders end,
      updated_at = now()
    where user_id = auth.uid();
  return (select jsonb_build_object('push_new_orders', push_new_orders, 'push_flagged_orders', push_flagged_orders,
      'push_delivery_reminders', push_delivery_reminders)
    from public.notification_preferences where user_id = auth.uid());
end;
$$;
revoke all on function public.set_my_push_preference(text, boolean) from public, anon;
grant execute on function public.set_my_push_preference(text, boolean) to authenticated;

-- For the future push sender (D-A1): would this person get a push for this
-- in-app notification? Only for their role's categories, and only when the
-- in-app notification was addressed to them (a driver's reminders are only
-- ever for their own stops).
create or replace function public.wants_push(p_user_id uuid, p_type text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select public.push_category_for_type(p_type) = any(public.push_categories_for_role(p.role))
      and coalesce(case public.push_category_for_type(p_type)
            when 'new_orders' then np.push_new_orders
            when 'flagged_orders' then np.push_flagged_orders
            when 'delivery_reminders' then np.push_delivery_reminders end, true)
    from public.profiles p left join public.notification_preferences np on np.user_id = p.id
    where p.id = p_user_id and p.status = 'active'), false);
$$;
revoke all on function public.wants_push(uuid, text) from public, anon, authenticated;
