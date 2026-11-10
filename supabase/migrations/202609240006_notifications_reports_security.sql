create table public.notifications (id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,type text not null,title text not null,message text not null,related_order_id uuid references public.orders(id) on delete set null,is_read boolean not null default false,created_at timestamptz not null default now());
create index notifications_user_unread_idx on public.notifications(user_id,is_read,created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon,authenticated;
grant select,update on public.notifications to authenticated;
create policy "users_read_own_notifications" on public.notifications for select to authenticated using(user_id=auth.uid());
create policy "users_mark_own_notifications_read" on public.notifications for update to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create function public.notify_administrators(p_type text,p_title text,p_message text,p_order_id uuid default null) returns void language sql security definer set search_path=public as $$ insert into public.notifications(user_id,type,title,message,related_order_id) select id,p_type,p_title,p_message,p_order_id from public.profiles where role in ('administrator','administrative_staff') and status='active'; $$;
revoke all on function public.notify_administrators(text,text,text,uuid) from public;
create function public.notify_order_event() returns trigger language plpgsql security definer set search_path=public as $$ begin if tg_op='INSERT' then perform public.notify_administrators('order_for_verification','Order for verification',new.order_number || ' is ready for verification',new.id); end if; if tg_op='UPDATE' and new.requires_attention and not old.requires_attention then perform public.notify_administrators('order_attention','Order requires attention',new.order_number || ': ' || coalesce(new.attention_reason,'Needs review'),new.id); end if; return new; end; $$;
create trigger orders_notify_events after insert or update of requires_attention on public.orders for each row execute procedure public.notify_order_event();
create index order_items_product_idx on public.order_items(product_id,order_id);
create index price_history_effective_idx on public.price_history(product_id,effective_from desc);
-- order_activity remains append-only: no UPDATE/DELETE grants or policies exist.
