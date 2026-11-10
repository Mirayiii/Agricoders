-- Phase 7: Customers.
--
-- The existing customer rules stay (code and business name are required, the
-- code is unique). What this adds:
--   0. Figma's Brand name and TIN# fields, both optional. The brand name is
--      the name shown in the app when recorded; the business name is kept as
--      the registered name. TIN# is text so leading zeros and dashes stay.
--   1. Server-side checks on every customer write, whichever way it arrives.
--   2. Customers are archived, never deleted, so their history stays.
--   3. Archived customers cannot be given a new order.
--   4. A customer activity log (added, edited, archived, restored).
--   5. Read functions for the list (with order counts) and the detail screen.
--   6. save_customer and set_customer_archived, retry-safe.
-- Issued delivery receipts keep the snapshot taken when they were issued
-- (Phase 6), so editing a customer never changes them.

-- ---------------------------------------------------------------------------
-- 0. Brand name and TIN# (additive, nullable)
-- ---------------------------------------------------------------------------

alter table public.customers add column if not exists brand_name text;
alter table public.customers add column if not exists tin text;

-- ---------------------------------------------------------------------------
-- 1. Checks on every write
-- ---------------------------------------------------------------------------
-- Trims text, turns blank optional fields into "not recorded", refuses a blank
-- code or business name, and keeps archived_at in step with the status. It
-- runs for the app's functions and for direct table writes from older app
-- versions alike.

create or replace function public.customers_check_write()
returns trigger language plpgsql set search_path = public as $$
begin
  new.customer_code := nullif(trim(coalesce(new.customer_code, '')), '');
  new.business_name := nullif(regexp_replace(trim(coalesce(new.business_name, '')), '\s+', ' ', 'g'), '');
  if new.customer_code is null then raise exception 'Enter a customer code' using errcode = '23514'; end if;
  if new.business_name is null then raise exception 'Enter the business name' using errcode = '23514'; end if;
  new.brand_name := nullif(regexp_replace(trim(coalesce(new.brand_name, '')), '\s+', ' ', 'g'), '');
  new.tin := nullif(trim(coalesce(new.tin, '')), '');
  new.contact_person := nullif(trim(coalesce(new.contact_person, '')), '');
  new.phone := nullif(trim(coalesce(new.phone, '')), '');
  new.email := nullif(trim(coalesce(new.email, '')), '');
  new.delivery_address := nullif(trim(coalesce(new.delivery_address, '')), '');
  new.notes := nullif(trim(coalesce(new.notes, '')), '');
  if new.status = 'archived' then
    new.archived_at := coalesce(new.archived_at, now());
  else
    new.archived_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists customers_check_write on public.customers;
create trigger customers_check_write before insert or update on public.customers
  for each row execute procedure public.customers_check_write();

-- ---------------------------------------------------------------------------
-- 2. Archive, never delete
-- ---------------------------------------------------------------------------

create or replace function public.customers_block_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Customers are archived, not deleted, so their order history is kept.' using errcode = '42501';
end;
$$;

drop trigger if exists customers_block_delete on public.customers;
create trigger customers_block_delete before delete on public.customers
  for each row execute procedure public.customers_block_delete();

-- ---------------------------------------------------------------------------
-- 3. No new orders for archived customers
-- ---------------------------------------------------------------------------
-- create_order already checks the status, but without a lock an archive made
-- at the same moment could slip through. This takes a share lock on the
-- customer row, so an archive and a new order for the same customer run one
-- after the other. It only checks when the customer is set or changed, so
-- existing orders of an archived customer can still move through their steps.

create or replace function public.orders_require_active_customer()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.customer_id is not distinct from old.customer_id then
    return new;
  end if;
  perform 1 from public.customers where id = new.customer_id and status = 'active' for share;
  if not found then
    raise exception 'This customer is archived. Restore them before creating an order.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_require_active_customer on public.orders;
create trigger orders_require_active_customer before insert or update of customer_id on public.orders
  for each row execute procedure public.orders_require_active_customer();

-- ---------------------------------------------------------------------------
-- 4. Customer activity
-- ---------------------------------------------------------------------------

create table if not exists public.customer_activity (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  user_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('created', 'updated', 'archived', 'restored')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists customer_activity_customer_idx on public.customer_activity (customer_id, created_at desc);
alter table public.customer_activity enable row level security;
revoke all on public.customer_activity from anon, authenticated;
grant select on public.customer_activity to authenticated;
drop policy if exists "management_read_customer_activity" on public.customer_activity;
create policy "management_read_customer_activity" on public.customer_activity for select to authenticated
  using (public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]));

-- ---------------------------------------------------------------------------
-- 5. Reading
-- ---------------------------------------------------------------------------
-- Order counts come from one count per customer straight from orders, so an
-- order with many lines, a delivery or a receipt is still counted once. All of
-- a customer's orders are counted, cancelled ones included, so the number
-- matches the order history on the detail screen.

create or replace function public.get_customers()
returns table(
  id uuid,
  customer_code text,
  business_name text,
  brand_name text,
  tin text,
  contact_person text,
  phone text,
  email text,
  delivery_address text,
  notes text,
  status public.record_status,
  archived_at timestamptz,
  order_count bigint,
  last_order_date date
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'Only administrators and administrative staff can view customers' using errcode = '42501';
  end if;
  return query
    select c.id, c.customer_code, c.business_name, c.brand_name, c.tin, c.contact_person, c.phone, c.email, c.delivery_address, c.notes,
      c.status, c.archived_at, coalesce(o.order_count, 0), o.last_order_date
    from public.customers c
    left join (
      select customer_id, count(*) as order_count, max(requested_delivery_date) as last_order_date
      from public.orders group by customer_id
    ) o on o.customer_id = c.id
    order by lower(coalesce(c.brand_name, c.business_name)), c.customer_code;
end;
$$;
revoke all on function public.get_customers() from public, anon;
grant execute on function public.get_customers() to authenticated;

-- Usual products: the products set as preferred for the customer first, then
-- the ones they order most often (not counting cancelled orders), up to 8.
create or replace function public.get_customer_profile(p_customer_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_customer public.customers;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'Only administrators and administrative staff can view customers' using errcode = '42501';
  end if;
  select * into v_customer from public.customers where id = p_customer_id;
  if not found then raise exception 'Customer not found'; end if;

  select jsonb_build_object(
    'customer', to_jsonb(v_customer),
    'order_count', (select count(*) from public.orders o where o.customer_id = p_customer_id),
    'last_order_date', (select max(o.requested_delivery_date) from public.orders o where o.customer_id = p_customer_id),
    'usual_products', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', u.product_id, 'product_name', u.product_name, 'preferred', u.preferred, 'times_ordered', u.times_ordered) order by u.rank_group, u.sort_key, u.product_name)
      from (
        select p.id as product_id, p.product_name, pref.customer_id is not null as preferred,
          coalesce(hist.times_ordered, 0) as times_ordered,
          case when pref.customer_id is not null then 0 else 1 end as rank_group,
          case when pref.customer_id is not null then coalesce(pref.ranking, 32767) else -coalesce(hist.times_ordered, 0) end as sort_key
        from public.products p
        left join public.customer_product_preferences pref on pref.product_id = p.id and pref.customer_id = p_customer_id
        left join (
          select oi.product_id, count(distinct oi.order_id) as times_ordered
          from public.order_items oi join public.orders o on o.id = oi.order_id
          where o.customer_id = p_customer_id and o.status <> 'cancelled'
          group by oi.product_id
        ) hist on hist.product_id = p.id
        where pref.customer_id is not null or hist.product_id is not null
        order by rank_group, sort_key, p.product_name
        limit 8
      ) u
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_customer_profile(uuid) from public, anon;
grant execute on function public.get_customer_profile(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Writing
-- ---------------------------------------------------------------------------

create or replace function public.save_customer(p_customer_id uuid, p_customer jsonb, p_client_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_replay jsonb;
  v_before public.customers;
  v_row public.customers;
  v_changed text[];
  v_result jsonb;
  v_other text;
  v_code text := nullif(trim(coalesce(p_customer->>'customer_code', '')), '');
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'Only administrators and administrative staff can add or edit customers' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('save_customer', p_client_request_id,
    jsonb_build_object('customer_id', p_customer_id, 'customer', p_customer));
  if v_replay is not null then return v_replay; end if;

  if v_code is not null then
    select coalesce(brand_name, business_name) into v_other from public.customers
      where customer_code = v_code and id is distinct from p_customer_id limit 1;
    if v_other is not null then
      raise exception 'Customer code % is already used by %', v_code, v_other;
    end if;
  end if;

  if p_customer_id is null then
    insert into public.customers (customer_code, business_name, brand_name, tin, contact_person, phone, email, delivery_address, notes)
    values (p_customer->>'customer_code', p_customer->>'business_name', p_customer->>'brand_name', p_customer->>'tin', p_customer->>'contact_person',
      p_customer->>'phone', p_customer->>'email', p_customer->>'delivery_address', p_customer->>'notes')
    returning * into v_row;
    insert into public.customer_activity (customer_id, user_id, action) values (v_row.id, auth.uid(), 'created');
  else
    select * into v_before from public.customers where id = p_customer_id for update;
    if not found then raise exception 'Customer not found'; end if;
    update public.customers set
      customer_code = p_customer->>'customer_code',
      business_name = p_customer->>'business_name',
      -- An app that doesn't send these fields leaves them as they are.
      brand_name = case when p_customer ? 'brand_name' then p_customer->>'brand_name' else v_before.brand_name end,
      tin = case when p_customer ? 'tin' then p_customer->>'tin' else v_before.tin end,
      contact_person = p_customer->>'contact_person',
      phone = p_customer->>'phone',
      email = p_customer->>'email',
      delivery_address = p_customer->>'delivery_address',
      notes = p_customer->>'notes'
    where id = p_customer_id
    returning * into v_row;
    select array_agg(key order by key) into v_changed
    from jsonb_each(to_jsonb(v_row)) n
    join jsonb_each(to_jsonb(v_before)) b using (key)
    where key not in ('updated_at') and n.value is distinct from b.value;
    if v_changed is not null then
      insert into public.customer_activity (customer_id, user_id, action, details)
      values (v_row.id, auth.uid(), 'updated', jsonb_build_object('fields', to_jsonb(v_changed)));
    end if;
  end if;

  v_result := jsonb_build_object('customer_id', v_row.id, 'business_name', v_row.business_name, 'brand_name', v_row.brand_name, 'status', v_row.status);
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
exception when unique_violation then
  raise exception 'Customer code % is already used by another customer', coalesce(v_code, '') using errcode = '23505';
end;
$$;
revoke all on function public.save_customer(uuid, jsonb, uuid) from public, anon;
grant execute on function public.save_customer(uuid, jsonb, uuid) to authenticated;

-- Archiving hides the customer from new orders and keeps every order, delivery
-- and receipt. Restoring makes them available again. Asking for the state the
-- customer is already in changes nothing and logs nothing.
create or replace function public.set_customer_archived(p_customer_id uuid, p_archived boolean, p_client_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_replay jsonb;
  v_row public.customers;
  v_target public.record_status := case when p_archived then 'archived' else 'active' end;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'Only administrators and administrative staff can archive or restore customers' using errcode = '42501';
  end if;
  if p_archived is null then raise exception 'Choose archive or restore' using errcode = '22023'; end if;
  v_replay := public.begin_client_request('set_customer_archived', p_client_request_id,
    jsonb_build_object('customer_id', p_customer_id, 'archived', p_archived));
  if v_replay is not null then return v_replay; end if;

  select * into v_row from public.customers where id = p_customer_id for update;
  if not found then raise exception 'Customer not found'; end if;
  if v_row.status <> v_target then
    update public.customers set status = v_target, archived_at = null where id = p_customer_id returning * into v_row;
    insert into public.customer_activity (customer_id, user_id, action)
    values (p_customer_id, auth.uid(), case when p_archived then 'archived' else 'restored' end);
  end if;

  v_result := jsonb_build_object('customer_id', v_row.id, 'business_name', v_row.business_name, 'status', v_row.status);
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;
revoke all on function public.set_customer_archived(uuid, boolean, uuid) from public, anon;
grant execute on function public.set_customer_archived(uuid, boolean, uuid) to authenticated;
