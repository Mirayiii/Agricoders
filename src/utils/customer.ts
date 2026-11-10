/** A customer's name for display: the brand name when recorded, else the registered business name. */
export function customerName(customer: { business_name: string; brand_name?: string | null } | null | undefined): string | undefined {
  if (!customer) return undefined;
  return customer.brand_name?.trim() || customer.business_name;
}
