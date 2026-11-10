-- A duplicate is deliberately a new order: pricing and validation remain in
-- create_order_with_items, while this wrapper records the source reference.
create or replace function public.create_duplicate_order_with_items(
  p_source_order_id uuid,
  p_order jsonb,
  p_items jsonb
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_new_order_id uuid;
begin
  if not public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]) then
    raise exception 'You do not have permission to create orders';
  end if;

  if p_source_order_id is null or not public.can_read_order(p_source_order_id) then
    raise exception 'The source order is unavailable';
  end if;

  -- The original function validates products, applies current customer/general
  -- prices, assigns a new number and starts the normal verification workflow.
  v_new_order_id := public.create_order_with_items(p_order, p_items);

  insert into public.order_activity(order_id, user_id, action, details)
  values (
    v_new_order_id,
    auth.uid(),
    'created_by_duplication',
    jsonb_build_object('source_order_id', p_source_order_id)
  );

  return v_new_order_id;
end;
$$;
revoke all on function public.create_duplicate_order_with_items(uuid,jsonb,jsonb) from public;
grant execute on function public.create_duplicate_order_with_items(uuid,jsonb,jsonb) to authenticated;
