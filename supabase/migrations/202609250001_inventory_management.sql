-- MEAH SKU inventory and append-only stock activity.

create type public.inventory_status as enum ('available', 'low_stock', 'out_of_stock');
create type public.inventory_transaction_type as enum ('increase', 'decrease', 'adjustment');

create table public.inventory (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null unique references public.product_skus(id) on delete restrict,
  current_quantity numeric(12,3) not null default 0 check (current_quantity >= 0),
  low_stock_threshold numeric(12,3) check (low_stock_threshold is null or low_stock_threshold >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inventory_sku_idx on public.inventory(sku_id);
create trigger inventory_set_updated_at before update on public.inventory for each row execute procedure public.set_updated_at();

create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  inventory_id uuid not null references public.inventory(id) on delete restrict,
  sku_id uuid not null references public.product_skus(id) on delete restrict,
  transaction_type public.inventory_transaction_type not null,
  quantity numeric(12,3) not null,
  previous_quantity numeric(12,3) not null check (previous_quantity >= 0),
  new_quantity numeric(12,3) not null check (new_quantity >= 0),
  reason text not null check (nullif(trim(reason), '') is not null),
  performed_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index inventory_transactions_inventory_created_idx on public.inventory_transactions(inventory_id, created_at desc);
create index inventory_transactions_sku_created_idx on public.inventory_transactions(sku_id, created_at desc);

alter table public.inventory enable row level security;
alter table public.inventory_transactions enable row level security;
revoke all on public.inventory, public.inventory_transactions from anon, authenticated;
grant select on public.inventory, public.inventory_transactions to authenticated;

create policy "operational_staff_read_inventory" on public.inventory for select to authenticated using (
  public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff', 'delivery_staff']::public.profile_role[])
);
create policy "inventory_managers_read_transactions" on public.inventory_transactions for select to authenticated using (
  public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[])
);

create or replace function public.get_inventory_status(p_quantity numeric, p_threshold numeric)
returns public.inventory_status language sql immutable as $$
  select case when p_quantity <= 0 then 'out_of_stock'::public.inventory_status
              when p_threshold is not null and p_quantity <= p_threshold then 'low_stock'::public.inventory_status
              else 'available'::public.inventory_status end;
$$;
revoke all on function public.get_inventory_status(numeric, numeric) from public;

create or replace function public.adjust_inventory(
  p_sku_id uuid,
  p_transaction_type public.inventory_transaction_type,
  p_quantity numeric,
  p_reason text,
  p_low_stock_threshold numeric default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_inventory_id uuid;
  v_previous numeric(12,3);
  v_new numeric(12,3);
  v_unit text;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to adjust inventory';
  end if;
  if p_quantity is null or p_quantity < 0 then raise exception 'Quantity must be zero or greater'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'A reason is required for inventory changes'; end if;
  if not exists(select 1 from public.product_skus where id = p_sku_id and status = 'active') then raise exception 'Selected SKU is unavailable'; end if;

  insert into public.inventory(sku_id, current_quantity, low_stock_threshold)
  values (p_sku_id, 0, p_low_stock_threshold)
  on conflict (sku_id) do nothing;

  select id, current_quantity into v_inventory_id, v_previous from public.inventory where sku_id = p_sku_id for update;
  v_new := case p_transaction_type when 'increase' then v_previous + p_quantity when 'decrease' then v_previous - p_quantity else p_quantity end;
  if v_new < 0 then raise exception 'Stock cannot be reduced below zero'; end if;

  update public.inventory set current_quantity = v_new, low_stock_threshold = coalesce(p_low_stock_threshold, low_stock_threshold) where id = v_inventory_id;
  insert into public.inventory_transactions(inventory_id, sku_id, transaction_type, quantity, previous_quantity, new_quantity, reason, performed_by)
  values (v_inventory_id, p_sku_id, p_transaction_type, p_quantity, v_previous, v_new, trim(p_reason), auth.uid());
  return v_inventory_id;
end;
$$;
revoke all on function public.adjust_inventory(uuid, public.inventory_transaction_type, numeric, text, numeric) from public;
grant execute on function public.adjust_inventory(uuid, public.inventory_transaction_type, numeric, text, numeric) to authenticated;

create or replace function public.get_inventory_list(p_search text default null, p_status public.inventory_status default null, p_limit integer default 25, p_offset integer default 0)
returns table(inventory_id uuid, sku_id uuid, product_name text, sku text, unit text, current_quantity numeric, low_stock_threshold numeric, status public.inventory_status, updated_at timestamptz, total_rows bigint)
language sql stable security definer set search_path = public as $$
  select i.id, ps.id, p.product_name, coalesce(ps.selling_sku, ps.buying_sku), ps.unit_of_measurement, coalesce(i.current_quantity, 0), i.low_stock_threshold, public.get_inventory_status(coalesce(i.current_quantity, 0), i.low_stock_threshold), i.updated_at, count(*) over()
  from public.product_skus ps join public.products p on p.id = ps.product_id left join public.inventory i on i.sku_id = ps.id
  where public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff', 'delivery_staff']::public.profile_role[])
    and ps.status = 'active' and p.status = 'active'
    and (p_search is null or p.product_name ilike '%' || p_search || '%' or coalesce(ps.selling_sku, ps.buying_sku) ilike '%' || p_search || '%')
    and (p_status is null or public.get_inventory_status(coalesce(i.current_quantity, 0), i.low_stock_threshold) = p_status)
  order by p.product_name, coalesce(ps.selling_sku, ps.buying_sku) limit greatest(1, least(coalesce(p_limit, 25), 100)) offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.get_inventory_list(text, public.inventory_status, integer, integer) from public;
grant execute on function public.get_inventory_list(text, public.inventory_status, integer, integer) to authenticated;

create or replace function public.get_inventory_activity(p_sku_id uuid, p_limit integer default 20)
returns table(id uuid, transaction_type public.inventory_transaction_type, quantity numeric, previous_quantity numeric, new_quantity numeric, reason text, created_at timestamptz, performed_by_name text)
language sql stable security definer set search_path = public as $$
  select t.id, t.transaction_type, t.quantity, t.previous_quantity, t.new_quantity, t.reason, t.created_at, coalesce(p.full_name, p.email)
  from public.inventory_transactions t join public.profiles p on p.id = t.performed_by
  where t.sku_id = p_sku_id and public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff']::public.profile_role[])
  order by t.created_at desc limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;
revoke all on function public.get_inventory_activity(uuid, integer) from public;
grant execute on function public.get_inventory_activity(uuid, integer) to authenticated;

create or replace function public.get_product_inventory_availability(p_product_ids uuid[])
returns table(product_id uuid, sku_id uuid, sku text, unit text, current_quantity numeric, status public.inventory_status)
language sql stable security definer set search_path = public as $$
  select ps.product_id, ps.id, coalesce(ps.selling_sku, ps.buying_sku), ps.unit_of_measurement,
    coalesce(i.current_quantity, 0), public.get_inventory_status(coalesce(i.current_quantity, 0), i.low_stock_threshold)
  from public.product_skus ps left join public.inventory i on i.sku_id = ps.id
  where ps.product_id = any(p_product_ids) and ps.status = 'active'
    and public.has_app_role(array['administrator', 'administrative_staff', 'fulfillment_staff', 'delivery_staff']::public.profile_role[])
  order by ps.product_id, coalesce(ps.selling_sku, ps.buying_sku);
$$;
revoke all on function public.get_product_inventory_availability(uuid[]) from public;
grant execute on function public.get_product_inventory_availability(uuid[]) to authenticated;
