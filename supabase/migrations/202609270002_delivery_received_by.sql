-- MEAH delivery confirmation: record who received the goods.
-- Apply after 202609270001. The lifecycle rules are unchanged from
-- 202609240008; the only additions are the received_by column and the
-- optional p_received_by argument, which is stored when a delivery completes.

alter table public.deliveries add column received_by text;

drop function if exists public.update_delivery_status(uuid, public.delivery_status);
create or replace function public.update_delivery_status(
  p_delivery_id uuid,
  p_status public.delivery_status,
  p_received_by text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_current public.delivery_status;
  v_order_status public.order_status;
  v_is_management boolean;
  v_received_by text := nullif(trim(coalesce(p_received_by, '')), '');
begin
  v_is_management := public.has_app_role(array['administrator', 'administrative_staff']::public.profile_role[]);

  select d.order_id, d.status, o.status
    into v_order_id, v_current, v_order_status
  from public.deliveries d
  join public.orders o on o.id = d.order_id
  where d.id = p_delivery_id
  for update of d, o;

  if v_order_id is null then
    raise exception 'Delivery not found';
  end if;
  if not v_is_management and not (
    public.has_app_role(array['delivery_staff']::public.profile_role[])
    and exists (
      select 1 from public.deliveries d
      where d.id = p_delivery_id and d.assigned_driver_id = auth.uid()
    )
  ) then
    raise exception 'You do not have delivery access';
  end if;

  if p_status = 'cancelled' then
    if not v_is_management or v_current = 'completed' then
      raise exception 'This delivery cannot be cancelled';
    end if;
  elsif v_current = 'scheduled' and p_status = 'for_delivery' then
    if v_order_status <> 'for_delivery' then
      raise exception 'The order must complete preparation before delivery starts';
    end if;
  elsif v_current = 'for_delivery' and p_status = 'completed' then
    if v_order_status <> 'for_delivery' then
      raise exception 'Only orders For Delivery can be completed';
    end if;
  else
    raise exception 'Invalid delivery status transition';
  end if;

  update public.deliveries
    set status = p_status,
        completed_at = case when p_status = 'completed' then now() else completed_at end,
        cancelled_at = case when p_status = 'cancelled' then now() else cancelled_at end,
        received_by = case when p_status = 'completed' then v_received_by else received_by end
    where id = p_delivery_id;

  insert into public.order_activity(order_id, user_id, action, details)
  values (
    v_order_id,
    auth.uid(),
    'delivery_status_changed',
    jsonb_build_object('from_status', v_current, 'to_status', p_status, 'delivery_id', p_delivery_id)
      || case when p_status = 'completed' and v_received_by is not null then jsonb_build_object('received_by', v_received_by) else '{}'::jsonb end
  );

  if p_status = 'completed' then
    update public.orders
      set status = 'completed'
      where id = v_order_id
        and status = 'for_delivery';
    insert into public.order_activity(order_id, user_id, action, details)
    values (
      v_order_id,
      auth.uid(),
      'status_changed',
      jsonb_build_object('from_status', 'for_delivery', 'to_status', 'completed', 'delivery_id', p_delivery_id)
    );
  end if;
end;
$$;
revoke all on function public.update_delivery_status(uuid, public.delivery_status, text) from public;
grant execute on function public.update_delivery_status(uuid, public.delivery_status, text) to authenticated;
