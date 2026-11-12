type Searchable = {
  order_number: string;
  sales_invoice_number?: string | null;
  customers: { business_name: string; brand_name?: string | null } | null;
  delivery_receipts?: { dr_number: number } | { dr_number: number }[] | null;
};

/** Text the Orders search matches: order number, SI#, DR# (as "DR-0007" and "0007") and customer names (prototype). */
export function orderSearchText(order: Searchable): string {
  const receipt = Array.isArray(order.delivery_receipts) ? order.delivery_receipts[0] : order.delivery_receipts;
  const dr = receipt ? String(receipt.dr_number).padStart(4, "0") : "";
  return `${order.order_number} ${order.sales_invoice_number ?? ""} ${dr ? `DR-${dr} DR${dr} ${dr}` : ""} ${order.customers?.business_name ?? ""} ${order.customers?.brand_name ?? ""}`.toLowerCase();
}
