export const ORDER_SOURCES = ["viber", "messenger", "phone", "purchase_order", "other"] as const;
export const ORDER_STATUSES = ["for_verification", "confirmed", "for_preparation", "for_delivery", "completed", "cancelled"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderListItem = { id: string; order_number: string; customer_id: string; status: OrderStatus; requested_delivery_date: string; requires_attention: boolean; notes: string | null; created_at: string; customers: { business_name: string; brand_name?: string | null } | null; order_items: { id: string; quantity: number; unit_price: number }[] };
export type OrderDraftItem = { product_id: string; product_name: string; quantity: string; unit_of_measurement: string; notes: string; product_sku_id?: string; variety_id?: string; };
