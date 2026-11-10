export type RecordStatus = "active" | "archived";

export type Customer = {
  id: string;
  customer_code: string;
  business_name: string;
  brand_name?: string | null;
  tin?: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  delivery_address: string | null;
  notes: string | null;
  status: RecordStatus;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type Product = {
  id: string;
  product_name: string;
  description: string | null;
  unit_of_measurement: string | null;
  status: RecordStatus;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type ProductSku = {
  id: string;
  product_id: string;
  buying_sku: string | null;
  selling_sku: string | null;
  unit_of_measurement: string;
  status: RecordStatus;
};

export type ProductVariety = {
  id: string;
  product_id: string;
  variety_name: string;
  status: RecordStatus;
};

export function calculateMargin(costPrice: number, sellingPrice: number) {
  const margin = Number.isFinite(costPrice) && Number.isFinite(sellingPrice) ? sellingPrice - costPrice : 0;
  // Margin on the selling price (Figma); blank without a cost or selling price.
  const marginPercentage = costPrice > 0 && sellingPrice > 0 ? (margin / sellingPrice) * 100 : null;
  return { margin, marginPercentage };
}
