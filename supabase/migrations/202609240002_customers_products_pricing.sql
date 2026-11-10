-- MEAH customer, catalogue, and pricing foundation. Apply after 202609240001.

create type public.record_status as enum ('active', 'archived');

create function public.has_app_role(allowed_roles public.profile_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'active' and role = any(allowed_roles)
  );
$$;
revoke all on function public.has_app_role(public.profile_role[]) from public;
grant execute on function public.has_app_role(public.profile_role[]) to authenticated;

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text not null unique,
  business_name text not null,
  contact_person text,
  phone text,
  email text,
  delivery_address text,
  notes text,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint customers_archived_state check (
    (status = 'active' and archived_at is null) or
    (status = 'archived' and archived_at is not null)
  )
);
create index customers_active_name_idx on public.customers (business_name) where status = 'active';
create index customers_code_idx on public.customers (customer_code);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  product_name text not null unique,
  description text,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint products_archived_state check (
    (status = 'active' and archived_at is null) or
    (status = 'archived' and archived_at is not null)
  )
);
create index products_active_name_idx on public.products (product_name) where status = 'active';

create table public.product_skus (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  buying_sku text,
  selling_sku text,
  unit_of_measurement text not null,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_skus_reference_present check (buying_sku is not null or selling_sku is not null)
);
create unique index product_skus_buying_sku_unique on public.product_skus (buying_sku) where buying_sku is not null;
create unique index product_skus_selling_sku_unique on public.product_skus (selling_sku) where selling_sku is not null;
create index product_skus_product_idx on public.product_skus (product_id);

create table public.product_varieties (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  variety_name text not null,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, variety_name)
);
create index product_varieties_product_idx on public.product_varieties (product_id);

create table public.customer_product_preferences (
  customer_id uuid not null references public.customers(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  ranking smallint,
  created_at timestamptz not null default now(),
  primary key (customer_id, product_id),
  constraint customer_product_preferences_ranking check (ranking is null or ranking > 0)
);
create index customer_product_preferences_customer_idx on public.customer_product_preferences (customer_id, ranking);

create table public.price_history (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  product_sku_id uuid references public.product_skus(id) on delete restrict,
  cost_price numeric(12, 2) not null check (cost_price >= 0),
  selling_price numeric(12, 2) not null check (selling_price >= 0),
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint price_history_effective_dates check (effective_to is null or effective_to > effective_from)
);
create index price_history_lookup_idx on public.price_history (product_id, product_sku_id, effective_from desc);

create table public.customer_pricing (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  product_sku_id uuid references public.product_skus(id) on delete restrict,
  selling_price numeric(12, 2) not null check (selling_price >= 0),
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint customer_pricing_effective_dates check (effective_to is null or effective_to > effective_from)
);
create index customer_pricing_lookup_idx on public.customer_pricing (customer_id, product_id, product_sku_id, effective_from desc);

-- Protect against attaching an SKU from a different product to a price row.
create function public.ensure_price_sku_matches_product()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.product_sku_id is not null and not exists (
    select 1 from public.product_skus where id = new.product_sku_id and product_id = new.product_id
  ) then
    raise exception 'The selected SKU does not belong to this product';
  end if;
  return new;
end;
$$;
create trigger price_history_sku_product_check before insert or update on public.price_history for each row execute procedure public.ensure_price_sku_matches_product();
create trigger customer_pricing_sku_product_check before insert or update on public.customer_pricing for each row execute procedure public.ensure_price_sku_matches_product();

create trigger customers_set_updated_at before update on public.customers for each row execute procedure public.set_updated_at();
create trigger products_set_updated_at before update on public.products for each row execute procedure public.set_updated_at();
create trigger product_skus_set_updated_at before update on public.product_skus for each row execute procedure public.set_updated_at();
create trigger product_varieties_set_updated_at before update on public.product_varieties for each row execute procedure public.set_updated_at();

alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.product_skus enable row level security;
alter table public.product_varieties enable row level security;
alter table public.customer_product_preferences enable row level security;
alter table public.price_history enable row level security;
alter table public.customer_pricing enable row level security;

revoke all on public.customers, public.products, public.product_skus, public.product_varieties, public.customer_product_preferences, public.price_history, public.customer_pricing from anon;
revoke all on public.customers, public.products, public.product_skus, public.product_varieties, public.customer_product_preferences, public.price_history, public.customer_pricing from authenticated;
grant select on public.customers, public.products, public.product_skus, public.product_varieties, public.customer_product_preferences, public.price_history, public.customer_pricing to authenticated;
grant insert, update on public.customers, public.products, public.product_skus, public.product_varieties, public.customer_product_preferences, public.customer_pricing to authenticated;
grant insert on public.price_history to authenticated;

-- Active internal staff can read the catalogue and customer records. Operational
-- staff cannot mutate master data. Administrators and administrative staff can.
create policy "active_staff_read_customers" on public.customers for select to authenticated using (public.has_app_role(array['administrator','administrative_staff','fulfillment_staff','delivery_staff']::public.profile_role[]));
create policy "management_write_customers" on public.customers for all to authenticated using (public.has_app_role(array['administrator','administrative_staff']::public.profile_role[])) with check (public.has_app_role(array['administrator','administrative_staff']::public.profile_role[]));
create policy "active_staff_read_products" on public.products for select to authenticated using (public.has_app_role(array['administrator','administrative_staff','fulfillment_staff','delivery_staff']::public.profile_role[]));
create policy "management_write_products" on public.products for all to authenticated using (public.has_app_role(array['administrator','administrative_staff']::public.profile_role[])) with check (public.has_app_role(array['administrator','administrative_staff']::public.profile_role[]));

create policy "active_staff_read_skus" on public.product_skus for select to authenticated using (public.has_app_role(array['administrator','administrative_staff','fulfillment_staff','delivery_staff']::public.profile_role[]));
create policy "management_write_skus" on public.product_skus for all to authenticated using (public.has_app_role(array['administrator','administrative_staff']::public.profile_role[])) with check (public.has_app_role(array['administrator','administrative_staff']::public.profile_role[]));
create policy "active_staff_read_varieties" on public.product_varieties for select to authenticated using (public.has_app_role(array['administrator','administrative_staff','fulfillment_staff','delivery_staff']::public.profile_role[]));
create policy "management_write_varieties" on public.product_varieties for all to authenticated using (public.has_app_role(array['administrator','administrative_staff']::public.profile_role[])) with check (public.has_app_role(array['administrator','administrative_staff']::public.profile_role[]));
create policy "active_staff_read_preferences" on public.customer_product_preferences for select to authenticated using (public.has_app_role(array['administrator','administrative_staff','fulfillment_staff','delivery_staff']::public.profile_role[]));
create policy "management_write_preferences" on public.customer_product_preferences for all to authenticated using (public.has_app_role(array['administrator','administrative_staff']::public.profile_role[])) with check (public.has_app_role(array['administrator','administrative_staff']::public.profile_role[]));

create policy "active_staff_read_price_history" on public.price_history for select to authenticated using (public.has_app_role(array['administrator','administrative_staff','fulfillment_staff','delivery_staff']::public.profile_role[]));
create policy "management_insert_price_history" on public.price_history for insert to authenticated with check (public.has_app_role(array['administrator','administrative_staff']::public.profile_role[]) and created_by = auth.uid());
create policy "active_staff_read_customer_pricing" on public.customer_pricing for select to authenticated using (public.has_app_role(array['administrator','administrative_staff','fulfillment_staff','delivery_staff']::public.profile_role[]));
create policy "management_write_customer_pricing" on public.customer_pricing for all to authenticated using (public.has_app_role(array['administrator','administrative_staff']::public.profile_role[])) with check (public.has_app_role(array['administrator','administrative_staff']::public.profile_role[]) and created_by = auth.uid());

-- Prices are historical facts. Do not grant UPDATE/DELETE on price_history.
