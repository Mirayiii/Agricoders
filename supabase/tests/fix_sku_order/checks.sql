\set ON_ERROR_STOP 1
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
do $$
declare v int;
begin
  select count(*) into v from public.get_inventory_list(null, null, 25, 0);
  if v <> 2 then raise exception 'FAIL get_inventory_list returned % rows', v; end if;
  if (select string_agg(sku, ',' order by ord) from (select sku, row_number() over () ord from public.get_inventory_list(null, null, 25, 0)) x) <> 'B-Onions,S-Tomatoes' then
    raise exception 'FAIL get_inventory_list order';
  end if;
  select count(*) into v from public.get_product_inventory_availability(array(select id from public.products));
  if v <> 2 then raise exception 'FAIL get_product_inventory_availability returned % rows', v; end if;
  perform * from public.get_product_quantity_report(null, null, null, null);
  if (select count(*) from public.products) <> 2 or (select count(*) from public.inventory) <> 2 or (select count(*) from public.customers) <> 1 then
    raise exception 'FAIL data changed';
  end if;
  raise notice 'PASS functions work and data is intact';
end $$;
