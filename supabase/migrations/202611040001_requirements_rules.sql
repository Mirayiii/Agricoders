-- Requirements document REQUIREMENTS_ENGINEERING-v1.28.10.2026 (Revision 2.1)
-- is the source of truth for business rules (Jac, 4 Nov 2026). This migration
-- applies the rules it settles:
--
--   * SI-02, PS-01 to PS-03, RE-05: only the administrator manages the product
--     catalog, prices (including customer prices) and stock. Administrative
--     staff still read products and prices to create orders; every staff role
--     still reads stock levels and order quantities.
--   * CU-01: only the administrator archives customers. The document says
--     nothing about restoring, so restoring follows the same rule for now
--     (flagged to Jac). Customers gain business type and preferred delivery
--     window, both optional so existing records stay valid.
--   * DE-03: the delivery receipt can be issued (and downloaded) from
--     Confirmed by the administrator, administrative staff and the assigned
--     delivery staff. How receipts are stored is unchanged: an issued receipt
--     keeps its contents and DR number.
--   * DE-04: only delivery staff (their own assigned stops) and the
--     administrator mark a delivery completed, on every route that can do it.
--
-- Existing functions are changed in place by exact text replacement, so each
-- one keeps its body, grants and owner. Every replacement must match exactly
-- once, otherwise the migration stops.

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
-- 1. Products, prices and stock: administrator only
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn regprocedure;
  v_old text := 'public.has_app_role(array[''administrator'', ''administrative_staff'']::public.profile_role[])';
begin
  foreach v_fn in array array[
    'public.create_product(jsonb, uuid)'::regprocedure,
    'public.update_product(uuid, jsonb, uuid)'::regprocedure,
    'public.set_product_archived(uuid, boolean, uuid)'::regprocedure,
    'public.set_product_price(uuid, numeric, numeric, uuid)'::regprocedure,
    'public.batch_update_prices(date, jsonb, uuid)'::regprocedure,
    'public.get_batch_price_sheet(date, date)'::regprocedure,
    'public.get_price_history(uuid)'::regprocedure,
    'public.get_products_overview()'::regprocedure
  ] loop
    perform pg_temp.patch_function(v_fn, v_old, 'public.is_active_administrator()');
    if v_fn <> 'public.get_products_overview()'::regprocedure then
      perform pg_temp.patch_function(v_fn, 'Only administrators and administrative staff can change products and prices',
        'Only an administrator can change products, prices and stock');
    end if;
  end loop;
end;
$$;

do $$ begin perform pg_temp.patch_function('public.adjust_inventory(uuid, public.inventory_transaction_type, numeric, text, numeric)'::regprocedure,
  'public.has_app_role(array[''administrator'', ''administrative_staff'', ''fulfillment_staff'']::public.profile_role[])',
  'public.is_active_administrator()'); end $$;
do $$ begin perform pg_temp.patch_function('public.adjust_inventory(uuid, public.inventory_transaction_type, numeric, text, numeric)'::regprocedure,
  'You do not have permission to adjust inventory', 'Only an administrator can adjust stock'); end $$;

-- Direct table writes follow the same rule. Reads are unchanged.
drop policy if exists "management_write_products" on public.products;
create policy "administrator_write_products" on public.products for all to authenticated
  using (public.is_active_administrator()) with check (public.is_active_administrator());

drop policy if exists "management_write_skus" on public.product_skus;
create policy "administrator_write_skus" on public.product_skus for all to authenticated
  using (public.is_active_administrator()) with check (public.is_active_administrator());

drop policy if exists "management_write_varieties" on public.product_varieties;
create policy "administrator_write_varieties" on public.product_varieties for all to authenticated
  using (public.is_active_administrator()) with check (public.is_active_administrator());

drop policy if exists "management_insert_price_history" on public.price_history;
create policy "administrator_insert_price_history" on public.price_history for insert to authenticated
  with check (public.is_active_administrator() and created_by = auth.uid());

drop policy if exists "management_write_customer_pricing" on public.customer_pricing;
create policy "administrator_write_customer_pricing" on public.customer_pricing for all to authenticated
  using (public.is_active_administrator())
  with check (public.is_active_administrator() and created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Customers: archive and restore by the administrator only (CU-01)
-- ---------------------------------------------------------------------------

do $$ begin perform pg_temp.patch_function('public.set_customer_archived(uuid, boolean, uuid)'::regprocedure,
  'public.has_app_role(array[''administrator'', ''administrative_staff'']::public.profile_role[])',
  'public.is_active_administrator()'); end $$;
do $$ begin perform pg_temp.patch_function('public.set_customer_archived(uuid, boolean, uuid)'::regprocedure,
  'Only administrators and administrative staff can archive or restore customers',
  'Only an administrator can archive or restore customers'); end $$;

-- Administrative staff still add and edit customers through the table policy,
-- so a status change by anyone else is refused here. Server jobs and
-- migrations (no signed-in user) are not affected.
create or replace function public.customers_archive_by_administrator()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_active_administrator()
     and ((tg_op = 'INSERT' and new.status <> 'active') or (tg_op = 'UPDATE' and new.status is distinct from old.status)) then
    raise exception 'Only an administrator can archive or restore customers' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists customers_archive_by_administrator on public.customers;
create trigger customers_archive_by_administrator before insert or update of status on public.customers
  for each row execute procedure public.customers_archive_by_administrator();

-- Business type and preferred delivery window (CU-01). Optional.
alter table public.customers add column if not exists business_type text;
alter table public.customers add column if not exists preferred_delivery_window text;
alter table public.customers drop constraint if exists customers_business_type_length;
alter table public.customers add constraint customers_business_type_length check (char_length(business_type) <= 80);
alter table public.customers drop constraint if exists customers_delivery_window_length;
alter table public.customers add constraint customers_delivery_window_length check (char_length(preferred_delivery_window) <= 120);

do $$ begin perform pg_temp.patch_function('public.save_customer(uuid, jsonb, uuid)'::regprocedure,
  'insert into public.customers (customer_code, business_name, brand_name, tin, contact_person, phone, email, delivery_address, notes)',
  'insert into public.customers (customer_code, business_name, brand_name, tin, contact_person, phone, email, delivery_address, notes, business_type, preferred_delivery_window)'); end $$;
do $$ begin perform pg_temp.patch_function('public.save_customer(uuid, jsonb, uuid)'::regprocedure,
  'p_customer->>''phone'', p_customer->>''email'', p_customer->>''delivery_address'', p_customer->>''notes'')',
  'p_customer->>''phone'', p_customer->>''email'', p_customer->>''delivery_address'', p_customer->>''notes'',
      nullif(regexp_replace(trim(coalesce(p_customer->>''business_type'', '''')), ''\s+'', '' '', ''g''), ''''),
      nullif(trim(coalesce(p_customer->>''preferred_delivery_window'', '''')), ''''))'); end $$;
do $$ begin perform pg_temp.patch_function('public.save_customer(uuid, jsonb, uuid)'::regprocedure,
  '      notes = p_customer->>''notes''
    where id = p_customer_id',
  '      notes = p_customer->>''notes'',
      business_type = case when p_customer ? ''business_type''
        then nullif(regexp_replace(trim(coalesce(p_customer->>''business_type'', '''')), ''\s+'', '' '', ''g''), '''') else v_before.business_type end,
      preferred_delivery_window = case when p_customer ? ''preferred_delivery_window''
        then nullif(trim(coalesce(p_customer->>''preferred_delivery_window'', '''')), '''') else v_before.preferred_delivery_window end
    where id = p_customer_id'); end $$;

-- The list returns the new columns too (its result type changes, so it is recreated).
drop function if exists public.get_customers();
create function public.get_customers()
returns table(
  id uuid, customer_code text, business_name text, brand_name text, tin text, contact_person text, phone text, email text,
  delivery_address text, notes text, business_type text, preferred_delivery_window text,
  status public.record_status, archived_at timestamptz, order_count bigint, last_order_date date
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'Only administrators and administrative staff can view customers' using errcode = '42501';
  end if;
  return query
    select c.id, c.customer_code, c.business_name, c.brand_name, c.tin, c.contact_person, c.phone, c.email, c.delivery_address, c.notes,
      c.business_type, c.preferred_delivery_window,
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

-- ---------------------------------------------------------------------------
-- 3. Delivery receipt from Confirmed (DE-03)
-- ---------------------------------------------------------------------------

do $$ begin perform pg_temp.patch_function('public.issue_delivery_receipt(uuid, uuid)'::regprocedure,
  '  if not public.has_app_role(array[''administrator'', ''administrative_staff'']::public.profile_role[]) then
    raise exception ''Only administrators and administrative staff can issue delivery receipts'' using errcode = ''42501'';
  end if;',
  '  if not public.has_app_role(array[''administrator'', ''administrative_staff'', ''delivery_staff'']::public.profile_role[]) then
    raise exception ''You do not have permission to issue delivery receipts'' using errcode = ''42501'';
  end if;
  -- Delivery staff only for their own assigned stop.
  if not public.has_app_role(array[''administrator'', ''administrative_staff'']::public.profile_role[])
     and not exists (select 1 from public.deliveries d where d.order_id = p_order_id and d.assigned_driver_id = auth.uid()) then
    raise exception ''You can only get receipts for your own stops'' using errcode = ''42501'';
  end if;'); end $$;
do $$ begin perform pg_temp.patch_function('public.issue_delivery_receipt(uuid, uuid)'::regprocedure,
  'if v_status not in (''for_preparation'', ''for_delivery'', ''completed'') then',
  'if v_status not in (''confirmed'', ''for_preparation'', ''for_delivery'', ''completed'') then'); end $$;
do $$ begin perform pg_temp.patch_function('public.issue_delivery_receipt(uuid, uuid)'::regprocedure,
  'else ''A delivery receipt can be issued once the order is being packed.'' end;',
  'else ''A delivery receipt can be issued once the order is confirmed.'' end;'); end $$;

-- ---------------------------------------------------------------------------
-- 4. Delivery completion: delivery staff (own stops) and the administrator (DE-04)
-- ---------------------------------------------------------------------------

do $$ begin perform pg_temp.patch_function('public.complete_delivery(uuid, text, uuid)'::regprocedure,
  'v_is_management boolean := public.has_app_role(array[''administrator'', ''administrative_staff'']::public.profile_role[]);',
  'v_is_management boolean := public.is_active_administrator();'); end $$;
do $$ begin perform pg_temp.patch_function('public.complete_delivery(uuid, text, uuid)'::regprocedure,
  '  if not public.has_app_role(array[''administrator'', ''administrative_staff'', ''delivery_staff'']::public.profile_role[]) then
    raise exception ''You do not have permission to confirm deliveries'' using errcode = ''42501'';',
  '  if not public.has_app_role(array[''administrator'', ''delivery_staff'']::public.profile_role[]) then
    raise exception ''Only delivery staff and administrators can mark deliveries delivered'' using errcode = ''42501'';'); end $$;

do $$ begin perform pg_temp.patch_function('public.offline_complete_delivery(uuid, text, uuid, jsonb)'::regprocedure,
  'if not public.has_app_role(array[''administrator'', ''administrative_staff'', ''delivery_staff'']::public.profile_role[]) then',
  'if not public.has_app_role(array[''administrator'', ''delivery_staff'']::public.profile_role[]) then'); end $$;
do $$ begin perform pg_temp.patch_function('public.offline_complete_delivery(uuid, text, uuid, jsonb)'::regprocedure,
  '  if not public.has_app_role(array[''administrator'', ''administrative_staff'']::public.profile_role[])
     and v_row.assigned_driver_id is distinct from auth.uid() then',
  '  if not public.is_active_administrator()
     and v_row.assigned_driver_id is distinct from auth.uid() then'); end $$;

-- The older general status action: administrative staff may still start and
-- cancel a delivery (dispatch), but completing it follows DE-04.
do $$ begin perform pg_temp.patch_function('public.update_delivery_status(uuid, public.delivery_status, text)'::regprocedure,
  '  elsif v_current = ''for_delivery'' and p_status = ''completed'' then
    if v_order_status <> ''for_delivery'' then',
  '  elsif v_current = ''for_delivery'' and p_status = ''completed'' then
    if v_is_management and not public.is_active_administrator() then
      raise exception ''Only delivery staff and administrators can mark deliveries delivered'' using errcode = ''42501'';
    end if;
    if v_order_status <> ''for_delivery'' then'); end $$;
