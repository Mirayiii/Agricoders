-- Controlled order transitions and attention updates.
create function public.transition_order_status(p_order_id uuid, p_next_status public.order_status, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_current public.order_status; v_action text;
begin
  if not public.has_app_role(array['administrator','administrative_staff']::public.profile_role[]) then raise exception 'You do not have permission to transition orders'; end if;
  select status into v_current from public.orders where id = p_order_id for update;
  if v_current is null then raise exception 'Order not found'; end if;
  if p_next_status = 'cancelled' then
    if v_current in ('completed','cancelled') then raise exception 'This order cannot be cancelled'; end if;
    v_action := 'cancelled';
  elsif (v_current = 'for_verification' and p_next_status = 'confirmed') or (v_current = 'confirmed' and p_next_status = 'for_preparation') or (v_current = 'for_preparation' and p_next_status = 'for_delivery') or (v_current = 'for_delivery' and p_next_status = 'completed') then
    v_action := 'status_changed';
  else raise exception 'Invalid order status transition'; end if;
  update public.orders set status = p_next_status where id = p_order_id;
  insert into public.order_activity(order_id,user_id,action,details) values(p_order_id,auth.uid(),v_action,p_details || jsonb_build_object('from_status',v_current,'to_status',p_next_status));
end;
$$;
revoke all on function public.transition_order_status(uuid,public.order_status,jsonb) from public;
grant execute on function public.transition_order_status(uuid,public.order_status,jsonb) to authenticated;

create function public.set_order_attention(p_order_id uuid, p_requires_attention boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_app_role(array['administrator','administrative_staff']::public.profile_role[]) then raise exception 'You do not have permission to update order attention'; end if;
  if p_requires_attention and nullif(trim(coalesce(p_reason,'')), '') is null then raise exception 'An attention reason is required'; end if;
  update public.orders set requires_attention=p_requires_attention, attention_reason=case when p_requires_attention then trim(p_reason) else null end where id=p_order_id and status not in ('completed','cancelled');
  if not found then raise exception 'This order cannot be updated'; end if;
  insert into public.order_activity(order_id,user_id,action,details) values(p_order_id,auth.uid(),case when p_requires_attention then 'requires_attention' else 'attention_cleared' end,jsonb_build_object('reason',p_reason));
end;
$$;
revoke all on function public.set_order_attention(uuid,boolean,text) from public;
grant execute on function public.set_order_attention(uuid,boolean,text) to authenticated;
