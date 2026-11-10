-- MEAH order management. Apply after catalogue and pricing migrations.

create type public.order_source as enum ('viber', 'messenger', 'phone', 'purchase_order', 'other');
create type public.order_status as enum ('for_verification', 'confirmed', 'for_preparation', 'for_delivery', 'completed', 'cancelled');

create sequence public.order_number_sequence start 1;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('ORD-' || lpad(nextval('public.order_number_sequence')::text, 4, '0')),
  customer_id uuid not null references public.customers(id) on delete restrict,
  order_source public.order_source not null,
  purchase_order_reference text,
  encoded_by uuid not null references public.profiles(id) on delete restrict,
  status public.order_status not null default 'for_verification',
  requested_delivery_date date not null,
  requires_attention boolean not null default false,
  attention_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_attention_reason check ((requires_attention and nullif(trim(attention_reason), '') is not null) or not requires_attention)
);
create index orders_customer_date_idx on public.orders (customer_id, requested_delivery_date desc);
create index orders_status_date_idx on public.orders (status, requested_delivery_date);
create index orders_attention_idx on public.orders (requires_attention) where requires_attention;
create index orders_number_idx on public.orders (order_number);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  product_sku_id uuid references public.product_skus(id) on delete restrict,
  variety_id uuid references public.product_varieties(id) on delete restrict,
  quantity numeric(12, 3) not null check (quantity > 0),
  unit_of_measurement text not null,
  unit_price numeric(12, 2) not null check (unit_price >= 0),
  original_unit_price numeric(12, 2) not null check (original_unit_price >= 0),
  cost_price numeric(12, 2) not null check (cost_price >= 0),
  special_price numeric(12, 2),
  special_price_reason text,
  special_price_authorized_by uuid references public.profiles(id) on delete restrict,
  special_price_authorized_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  constraint order_items_special_price check ((special_price is null and special_price_reason is null and special_price_authorized_by is null and special_price_authorized_at is null) or (special_price is not null and nullif(trim(special_price_reason), '') is not null and special_price_authorized_by is not null and special_price_authorized_at is not null))
);
create index order_items_order_idx on public.order_items (order_id);

create table public.order_activity (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index order_activity_order_idx on public.order_activity (order_id, created_at desc);

create trigger orders_set_updated_at before update on public.orders for each row execute procedure public.set_updated_at();

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_activity enable row level security;
revoke all on public.orders, public.order_items, public.order_activity from anon, authenticated;
grant select on public.orders, public.order_items, public.order_activity to authenticated;
grant insert, update on public.orders, public.order_items, public.order_activity to authenticated;

create policy "active_staff_read_orders" on public.orders for select to authenticated using (public.has_app_role(array['administrator','administrative_staff','fulfillment_staff','delivery_staff']::public.profile_role[]));
create policy "active_staff_read_order_items" on public.order_items for select to authenticated using (public.has_app_role(array['administrator','administrative_staff','fulfillment_staff','delivery_staff']::public.profile_role[]));
create policy "active_staff_read_order_activity" on public.order_activity for select to authenticated using (public.has_app_role(array['administrator','administrative_staff','fulfillment_staff','delivery_staff']::public.profile_role[]));
-- Direct mutations are limited to pre-verification editing by administrative users.
create policy "administrative_edit_unverified_orders" on public.orders for update to authenticated using (status = 'for_verification' and public.has_app_role(array['administrator','administrative_staff']::public.profile_role[])) with check (status = 'for_verification' and public.has_app_role(array['administrator','administrative_staff']::public.profile_role[]));

-- Atomic order creation. Price values sent by the mobile app are ignored unless
-- an active administrator deliberately supplies a special price and a reason.
create function public.create_order_with_items(p_order jsonb, p_items jsonb)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_sku_id uuid;
  v_variety_id uuid;
  v_price numeric(12,2);
  v_cost numeric(12,2);
  v_special numeric(12,2);
  v_special_reason text;
begin
  if not public.has_app_role(array['administrator','administrative_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to create orders';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'An order requires at least one item'; end if;
  if nullif(trim(coalesce(p_order->>'customer_id', '')), '') is null or nullif(trim(coalesce(p_order->>'requested_delivery_date', '')), '') is null then raise exception 'Customer and delivery date are required'; end if;
  if (p_order->>'requested_delivery_date')::date < current_date then raise exception 'Delivery date cannot be in the past'; end if;
  insert into public.orders (customer_id, order_source, purchase_order_reference, encoded_by, requested_delivery_date, requires_attention, attention_reason, notes)
  values ((p_order->>'customer_id')::uuid, (p_order->>'order_source')::public.order_source, nullif(trim(p_order->>'purchase_order_reference'), ''), auth.uid(), (p_order->>'requested_delivery_date')::date, coalesce((p_order->>'requires_attention')::boolean, false), nullif(trim(p_order->>'attention_reason'), ''), nullif(trim(p_order->>'notes'), '')) returning id into v_order_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid; v_sku_id := nullif(v_item->>'product_sku_id', '')::uuid; v_variety_id := nullif(v_item->>'variety_id', '')::uuid;
    if coalesce((v_item->>'quantity')::numeric, 0) <= 0 or nullif(trim(coalesce(v_item->>'unit_of_measurement', '')), '') is null then raise exception 'Every item needs a positive quantity and unit'; end if;
    if not exists(select 1 from public.products where id=v_product_id and status='active') then raise exception 'Selected product is unavailable'; end if;
    if v_sku_id is not null and not exists(select 1 from public.product_skus where id=v_sku_id and product_id=v_product_id and status='active') then raise exception 'Selected SKU does not belong to product'; end if;
    if v_variety_id is not null and not exists(select 1 from public.product_varieties where id=v_variety_id and product_id=v_product_id and status='active') then raise exception 'Selected variety does not belong to product'; end if;
    select cp.selling_price into v_price from public.customer_pricing cp where cp.customer_id=(p_order->>'customer_id')::uuid and cp.product_id=v_product_id and (cp.product_sku_id is not distinct from v_sku_id) and cp.effective_from <= now() and (cp.effective_to is null or cp.effective_to > now()) order by cp.effective_from desc limit 1;
    if v_price is null then select ph.selling_price, ph.cost_price into v_price, v_cost from public.price_history ph where ph.product_id=v_product_id and (ph.product_sku_id is not distinct from v_sku_id) and ph.effective_from <= now() and (ph.effective_to is null or ph.effective_to > now()) order by ph.effective_from desc limit 1; end if;
    if v_price is null then raise exception 'No active price exists for selected product'; end if;
    if v_cost is null then select ph.cost_price into v_cost from public.price_history ph where ph.product_id=v_product_id and (ph.product_sku_id is not distinct from v_sku_id) and ph.effective_from <= now() and (ph.effective_to is null or ph.effective_to > now()) order by ph.effective_from desc limit 1; end if;
    v_cost := coalesce(v_cost, 0); v_special := nullif(v_item->>'special_price', '')::numeric; v_special_reason := nullif(trim(v_item->>'special_price_reason'), '');
    if v_special is not null then
      if not public.is_active_administrator() or v_special_reason is null or v_special < 0 then raise exception 'Special pricing requires an administrator and reason'; end if;
    end if;
    insert into public.order_items (order_id,product_id,product_sku_id,variety_id,quantity,unit_of_measurement,unit_price,original_unit_price,cost_price,special_price,special_price_reason,special_price_authorized_by,special_price_authorized_at,notes)
    values (v_order_id,v_product_id,v_sku_id,v_variety_id,(v_item->>'quantity')::numeric,v_item->>'unit_of_measurement',coalesce(v_special,v_price),v_price,v_cost,v_special,v_special_reason,case when v_special is not null then auth.uid() end,case when v_special is not null then now() end,nullif(trim(v_item->>'notes'),''));
  end loop;
  insert into public.order_activity(order_id,user_id,action,details) values(v_order_id,auth.uid(),'created',jsonb_build_object('status','for_verification'));
  if coalesce((p_order->>'requires_attention')::boolean,false) then insert into public.order_activity(order_id,user_id,action,details) values(v_order_id,auth.uid(),'requires_attention',jsonb_build_object('reason',p_order->>'attention_reason')); end if;
  return v_order_id;
end;
$$;
revoke all on function public.create_order_with_items(jsonb,jsonb) from public;
grant execute on function public.create_order_with_items(jsonb,jsonb) to authenticated;
