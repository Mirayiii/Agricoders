-- Jac's decisions of 4 Nov 2026, 17:21 (requirements Revision 2.1):
--   * SI-02 / PS-02: the stock tag on New order is removed for administrative
--     staff (this replaces D-S1). Stock availability is administrator-only.
--   * AS-02 / AS-03: purchasing staff get one "Ready to buy" notification when
--     an order goes from For verification to Confirmed. Never twice for the
--     same order. A matching push switch, separate from the in-app list.
--   * NO-02: the usual quantity can leave out the order being edited.
--   * DE-03: cancelling an order marks its receipt VOID. The DR number and the
--     details stay as they were; no receipt is created if there was none.

-- ---------------------------------------------------------------------------
-- 1. Stock availability: administrator only
-- ---------------------------------------------------------------------------

create or replace function public.get_product_inventory_availability(p_product_ids uuid[])
returns table(product_id uuid, sku_id uuid, sku text, unit text, current_quantity numeric, status public.inventory_status)
language sql stable security definer set search_path = public as $$
  select ps.product_id, ps.id, coalesce(ps.selling_sku, ps.buying_sku), ps.unit_of_measurement,
    coalesce(i.current_quantity, 0), public.get_inventory_status(coalesce(i.current_quantity, 0), i.low_stock_threshold)
  from public.product_skus ps left join public.inventory i on i.sku_id = ps.id
  where ps.product_id = any(p_product_ids) and ps.status = 'active'
    and public.is_active_administrator()
  order by ps.product_id, coalesce(ps.selling_sku, ps.buying_sku);
$$;

-- ---------------------------------------------------------------------------
-- 2. "Ready to buy" for purchasing staff (AS-02, AS-03)
-- ---------------------------------------------------------------------------

-- One notification per purchasing staff member per order: the event key is
-- the order, and (user, event key) is unique, so a retried or repeated
-- confirmation adds nothing.
create or replace function public.notify_ready_to_buy()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'for_verification' and new.status = 'confirmed' then
    insert into public.notifications (user_id, type, title, message, related_order_id, event_key)
    select p.id, 'ready_to_buy', 'Ready to buy',
        new.order_number || ' is confirmed for ' || to_char(new.requested_delivery_date, 'Mon FMDD') || ' and is on To buy',
        new.id, 'ready_to_buy:' || new.id::text
    from public.profiles p
    where p.role = 'fulfillment_staff' and p.status = 'active'
    on conflict (user_id, event_key) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.notify_ready_to_buy() from public, anon, authenticated;
drop trigger if exists orders_notify_ready_to_buy on public.orders;
create trigger orders_notify_ready_to_buy after update of status on public.orders
  for each row execute procedure public.notify_ready_to_buy();

alter table public.notification_preferences add column if not exists push_ready_to_buy boolean not null default true;
grant update (push_ready_to_buy) on table public.notification_preferences to authenticated;

create or replace function public.push_categories_for_role(p_role public.profile_role)
returns text[] language sql immutable as $$
  select case p_role
    when 'administrator' then array['new_orders', 'flagged_orders', 'delivery_reminders']
    when 'administrative_staff' then array['new_orders', 'flagged_orders', 'delivery_reminders']
    when 'fulfillment_staff' then array['ready_to_buy']
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
    when 'ready_to_buy' then 'ready_to_buy'
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
      push_ready_to_buy = case when p_category = 'ready_to_buy' then p_on else push_ready_to_buy end,
      updated_at = now()
    where user_id = auth.uid();
  return (select jsonb_build_object('push_new_orders', push_new_orders, 'push_flagged_orders', push_flagged_orders,
      'push_delivery_reminders', push_delivery_reminders, 'push_ready_to_buy', push_ready_to_buy)
    from public.notification_preferences where user_id = auth.uid());
end;
$$;

create or replace function public.wants_push(p_user_id uuid, p_type text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select public.push_category_for_type(p_type) = any(public.push_categories_for_role(p.role))
      and coalesce(case public.push_category_for_type(p_type)
            when 'new_orders' then np.push_new_orders
            when 'flagged_orders' then np.push_flagged_orders
            when 'delivery_reminders' then np.push_delivery_reminders
            when 'ready_to_buy' then np.push_ready_to_buy end, true)
    from public.profiles p left join public.notification_preferences np on np.user_id = p.id
    where p.id = p_user_id and p.status = 'active'), false);
$$;

-- ---------------------------------------------------------------------------
-- 3. Usual quantities without the order being edited (NO-02)
-- ---------------------------------------------------------------------------

drop function if exists public.get_usual_quantities(uuid);
create or replace function public.get_usual_quantities(p_customer_id uuid, p_exclude_order_id uuid default null)
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
        and o.id is distinct from p_exclude_order_id
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
revoke all on function public.get_usual_quantities(uuid, uuid) from public, anon;
grant execute on function public.get_usual_quantities(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. VOID receipts for cancelled orders (DE-03)
-- ---------------------------------------------------------------------------

alter table public.delivery_receipts add column if not exists voided_at timestamptz;

-- Before completion only the contents may be refreshed. Once final, the only
-- change allowed is marking the receipt void, once, with nothing else changed.
create or replace function public.delivery_receipts_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE'
     and new.id = old.id and new.order_id = old.order_id and new.dr_number = old.dr_number
     and new.issued_by = old.issued_by and new.issued_at = old.issued_at then
    if old.finalized_at is null and old.voided_at is null then
      return new;
    end if;
    if old.voided_at is null and new.voided_at is not null
       and new.content = old.content and new.finalized_at is not distinct from old.finalized_at
       and new.refreshed_at is not distinct from old.refreshed_at then
      return new;
    end if;
  end if;
  raise exception 'Delivery receipts cannot be changed once issued';
end;
$$;

-- Receipts of orders cancelled before today: void now, details unchanged.
update public.delivery_receipts r
  set finalized_at = coalesce(r.finalized_at, r.refreshed_at, r.issued_at)
  from public.orders o
  where o.id = r.order_id and o.status = 'cancelled' and r.finalized_at is null;
update public.delivery_receipts r
  set voided_at = coalesce(o.updated_at, now())
  from public.orders o
  where o.id = r.order_id and o.status = 'cancelled' and r.voided_at is null;

-- When an order is cancelled: freeze its receipt with the order as it stood
-- and mark it void. An order without a receipt gets none.
create or replace function public.void_receipt_on_cancel()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_receipt public.delivery_receipts;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    select * into v_receipt from public.delivery_receipts where order_id = new.id for update;
    if found and v_receipt.voided_at is null then
      if v_receipt.finalized_at is null then
        update public.delivery_receipts
          set content = public.delivery_receipt_content(new.id, v_receipt.issued_by), refreshed_at = now(), finalized_at = now()
          where id = v_receipt.id;
      end if;
      update public.delivery_receipts set voided_at = now() where id = v_receipt.id;
      insert into public.order_activity(order_id, user_id, action, details)
      values (new.id, auth.uid(), 'receipt_voided', jsonb_build_object('receipt_id', v_receipt.id, 'dr_number', v_receipt.dr_number));
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.void_receipt_on_cancel() from public, anon, authenticated;
drop trigger if exists orders_void_receipt_on_cancel on public.orders;
create trigger orders_void_receipt_on_cancel after update of status on public.orders
  for each row execute procedure public.void_receipt_on_cancel();

create or replace function public.delivery_receipt_json(p_receipt public.delivery_receipts)
returns jsonb language sql stable as $$
  select p_receipt.content || jsonb_build_object(
    'receipt_id', p_receipt.id,
    'order_id', p_receipt.order_id,
    'dr_number', p_receipt.dr_number,
    'dr_label', 'DR-' || lpad(p_receipt.dr_number::text, 4, '0'),
    'issued_at', p_receipt.issued_at,
    'finalized_at', p_receipt.finalized_at,
    'voided_at', p_receipt.voided_at);
$$;

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
  if v_receipt.finalized_at is null and v_receipt.voided_at is null then perform public.issue_receipt_for(p_order_id); end if;
  select * into v_receipt from public.delivery_receipts where order_id = p_order_id;
  return jsonb_build_object('id', v_receipt.id, 'order_id', v_receipt.order_id, 'dr_number', v_receipt.dr_number,
    'issued_at', v_receipt.issued_at, 'finalized_at', v_receipt.finalized_at, 'voided_at', v_receipt.voided_at,
    'content', v_receipt.content);
end;
$$;
revoke all on function public.get_delivery_receipt(uuid) from public, anon;
grant execute on function public.get_delivery_receipt(uuid) to authenticated;
