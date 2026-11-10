-- MEAH security hardening. Apply after the Part 1-8 migrations.
-- This migration is additive: it preserves existing records and replaces only
-- overly broad access policies and grants.

-- Centralize the row-level decision so that the three order tables cannot
-- drift apart. Delivery staff are deliberately limited to orders for a
-- delivery assigned to their authenticated profile; the other operational
-- roles keep their existing read access.
create or replace function public.can_read_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[])
    or (
      public.has_app_role(array['delivery_staff']::public.profile_role[])
      and exists (
        select 1
        from public.deliveries d
        where d.order_id = p_order_id
          and d.assigned_driver_id = auth.uid()
      )
    );
$$;
revoke all on function public.can_read_order(uuid) from public;
grant execute on function public.can_read_order(uuid) to authenticated;

drop policy if exists "active_staff_read_orders" on public.orders;
drop policy if exists "active_staff_read_order_items" on public.order_items;
drop policy if exists "active_staff_read_order_activity" on public.order_activity;

create policy "staff_read_authorized_orders"
  on public.orders for select to authenticated
  using (public.can_read_order(id));

create policy "staff_read_authorized_order_items"
  on public.order_items for select to authenticated
  using (public.can_read_order(order_id));

create policy "staff_read_authorized_order_activity"
  on public.order_activity for select to authenticated
  using (public.can_read_order(order_id));

-- Price and customer-specific price rows can reveal cost and margin data.
-- Order creation continues to resolve the applicable selling price inside its
-- security-definer RPC, so operational users do not need direct table access.
drop policy if exists "active_staff_read_price_history" on public.price_history;
drop policy if exists "active_staff_read_customer_pricing" on public.customer_pricing;

create policy "pricing_staff_read_price_history"
  on public.price_history for select to authenticated
  using (public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]));

create policy "pricing_staff_read_customer_pricing"
  on public.customer_pricing for select to authenticated
  using (public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]));

-- Delivery users need the customer and catalogue data for their assigned jobs,
-- not the full customer list or catalogue. Fulfillment keeps the catalogue and
-- customer visibility it needs to prepare orders.
drop policy if exists "active_staff_read_customers" on public.customers;
drop policy if exists "active_staff_read_products" on public.products;
drop policy if exists "active_staff_read_skus" on public.product_skus;
drop policy if exists "active_staff_read_varieties" on public.product_varieties;
drop policy if exists "active_staff_read_preferences" on public.customer_product_preferences;

create policy "staff_read_authorized_customers"
  on public.customers for select to authenticated
  using (
    public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[])
    or (
      public.has_app_role(array['delivery_staff']::public.profile_role[])
      and exists (
        select 1
        from public.deliveries d
        join public.orders o on o.id = d.order_id
        where d.assigned_driver_id = auth.uid()
          and o.customer_id = customers.id
      )
    )
  );

create policy "staff_read_authorized_products"
  on public.products for select to authenticated
  using (
    public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[])
    or (
      public.has_app_role(array['delivery_staff']::public.profile_role[])
      and exists (
        select 1
        from public.deliveries d
        join public.order_items oi on oi.order_id = d.order_id
        where d.assigned_driver_id = auth.uid()
          and oi.product_id = products.id
      )
    )
  );

create policy "staff_read_authorized_skus"
  on public.product_skus for select to authenticated
  using (
    public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[])
    or (
      public.has_app_role(array['delivery_staff']::public.profile_role[])
      and exists (
        select 1
        from public.deliveries d
        join public.order_items oi on oi.order_id = d.order_id
        where d.assigned_driver_id = auth.uid()
          and oi.product_sku_id = product_skus.id
      )
    )
  );

create policy "staff_read_authorized_varieties"
  on public.product_varieties for select to authenticated
  using (
    public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[])
    or (
      public.has_app_role(array['delivery_staff']::public.profile_role[])
      and exists (
        select 1
        from public.deliveries d
        join public.order_items oi on oi.order_id = d.order_id
        where d.assigned_driver_id = auth.uid()
          and oi.variety_id = product_varieties.id
      )
    )
  );

create policy "operations_read_customer_preferences"
  on public.customer_product_preferences for select to authenticated
  using (public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[]));

-- PostgreSQL column grants prevent a direct PostgREST request from exposing
-- order-level costs, special pricing approvals, or original prices. The mobile
-- app already reads only the non-sensitive columns below.
revoke select on public.order_items from authenticated;
grant select (
  id, order_id, product_id, product_sku_id, variety_id,
  quantity, unit_of_measurement, unit_price, notes, created_at,
  preparation_status, prepared_by, prepared_at
) on public.order_items to authenticated;

-- Authorized pricing staff receive aggregate margin data through a controlled
-- RPC rather than raw order-item cost values.
create or replace function public.get_order_margin_summary()
returns table(total_cost numeric, total_selling numeric)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to view margin information';
  end if;

  return query
  select
    coalesce(sum(oi.quantity * oi.cost_price), 0),
    coalesce(sum(oi.quantity * oi.unit_price), 0)
  from public.order_items oi;
end;
$$;
revoke all on function public.get_order_margin_summary() from public;
grant execute on function public.get_order_margin_summary() to authenticated;

-- A user may mark only their own notification as read. Column privileges make
-- attempts to alter message, ownership, type, dates, or related records fail
-- even when the caller targets their own row.
revoke update on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;

-- Keep at least one active administrator. This covers self-deactivation and
-- role downgrades, while still allowing a different active administrator to
-- manage accounts safely.
create or replace function public.prevent_last_active_administrator_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'administrator'
    and old.status = 'active'
    and (new.role is distinct from 'administrator' or new.status is distinct from 'active')
    and not exists (
      select 1
      from public.profiles p
      where p.id <> old.id
        and p.role = 'administrator'
        and p.status = 'active'
    ) then
    raise exception 'At least one active administrator must remain';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_preserve_active_administrator on public.profiles;
create trigger profiles_preserve_active_administrator
  before update of role, status on public.profiles
  for each row execute procedure public.prevent_last_active_administrator_change();
