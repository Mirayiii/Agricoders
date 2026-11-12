-- Delete product (prototype gap B5, Jac's "prototype wins", 5 Nov 2026).
--
-- The prototype's Stock tab has a red "Delete product" for administrators and
-- administrative staff: "It will be removed from products, stock and new
-- orders. Past orders keep their records."
--
-- A deleted product is kept as a row, so past orders, receipts, reports and
-- price history still show it. It is archived (so every "active only" rule
-- already keeps it out of new orders, pricing and To buy picks), marked with
-- who deleted it and when, and left out of Products & stock, including the
-- Archived list. It can't be restored.

create or replace function pg_temp.patch_all(p_function regprocedure, p_from text, p_to text, p_expected int default 1)
returns void language plpgsql as $$
declare
  v_def text := replace(pg_get_functiondef(p_function), E'\r', '');
  v_from text := replace(p_from, E'\r', '');
  v_count int := (length(v_def) - length(replace(v_def, v_from, ''))) / greatest(length(v_from), 1);
begin
  if v_count <> p_expected then
    raise exception 'patch_all: expected % match(es) in %, found % for: %', p_expected, p_function, v_count, p_from;
  end if;
  execute replace(v_def, v_from, replace(p_to, E'\r', ''));
end;
$$;

alter table public.products add column if not exists deleted_at timestamptz;
alter table public.products add column if not exists deleted_by uuid references public.profiles(id);

-- Guards that hold for direct table writes too.
create or replace function public.products_deleted_rules()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.deleted_at is not null then
    if new.deleted_at is null or new.status = 'active' then
      raise exception '% was deleted and can''t be restored.', old.product_name;
    end if;
    new.deleted_by := old.deleted_by;
    new.deleted_at := old.deleted_at;
    return new;
  end if;
  if new.deleted_at is not null then
    if public.is_app_call() and not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
      raise exception 'Only administrators and administrative staff can delete products' using errcode = '42501';
    end if;
    new.deleted_by := coalesce(auth.uid(), new.deleted_by);
    new.status := 'archived';
    new.archived_at := coalesce(new.archived_at, old.archived_at, now());
  end if;
  return new;
end;
$$;
drop trigger if exists products_deleted_rules on public.products;
create trigger products_deleted_rules before update on public.products
  for each row execute function public.products_deleted_rules();

create or replace function public.delete_product(p_product_id uuid, p_client_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_replay jsonb;
  v_row public.products;
  v_result jsonb;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'Only administrators and administrative staff can delete products' using errcode = '42501';
  end if;
  v_replay := public.begin_client_request('delete_product', p_client_request_id, jsonb_build_object('product_id', p_product_id));
  if v_replay is not null then return v_replay; end if;
  select * into v_row from public.products where id = p_product_id for update;
  if not found then raise exception 'Product not found'; end if;
  if v_row.deleted_at is null then
    update public.products set deleted_at = now() where id = p_product_id returning * into v_row;
  end if;
  v_result := jsonb_build_object('product_id', v_row.id, 'product_name', v_row.product_name, 'deleted', true);
  perform public.finish_client_request(p_client_request_id, v_result);
  return v_result;
end;
$$;
revoke all on function public.delete_product(uuid, uuid) from public, anon;
grant execute on function public.delete_product(uuid, uuid) to authenticated;

-- Restoring a deleted product is refused with a clear message.
do $$ begin perform pg_temp.patch_all('public.set_product_archived(uuid, boolean, uuid)'::regprocedure,
  '  if not found then raise exception ''Product not found''; end if;',
  '  if not found then raise exception ''Product not found''; end if;
  if v_row.deleted_at is not null then raise exception ''% was deleted and can''''t be restored.'', v_row.product_name; end if;'); end $$;

-- Products & stock (and its Archived page) leave deleted products out.
do $$ begin perform pg_temp.patch_all('public.get_products_overview()'::regprocedure,
  '    order by lower(p.product_name);',
  '    where p.deleted_at is null
    order by lower(p.product_name);'); end $$;
