-- Phase 9: More, User management and Settings.
--
-- Notification preferences. Only settings that change something today are
-- stored: delivery reminders, which turn the in-app "Upcoming order" and
-- "Upcoming delivery" reminders on or off for one person. Push notifications
-- and low-stock alerts are not built yet (decision D-A1), so the app shows
-- them as not available and nothing is saved for them.
--
-- User management reuses the Phase 1 account functions (admin-create-user,
-- admin-reset-password, admin_change_username, admin_unlock_user,
-- get_account_locks and the profiles update policy), so nothing changes there.
-- The role preview is app-only and never reaches the server.

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  delivery_reminders boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;
revoke all on table public.notification_preferences from anon, authenticated;
grant select, insert, update (delivery_reminders, updated_at) on table public.notification_preferences to authenticated;

drop policy if exists "own_notification_preferences_read" on public.notification_preferences;
create policy "own_notification_preferences_read" on public.notification_preferences
  for select to authenticated
  using (user_id = auth.uid() and public.is_active_account());

drop policy if exists "own_notification_preferences_insert" on public.notification_preferences;
create policy "own_notification_preferences_insert" on public.notification_preferences
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_account());

drop policy if exists "own_notification_preferences_update" on public.notification_preferences;
create policy "own_notification_preferences_update" on public.notification_preferences
  for update to authenticated
  using (user_id = auth.uid() and public.is_active_account())
  with check (user_id = auth.uid() and public.is_active_account());

-- Saves the signed-in person's preference. Runs as the caller, so the
-- policies above apply; only the preference columns are ever updated.
create or replace function public.set_my_notification_preferences(p_delivery_reminders boolean)
returns jsonb language sql security invoker set search_path = public as $$
  insert into public.notification_preferences (user_id, delivery_reminders, updated_at)
  values (auth.uid(), coalesce(p_delivery_reminders, true), now())
  on conflict (user_id) do update set delivery_reminders = excluded.delivery_reminders, updated_at = excluded.updated_at
  returning jsonb_build_object('delivery_reminders', delivery_reminders);
$$;
revoke all on function public.set_my_notification_preferences(boolean) from public, anon;
grant execute on function public.set_my_notification_preferences(boolean) to authenticated;

-- No row means the default: reminders on.
create or replace function public.wants_delivery_reminders(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select delivery_reminders from public.notification_preferences where user_id = p_user_id), true);
$$;
revoke all on function public.wants_delivery_reminders(uuid) from public, anon, authenticated;

-- Same as Phase 1, plus the delivery-reminders preference. Reminders already
-- sent stay in the list; turning reminders back on brings new ones only.
create or replace function public.generate_upcoming_notifications()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_active_account() then
    raise exception 'Your account cannot do this right now' using errcode = '42501';
  end if;

  insert into public.notifications(user_id, type, title, message, related_order_id, event_key)
  select p.id, 'upcoming_order', 'Upcoming order', o.order_number || ' is scheduled for ' || o.requested_delivery_date::text, o.id, 'upcoming_order:' || o.id::text || ':' || o.requested_delivery_date::text
  from public.orders o cross join public.profiles p
  where o.requested_delivery_date between current_date and current_date + 1
    and o.status not in ('completed', 'cancelled')
    and p.role in ('administrator', 'administrative_staff') and p.status = 'active'
    and public.wants_delivery_reminders(p.id)
  on conflict (user_id, event_key) do nothing;

  insert into public.notifications(user_id, type, title, message, related_order_id, event_key)
  select recipient.id, 'upcoming_delivery', 'Upcoming delivery', o.order_number || ' delivery is scheduled for ' || d.scheduled_date::text, o.id, 'upcoming_delivery:' || d.id::text || ':' || d.scheduled_date::text
  from public.deliveries d join public.orders o on o.id = d.order_id
  join public.profiles recipient on recipient.status = 'active'
  where d.scheduled_date between current_date and current_date + 1
    and d.status in ('scheduled', 'for_delivery')
    and (recipient.role in ('administrator', 'administrative_staff') or recipient.id = d.assigned_driver_id)
    and public.wants_delivery_reminders(recipient.id)
  on conflict (user_id, event_key) do nothing;
end;
$$;
