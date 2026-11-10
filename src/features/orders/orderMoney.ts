// Order money rules shown in the app (D-O2). The server works out the real
// amounts; these only preview them and catch mistakes before a request is
// sent, using the same rounding (two decimals, halves away from zero).

export type DiscountType = "fixed" | "percent";

export const DISCOUNT_REASON_MAX = 200;
const SALES_INVOICE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ./#-]{0,39}$/;

/** Pesos to whole centavos. */
export function toCents(value: number | string): number {
  return Math.round(Number(value) * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** a / b, rounded half away from zero, for whole numbers with b > 0. */
function divideRounded(a: number, b: number): number {
  const sign = a < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(a) * 2 + b) / (2 * b));
}

/** Same as the server's order_discount_amount, in centavos. */
export function discountCents(subtotalCents: number, type: DiscountType | null | undefined, value: number | null | undefined): number {
  if (!type || value == null || !(value > 0)) return 0;
  if (type === "fixed") return Math.min(toCents(value), subtotalCents);
  return divideRounded(subtotalCents * Math.round(Math.min(value, 100) * 100), 10_000);
}

/** Reads "500", "1,250.50" or "₱ 500". Null when it is not a number with at most two decimals. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[₱,\s]/g, "").replace(/%$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Number(cleaned);
}

export type DiscountDraft = { type: DiscountType; valueText: string; reason: string };

/** The first problem with a discount, worded like the server, or null. */
export function discountProblem(draft: DiscountDraft, subtotal: number): string | null {
  const trimmed = draft.valueText.trim();
  if (!trimmed) return draft.type === "fixed" ? "Enter the discount amount" : "Enter the discount percentage";
  const value = parseAmount(trimmed);
  if (value === null) return "Use a number with at most two decimal places";
  if (value <= 0) return "Enter a discount greater than zero";
  if (draft.type === "percent" && value > 100) return "A percentage discount cannot be more than 100%";
  if (draft.type === "fixed" && toCents(value) > toCents(subtotal)) return "The discount cannot be more than the subtotal";
  const reason = draft.reason.trim();
  if (!reason) return "A reason is required for a discount";
  if (reason.length > DISCOUNT_REASON_MAX) return `Keep the reason to ${DISCOUNT_REASON_MAX} characters or fewer`;
  return null;
}

/** The order total the discount would give, in pesos. */
export function previewTotal(subtotal: number, draft: DiscountDraft): { discount: number; total: number } | null {
  const value = parseAmount(draft.valueText);
  if (value === null || value <= 0) return null;
  const subtotalCents = toCents(subtotal);
  const off = discountCents(subtotalCents, draft.type, value);
  return { discount: fromCents(off), total: fromCents(subtotalCents - off) };
}

/** Problem with a sales invoice number, or null. Empty means "remove it". */
export function salesInvoiceProblem(text: string): string | null {
  const value = text.trim();
  if (!value) return null;
  return SALES_INVOICE_PATTERN.test(value) ? null : "Use up to 40 letters, numbers, spaces or . / # -";
}

/** Label for a discount, e.g. "10% off" or "₱500.00 off". */
export function discountLabel(type: DiscountType, value: number, formatMoney: (amount: number) => string): string {
  return type === "percent" ? `${Number(value)}% off` : `${formatMoney(Number(value))} off`;
}
