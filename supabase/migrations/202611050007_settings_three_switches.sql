-- Settings follows MEAH-Prototype 2.html and Figma "Settings" (25:2115):
-- three switches, each shown only to the roles the prototype lists.
--
--   push      Push notifications   Alerts on this phone            everyone
--   delivery  Delivery reminders   Day before and morning of       administrator, administrative staff, delivery staff
--   stock     Low-stock alerts     When stock reaches its level    administrator, purchasing staff
--
-- How the switches work together:
--   * Push notifications is the only push control. A push is a copy, on the
--     phone, of an in-app notification the person gets. Off means no copies;
--     the in-app notifications still arrive.
--   * The per-event push choices saved before (push_new_orders and so on)
--     are no longer shown, so they no longer decide anything: a choice nobody
--     can see or change must not block a push someone expects. The columns
--     and their values are kept, unchanged, as history. No push was ever
--     sent while they existed, so nobody loses an alert they were getting.
--   * Delivery reminders turns the in-app "Upcoming order/delivery"
--     reminders on or off, whatever the push switch says. When they are off
--     there is no reminder, so there is nothing to push either.
--   * Low-stock alerts decides whether the person gets low-stock alerts.
--
-- Push sending (D-A1) and low-stock alerts are not built yet, so those two
-- switches are "Not available yet": they show the saved choice, and the
-- server refuses to change them until the feature works
-- (setting_available). Approved by Jac (5 Nov) as an exception to Figma.

alter table public.notification_preferences add column if not exists push_enabled boolean not null default true;
alter table public.notification_preferences add column if not exists low_stock_alerts boolean not null default true;

create or replace function public.settings_switches_for_role(p_role public.profile_role)
returns text[] language sql immutable as $$
  select case p_role
    when 'administrator' then array['push', 'delivery', 'stock']
    when 'administrative_staff' then array['push', 'delivery']
    when 'fulfillment_staff' then array['push', 'stock']
    when 'delivery_staff' then array['push', 'delivery']
    else array[]::text[] end;
$$;

-- Switches whose feature works today. Push and low-stock alerts join when built.
create or replace function public.setting_available(p_key text)
returns boolean language sql immutable as $$
  select p_key = 'delivery';
$$;

create or replace function public.set_my_setting(p_key text, p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role public.profile_role;
begin
  if not public.is_active_account() then
    raise exception 'Your account cannot do this right now' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = auth.uid();
  if p_on is null or not (p_key = any(public.settings_switches_for_role(v_role))) then
    raise exception 'That switch is not available for your role' using errcode = '42501';
  end if;
  if not public.setting_available(p_key) then
    raise exception 'Not available yet' using errcode = '0A000';
  end if;
  insert into public.notification_preferences (user_id, updated_at) values (auth.uid(), now())
    on conflict (user_id) do nothing;
  update public.notification_preferences set
      push_enabled = case when p_key = 'push' then p_on else push_enabled end,
      delivery_reminders = case when p_key = 'delivery' then p_on else delivery_reminders end,
      low_stock_alerts = case when p_key = 'stock' then p_on else low_stock_alerts end,
      updated_at = now()
    where user_id = auth.uid();
  return (select jsonb_build_object('push_enabled', push_enabled, 'delivery_reminders', delivery_reminders, 'low_stock_alerts', low_stock_alerts)
    from public.notification_preferences where user_id = auth.uid());
end;
$$;
revoke all on function public.set_my_setting(text, boolean) from public, anon;
grant execute on function public.set_my_setting(text, boolean) to authenticated;

-- For the push sender: should this in-app notification also go to the
-- person's phone? Only the Push notifications switch decides; the hidden
-- per-event choices are ignored (see above).
create or replace function public.wants_push(p_user_id uuid, p_type text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select public.push_category_for_type(p_type) = any(public.push_categories_for_role(p.role))
      and coalesce(np.push_enabled, true)
    from public.profiles p left join public.notification_preferences np on np.user_id = p.id
    where p.id = p_user_id and p.status = 'active'), false);
$$;
revoke all on function public.wants_push(uuid, text) from public, anon, authenticated;

-- For the low-stock alerts: does this person want them? Only roles that have
-- the switch, and only active accounts.
create or replace function public.wants_low_stock_alerts(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select 'stock' = any(public.settings_switches_for_role(p.role)) and coalesce(np.low_stock_alerts, true)
    from public.profiles p left join public.notification_preferences np on np.user_id = p.id
    where p.id = p_user_id and p.status = 'active'), false);
$$;
revoke all on function public.wants_low_stock_alerts(uuid) from public, anon, authenticated;
