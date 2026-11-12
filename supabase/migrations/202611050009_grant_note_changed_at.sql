-- order_items uses column-level grants (202609240007), so the "Note changed"
-- column added in 202611050008 must be granted too. Without it the Purchasing
-- board and Order details fail with "permission denied for table order_items".
grant select (note_changed_at) on public.order_items to authenticated;
