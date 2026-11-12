// Products, prices and stock rules, kept free of React so they can be tested.

import type { StatusTone } from "@/types/ui";

export type InventoryStatus = "available" | "low_stock" | "out_of_stock";
export type ProductStatus = "active" | "archived";

export const STOCK_META: Record<InventoryStatus, { label: string; tone: StatusTone }> = {
  available: { label: "Available", tone: "success" },
  low_stock: { label: "Low stock", tone: "pending" },
  out_of_stock: { label: "Out of stock", tone: "danger" },
};

/**
 * Jac, 8 Nov: a tracked unit with no stock record has unknown stock, not 0.
 * It shows "Stock unavailable" until someone counts it.
 */
export const STOCK_UNAVAILABLE = { label: "Stock unavailable", tone: "neutral" as StatusTone };
export function stockUnknown(row: { track_stock: boolean; stock_quantity: number | null }): boolean {
  return row.track_stock && row.stock_quantity === null;
}

/** One row from get_products_overview(). Prices are null for staff who can't see them. */
export type ProductOverview = {
  id: string;
  product_name: string;
  status: ProductStatus;
  unit: string | null;
  track_stock: boolean;
  unit_count: number;
  buying_sku: string | null;
  selling_sku: string | null;
  sku_id: string | null;
  cost_price: number | null;
  selling_price: number | null;
  margin_percent: number | null;
  stock_quantity: number | null;
  low_stock_threshold: number | null;
  stock_status: InventoryStatus | null;
};

export type PriceHistoryRow = {
  id: string;
  cost_price: number;
  selling_price: number;
  margin_percent: number | null;
  effective_from: string;
  price_date: string;
  set_by: string | null;
  is_current: boolean;
};

const num = (value: unknown) => (value === null || value === undefined || value === "" ? null : Number(value));

export function normalizeOverview(row: Record<string, unknown>): ProductOverview {
  return {
    ...(row as ProductOverview),
    unit_count: Number(row.unit_count ?? 0),
    cost_price: num(row.cost_price),
    selling_price: num(row.selling_price),
    margin_percent: num(row.margin_percent),
    stock_quantity: num(row.stock_quantity),
    low_stock_threshold: num(row.low_stock_threshold),
  };
}

/**
 * Figma's margin: profit as a share of the selling price, (selling − cost) ÷ selling.
 * Blank (null) when no cost is recorded (cost 0 or missing) or there is no
 * selling price, so a missing cost never shows as a 100% margin. The server's
 * margin_percent() uses the same rule.
 */
export function marginPercent(cost: number | null | undefined, selling: number | null | undefined): number | null {
  if (cost === null || cost === undefined || selling === null || selling === undefined) return null;
  if (!(selling > 0) || !(cost > 0)) return null;
  return Math.round(((selling - cost) / selling) * 1000) / 10;
}

/** Peso margin per unit, or null without a recorded cost. */
export function marginAmount(cost: number | null | undefined, selling: number | null | undefined): number | null {
  return marginPercent(cost, selling) === null ? null : Math.round(((selling as number) - (cost as number)) * 100) / 100;
}

export function marginLabel(percent: number | null): string | null {
  return percent === null ? null : `${formatPercent(percent)} margin`;
}

export function formatPercent(percent: number, digits = 1): string {
  return `${percent.toFixed(digits)}%`;
}

/** Figma margin pill colours: green from 20%, amber below, red at a loss. */
export function marginTone(percent: number | null): StatusTone {
  if (percent === null) return "neutral";
  if (percent < 0) return "danger";
  return percent >= 20 ? "success" : "pending";
}

/** "100002 · per kg": the selling code (or buying code) and the unit. */
export function productDetailLine(row: Pick<ProductOverview, "selling_sku" | "buying_sku" | "unit">): string {
  const code = row.selling_sku ?? row.buying_sku;
  const unit = row.unit ? `per ${row.unit}` : "No unit";
  return code ? `${code} · ${unit}` : unit;
}

/** How full the stock bar is: the alert level sits at a third of the bar. */
export function stockLevel(quantity: number, threshold: number | null): number {
  if (quantity <= 0) return 0;
  const full = threshold && threshold > 0 ? threshold * 3 : Math.max(quantity, 1);
  return Math.min(1, quantity / full);
}

export function formatQty(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}

export type ProductFilter = "all" | "stocked" | "low" | "out" | "archived";

/** Search by name or SKU code; every filter but Archived shows active products only. Low and Out of stock (requirement PS-02) cover tracked products. */
export function filterProducts(rows: ProductOverview[], filter: ProductFilter, query: string): ProductOverview[] {
  const term = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter === "archived" ? row.status !== "archived" : row.status !== "active") return false;
    if (filter === "stocked" && !row.track_stock) return false;
    if (filter === "low" && !(row.track_stock && row.stock_status === "low_stock")) return false;
    if (filter === "out" && !(row.track_stock && row.stock_status === "out_of_stock")) return false;
    if (!term) return true;
    return `${row.product_name} ${row.selling_sku ?? ""} ${row.buying_sku ?? ""}`.toLowerCase().includes(term);
  });
}

export function filterCounts(rows: ProductOverview[]): Record<ProductFilter, number> {
  return {
    all: rows.filter((row) => row.status === "active").length,
    stocked: rows.filter((row) => row.status === "active" && row.track_stock).length,
    low: rows.filter((row) => row.status === "active" && row.track_stock && row.stock_status === "low_stock").length,
    out: rows.filter((row) => row.status === "active" && row.track_stock && row.stock_status === "out_of_stock").length,
    archived: rows.filter((row) => row.status === "archived").length,
  };
}

/** A price typed into a form: "" is not entered, otherwise a number ≥ 0. */
export function parsePrice(value: string): number | null {
  const clean = value.replace(/[₱,\s]/g, "");
  if (!clean) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return Number.NaN;
  return Number(clean);
}

/** The same checks as the server's check_price_row, worded for one form. */
export function priceProblem(costText: string, sellingText: string, { optional = false } = {}): string | null {
  const cost = parsePrice(costText);
  const selling = parsePrice(sellingText);
  if (optional && cost === null && selling === null) return null;
  if (cost === null || selling === null) return "Enter both the cost and the selling price";
  if (Number.isNaN(cost) || Number.isNaN(selling)) return "Enter prices as numbers, for example 140 or 140.50";
  if (selling <= 0) return "The selling price must be more than ₱0";
  return null;
}

/** "Margin ₱35.00 · 25.0%" under the price form; explains a missing cost. */
export function marginPreview(costText: string, sellingText: string): { text: string; tone: StatusTone } | null {
  const cost = parsePrice(costText);
  const selling = parsePrice(sellingText);
  if (selling === null || cost === null || Number.isNaN(cost) || Number.isNaN(selling) || selling <= 0) return null;
  if (cost === 0) return { text: "No cost recorded · margin not shown", tone: "neutral" };
  const percent = marginPercent(cost, selling) as number;
  const amount = marginAmount(cost, selling) as number;
  const peso = `${amount < 0 ? "−" : ""}₱${Math.abs(amount).toFixed(2)}`;
  return { text: `Margin ${peso} · ${formatPercent(percent)}`, tone: marginTone(percent) };
}

// ---------------------------------------------------------------------------
// Add product
// ---------------------------------------------------------------------------

export const COMMON_UNITS = ["kg", "head", "crate", "piece", "bundle"];
export const MORE_UNITS = ["crate", "head", "bundle", "box", "sack", "pack", "dozen", "tray"];

export type ProductDraft = {
  product_name: string;
  units: string[];
  default_unit: string | null;
  cost_price: string;
  selling_price: string;
  buying_sku: string;
  selling_sku: string;
  track_stock: boolean;
};

export const EMPTY_PRODUCT: ProductDraft = { product_name: "", units: ["kg"], default_unit: "kg", cost_price: "", selling_price: "", buying_sku: "", selling_sku: "", track_stock: false };

export function cleanUnit(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Toggles a unit on the Add product form; the first unit chosen is the default. */
export function toggleUnit(draft: ProductDraft, unit: string): ProductDraft {
  const name = cleanUnit(unit);
  if (!name) return draft;
  const has = draft.units.some((item) => item.toLowerCase() === name.toLowerCase());
  const units = has ? draft.units.filter((item) => item.toLowerCase() !== name.toLowerCase()) : [...draft.units, name];
  const keepDefault = draft.default_unit && units.some((item) => item.toLowerCase() === draft.default_unit?.toLowerCase());
  return { ...draft, units, default_unit: keepDefault ? draft.default_unit : units[0] ?? null };
}

export function productProblem(draft: ProductDraft): string | null {
  if (!draft.product_name.trim()) return "Enter the product name";
  if (!draft.units.length) return "Choose at least one unit the product is sold by";
  return priceProblem(draft.cost_price, draft.selling_price, { optional: true });
}

export function productPayload(draft: ProductDraft) {
  const cost = parsePrice(draft.cost_price);
  const selling = parsePrice(draft.selling_price);
  return {
    product_name: draft.product_name.trim().replace(/\s+/g, " "),
    units: draft.units,
    default_unit: draft.default_unit ?? draft.units[0],
    track_stock: draft.track_stock,
    ...(cost !== null && selling !== null ? { cost_price: cost, selling_price: selling } : {}),
    buying_sku: draft.buying_sku.trim() || null,
    selling_sku: draft.selling_sku.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// Stock tab (manual, as before)
// ---------------------------------------------------------------------------

export type StockMode = "increase" | "decrease";

/** "18 → 23 kg" preview, and whether the change is allowed. */
export function stockAfter(current: number, mode: StockMode, amountText: string): { after: number; problem: string | null } {
  const amount = Number(amountText || 0);
  if (!Number.isFinite(amount) || amount < 0) return { after: current, problem: "Enter a quantity of 0 or more" };
  const after = mode === "increase" ? current + amount : current - amount;
  if (after < 0) return { after: current, problem: `Only ${formatQty(current)} in stock. Remove ${formatQty(current)} or less.` };
  return { after: Math.round(after * 1000) / 1000, problem: null };
}

// ---------------------------------------------------------------------------
// Batch price update
// ---------------------------------------------------------------------------

export type BatchSheetRow = {
  product_id: string;
  name: string;
  unit: string | null;
  sku: string | null;
  cost_price: number | null;
  selling_price: number | null;
  last_cost: number | null;
  last_selling: number | null;
};

export type BatchEdit = { cost: string; selling: string };

const priceText = (value: number | null) => (value === null || value === undefined ? "" : String(Number(value)));

export function batchEditsFrom(rows: BatchSheetRow[]): Record<string, BatchEdit> {
  return Object.fromEntries(rows.map((row) => [row.product_id, { cost: priceText(row.cost_price), selling: priceText(row.selling_price) }]));
}

/** "No change", "▲ +₱5.00 vs last" or "▼ −₱35.00 vs last" for the selling price. */
export function changeVsLast(row: BatchSheetRow, edit: BatchEdit): { text: string; direction: "up" | "down" | "same" | "new" } {
  const selling = parsePrice(edit.selling);
  if (row.last_selling === null || row.last_selling === undefined) return { text: "New price", direction: "new" };
  if (selling === null || Number.isNaN(selling)) return { text: "No change", direction: "same" };
  const diff = Math.round((selling - Number(row.last_selling)) * 100) / 100;
  if (diff === 0) return { text: "No change", direction: "same" };
  return diff > 0 ? { text: `+₱${diff.toFixed(2)} vs last`, direction: "up" } : { text: `−₱${Math.abs(diff).toFixed(2)} vs last`, direction: "down" };
}

/**
 * The rows to save: every product whose typed price differs from what it has
 * for that date, all checked first. One bad row stops the whole batch, the
 * same as on the server.
 */
export function batchRows(rows: BatchSheetRow[], edits: Record<string, BatchEdit>): { rows: { product_id: string; cost_price: number; selling_price: number }[]; problem: string | null } {
  const out: { product_id: string; cost_price: number; selling_price: number }[] = [];
  for (const row of rows) {
    const edit = edits[row.product_id];
    if (!edit) continue;
    const unchanged = edit.cost === priceText(row.cost_price) && edit.selling === priceText(row.selling_price);
    if (unchanged) continue;
    const problem = priceProblem(edit.cost, edit.selling);
    if (problem) return { rows: [], problem: `${row.name}: ${problem.charAt(0).toLowerCase()}${problem.slice(1)}` };
    out.push({ product_id: row.product_id, cost_price: parsePrice(edit.cost) as number, selling_price: parsePrice(edit.selling) as number });
  }
  return { rows: out, problem: null };
}
