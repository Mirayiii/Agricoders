// Customer list and detail rules, kept free of React so they can be tested.

import { shortDate } from "@/features/purchasing/purchasingLogic";
import { customerName } from "@/utils/customer";

export { customerName };

export type CustomerStatus = "active" | "archived";

/** One row from get_customers(). */
export type CustomerRow = {
  id: string;
  customer_code: string;
  business_name: string;
  brand_name: string | null;
  tin: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  delivery_address: string | null;
  notes: string | null;
  /** Requirement CU-01; optional, so customers saved before it have none. */
  business_type?: string | null;
  preferred_delivery_window?: string | null;
  status: CustomerStatus;
  archived_at: string | null;
  order_count: number;
  last_order_date: string | null;
};

export type UsualProduct = { product_id: string; product_name: string; preferred: boolean; times_ordered: number };

/** get_customer_profile(). */
export type CustomerProfile = {
  customer: Omit<CustomerRow, "order_count" | "last_order_date">;
  order_count: number;
  last_order_date: string | null;
  usual_products: UsualProduct[];
};

/**
 * The fields on the Add and Edit forms: the ones in Figma and the prototype
 * (5 Nov). Business type, preferred delivery window and notes are no longer
 * on the form; values saved earlier are kept on the server.
 */
export type CustomerDraft = {
  customer_code: string;
  business_name: string;
  brand_name: string;
  tin: string;
  contact_person: string;
  phone: string;
  email: string;
  delivery_address: string;
};

export const EMPTY_DRAFT: CustomerDraft = { customer_code: "", business_name: "", brand_name: "", tin: "", contact_person: "", phone: "", email: "", delivery_address: "" };

export function draftFrom(customer: Partial<Record<keyof CustomerDraft, string | null>> | null): CustomerDraft {
  if (!customer) return EMPTY_DRAFT;
  return {
    customer_code: customer.customer_code ?? "",
    business_name: customer.business_name ?? "",
    brand_name: customer.brand_name ?? "",
    tin: customer.tin ?? "",
    contact_person: customer.contact_person ?? "",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    delivery_address: customer.delivery_address ?? "",
  };
}

/** The existing rule: code and business name are required. The server checks it too. */
export function draftProblem(draft: CustomerDraft): string | null {
  if (!draft.customer_code.trim()) return "Enter a customer code";
  if (!draft.business_name.trim()) return "Enter the business name";
  return null;
}

/** Trimmed values; a blank optional field is saved as not recorded. */
export function draftPayload(draft: CustomerDraft): Record<keyof CustomerDraft, string | null> {
  const clean = (value: string) => value.trim() || null;
  return {
    customer_code: draft.customer_code.trim(),
    business_name: draft.business_name.trim().replace(/\s+/g, " "),
    brand_name: draft.brand_name.trim().replace(/\s+/g, " ") || null,
    tin: clean(draft.tin),
    contact_person: clean(draft.contact_person),
    phone: clean(draft.phone),
    email: clean(draft.email),
    delivery_address: clean(draft.delivery_address),
  };
}

export function draftChanged(draft: CustomerDraft, original: CustomerDraft): boolean {
  const a = draftPayload(draft);
  const b = draftPayload(original);
  return (Object.keys(a) as (keyof CustomerDraft)[]).some((key) => a[key] !== b[key]);
}

const digits = (value: string) => value.replace(/\D/g, "");

/** Search by brand or business name, code, contact person, phone or TIN# (spaces and dashes ignored in numbers). */
export function searchCustomers<T extends Pick<CustomerRow, "business_name" | "customer_code" | "contact_person" | "phone"> & { brand_name?: string | null; tin?: string | null }>(rows: T[], query: string): T[] {
  const term = query.trim().toLowerCase();
  if (!term) return rows;
  const termDigits = digits(term);
  return rows.filter((row) => {
    const text = `${row.brand_name ?? ""} ${row.business_name} ${row.customer_code} ${row.contact_person ?? ""} ${row.phone ?? ""} ${row.tin ?? ""}`.toLowerCase();
    if (text.includes(term)) return true;
    return termDigits.length >= 3 && (digits(row.phone ?? "").includes(termDigits) || digits(row.tin ?? "").includes(termDigits));
  });
}

export function statusCounts(rows: Pick<CustomerRow, "status">[]): Record<CustomerStatus, number> {
  return {
    active: rows.filter((row) => row.status === "active").length,
    archived: rows.filter((row) => row.status === "archived").length,
  };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** "Mark Reyes · 0917 555 0142", or whichever of the two is recorded. */
export function contactLine(row: Pick<CustomerRow, "contact_person" | "phone">): string {
  return [row.contact_person, row.phone].filter(Boolean).join(" · ") || "No contact recorded";
}

/** "CUS-0012 · 8 orders". */
export function codeLine(row: Pick<CustomerRow, "customer_code" | "order_count">): string {
  return `${row.customer_code} · ${plural(Number(row.order_count), "order")}`;
}

/** "8 orders · last on Sat, 29 Aug" (the latest delivery date). */
export function historySummary(orderCount: number, lastOrderDate: string | null): string {
  if (!orderCount) return "No orders yet";
  return lastOrderDate ? `${plural(orderCount, "order")} · last on ${shortDate(lastOrderDate)}` : plural(orderCount, "order");
}

/** Shown on New order when the customer it was opened for can't take orders. */
export function presetCustomerNotice(customerId: string | undefined, activeIds: string[]): string | null {
  if (!customerId || activeIds.includes(customerId)) return null;
  return "That customer is archived or no longer available, so they can’t be picked for a new order. Ask an administrator or the office to restore them, or choose another customer.";
}
