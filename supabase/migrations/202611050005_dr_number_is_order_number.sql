-- DR number = order number (MEAH-Prototype 2.html; Jac, 5 Nov 2026):
--
--   * New orders are numbered DR-0001 and up from one server sequence. The
--     sequence starts above every order number and every receipt number
--     already issued, so no DR number is ever repeated.
--   * A receipt exists from Confirmed onwards, with no Issue step. Its DR
--     number is the order's number. Numbers never change when an order is
--     edited, delivered or cancelled, and are never reused (a cancelled
--     order's receipt stays, marked VOID).
--   * Receipts already issued keep their numbers, and older ORD-#### orders
--     keep their order numbers. When an ORD-#### order needs a receipt and
--     has none yet, it takes the next number from the same sequence, so it
--     can't clash with any DR-#### order.
--
-- Sequences hand out each number once, also to simultaneous orders; a create
-- that is retried with the same request id returns the first order, so a
-- retry never takes a second number.

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

-- 1. One sequence, starting above everything already numbered.
do $$
declare
  v_used bigint;
begin
  select greatest(
      (select case when is_called then last_value else 0 end from public.order_number_sequence),
      (select case when is_called then last_value else 0 end from public.delivery_receipt_number_seq),
      coalesce((select max(dr_number) from public.delivery_receipts), 0),
      coalesce((select max(substring(order_number from '([0-9]+)$')::bigint) from public.orders), 0))
    into v_used;
  if v_used > 0 then
    perform setval('public.order_number_sequence', v_used, true);
  end if;
end;
$$;

-- "DR-0042"; numbers past 9999 keep all their digits ("DR-10000").
create or replace function public.dr_label(p_number bigint)
returns text language sql immutable as $$
  select 'DR-' || case when length(p_number::text) < 4 then lpad(p_number::text, 4, '0') else p_number::text end;
$$;
-- Runs with the inserting role's rights, like the nextval() default it replaces.
create or replace function public.next_order_number()
returns text language sql volatile set search_path = public as $$
  select public.dr_label(nextval('public.order_number_sequence'));
$$;
revoke all on function public.next_order_number() from public, anon;
grant execute on function public.next_order_number() to authenticated;
grant execute on function public.dr_label(bigint) to authenticated;

alter table public.orders alter column order_number set default public.next_order_number();
alter table public.delivery_receipts alter column dr_number
  set default nextval('public.order_number_sequence');

-- The DR number for an order's receipt: its own number for DR-#### orders,
-- otherwise the next free number.
create or replace function public.dr_number_for(p_order_id uuid)
returns integer language sql volatile security definer set search_path = public as $$
  select coalesce(
    (select substring(o.order_number from '^DR-([0-9]+)$')::integer from public.orders o where o.id = p_order_id),
    nextval('public.order_number_sequence')::integer);
$$;
revoke all on function public.dr_number_for(uuid) from public, anon, authenticated;

do $$ begin perform pg_temp.patch_all('public.issue_receipt_for(uuid)'::regprocedure,
  '  insert into public.delivery_receipts (order_id, content, issued_by, finalized_at)
  values (p_order_id, public.delivery_receipt_content(p_order_id, auth.uid()), auth.uid(), case when v_final then now() end)',
  '  insert into public.delivery_receipts (order_id, dr_number, content, issued_by, finalized_at)
  values (p_order_id, public.dr_number_for(p_order_id), public.delivery_receipt_content(p_order_id, auth.uid()), auth.uid(), case when v_final then now() end)'); end $$;

-- 2. No Issue step: the receipt is created when the order is confirmed (or
-- saved already confirmed). Server jobs without a signed-in user leave it to
-- the first time someone opens the receipt.
create or replace function public.orders_issue_receipt_when_confirmed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('confirmed', 'for_preparation', 'for_delivery', 'completed')
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and public.is_app_call()
     and not exists (select 1 from public.delivery_receipts r where r.order_id = new.id) then
    perform public.issue_receipt_for(new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.orders_issue_receipt_when_confirmed() from public, anon, authenticated;
drop trigger if exists orders_issue_receipt_when_confirmed on public.orders;
create trigger orders_issue_receipt_when_confirmed after insert or update of status on public.orders
  for each row execute procedure public.orders_issue_receipt_when_confirmed();

-- Opening a receipt creates it when the order is confirmed or later and none
-- exists yet (orders confirmed before this change, or by a server job).
do $$ begin perform pg_temp.patch_all('public.get_delivery_receipt(uuid)'::regprocedure,
  '  if not found then return null; end if;',
  '  if not found then
    if v_status not in (''confirmed'', ''for_preparation'', ''for_delivery'', ''completed'') then return null; end if;
    perform public.issue_receipt_for(p_order_id);
    select * into v_receipt from public.delivery_receipts where order_id = p_order_id;
  end if;'); end $$;

-- The label printed on the receipt uses the same format.
do $$ begin perform pg_temp.patch_all('public.delivery_receipt_json(public.delivery_receipts)'::regprocedure,
  '''dr_label'', ''DR-'' || lpad(p_receipt.dr_number::text, 4, ''0''),',
  '''dr_label'', public.dr_label(p_receipt.dr_number),'); end $$;
