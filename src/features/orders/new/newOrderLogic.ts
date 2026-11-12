import type { DiscountType } from "../orderMoney";
import { discountCents, fromCents, toCents } from "../orderMoney";

// New order (Phase 4): the rules the three steps use, kept free of React so
// they can be tested. The server prices the order again when it is saved; the
// numbers here are the estimate shown while the order is taken.

export type StockStatus = "available" | "low_stock" | "out_of_stock";

export type ProductRecord = {
  id: string;
  product_name: string;
  unit_of_measurement: string | null;
  product_skus: { id: string; selling_sku: string | null; unit_of_measurement: string; status: string }[];
};
export type PriceRecord = { product_id: string; product_sku_id: string | null; selling_price: number; effective_from: string; effective_to: string | null };
/** current_quantity and status are null when a tracked unit has no stock record (unknown, not zero). */
export type AvailabilityRecord = { product_id: string; sku_id: string; current_quantity: number | null; status: StockStatus | null };

/** One way a product can be sold: the product's own unit, or one of its SKUs. */
/**
 * outOfStock (Jac, 8 Nov, prototype rule): tracked and none on hand, so it can't be added.
 * Only a confirmed answer from the server sets it; untracked or unknown stock never does.
 * stockUnknown (Jac, 8 Nov afternoon): tracked, but there is no stock record, so the
 * quantity can't be established. Shown as "Stock unavailable" and still addable.
 */
export type UnitOption = { key: string; skuId: string | null; unit: string; price: number; stock: number | null; stockStatus: StockStatus | null; outOfStock: boolean; stockUnknown?: boolean };
export type CatalogItem = { id: string; name: string; units: UnitOption[] };

/** The price in force now, newest first, as the server picks it. */
function priceNow(rows: PriceRecord[], productId: string, skuId: string | null, now: number): number | null {
  let best: PriceRecord | null = null;
  for (const row of rows) {
    if (row.product_id !== productId || row.product_sku_id !== skuId) continue;
    if (new Date(row.effective_from).getTime() > now) continue;
    if (row.effective_to && new Date(row.effective_to).getTime() <= now) continue;
    if (!best || row.effective_from > best.effective_from) best = row;
  }
  return best ? Number(best.selling_price) : null;
}

/**
 * The units each product can be ordered in, with today's price for this
 * customer (customer pricing first, then the list price, like the server).
 * A unit without a price is left out, because the server would refuse it.
 */
export function buildCatalog(products: ProductRecord[], listPrices: PriceRecord[], customerPrices: PriceRecord[], availability: AvailabilityRecord[], now = Date.now(), outOfStockSkus: ReadonlySet<string> = new Set()): CatalogItem[] {
  const stockBySku = new Map(availability.map((row) => [row.sku_id, row]));
  return products.map((product) => {
    const skus = product.product_skus.filter((sku) => sku.status === "active");
    const baseUnit = product.unit_of_measurement ?? skus.find((sku) => sku.selling_sku)?.unit_of_measurement ?? skus[0]?.unit_of_measurement ?? "unit";
    const price = (skuId: string | null) => priceNow(customerPrices, product.id, skuId, now) ?? priceNow(listPrices, product.id, skuId, now);
    const stockFor = (skuId: string | null, unit: string) => {
      // The product's own unit shows the stock of a SKU counted in that unit.
      const sku = skuId ? skus.find((item) => item.id === skuId) : skus.filter((item) => same(item.unit_of_measurement, unit)).sort((a, b) => Number(Boolean(b.selling_sku)) - Number(Boolean(a.selling_sku)))[0];
      const row = sku ? stockBySku.get(sku.id) : undefined;
      // The same SKU the server checks (order_line_stock_sku).
      const outOfStock = Boolean(sku && (outOfStockSkus.has(sku.id) || row?.status === "out_of_stock"));
      if (!row) return { stock: null, stockStatus: null, outOfStock };
      if (row.current_quantity === null || row.status === null) return { stock: null, stockStatus: null, outOfStock, stockUnknown: true };
      return { stock: Number(row.current_quantity), stockStatus: row.status, outOfStock };
    };
    const units: UnitOption[] = [];
    const basePrice = price(null);
    if (basePrice !== null) units.push({ key: "base", skuId: null, unit: baseUnit, price: basePrice, ...stockFor(null, baseUnit) });
    for (const sku of skus) {
      if (units.some((option) => same(option.unit, sku.unit_of_measurement))) continue;
      const skuPrice = price(sku.id);
      if (skuPrice !== null) units.push({ key: sku.id, skuId: sku.id, unit: sku.unit_of_measurement, price: skuPrice, ...stockFor(sku.id, sku.unit_of_measurement) });
    }
    return { id: product.id, name: product.product_name, units };
  });
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A product added to the order. */
export type DraftLine = {
  productId: string;
  unitKey: string;
  quantityText: string;
  /** A price different from the list price, typed by an order-taker, with an optional reason. */
  priceText?: string;
  priceReason?: string;
  /** Kept from the order being copied (Order again). */
  varietyId?: string | null;
  notes?: string | null;
};

export function parseQuantity(text: string): number | null {
  const value = Number(text.trim());
  if (!text.trim() || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 1000) / 1000;
}

export function formatQuantityText(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** Up or down by one, never below zero. Zero removes the line. */
export function stepQuantity(text: string, delta: number): string {
  const next = Math.max(0, (parseQuantity(text) ?? 0) + delta);
  return next ? formatQuantityText(next) : "";
}

export function cleanQuantityInput(text: string): string {
  const cleaned = text.replace(/[^0-9.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  return rest.length ? `${whole}.${rest.join("").slice(0, 3)}` : whole;
}

/** A line's amount the way the server works it out: quantity × price, rounded once to centavos. */
export function lineCents(quantity: number, unitPrice: number): number {
  const milli = Math.round(quantity * 1000);
  const cents = toCents(unitPrice);
  return Math.round((milli * cents) / 1000);
}

export type PricedLine = {
  line: DraftLine;
  item: CatalogItem;
  unit: UnitOption;
  quantity: number;
  unitPrice: number;
  /** The administrator changed the price. */
  special: boolean;
  amountCents: number;
  /** More than the stock on hand. Allowed, with a warning. */
  overStock: boolean;
  /** None in stock: the server refuses this line, so it must be removed. */
  outOfStock: boolean;
};

export function priceLines(lines: DraftLine[], catalog: CatalogItem[]): PricedLine[] {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  return lines.flatMap((line) => {
    const item = byId.get(line.productId);
    const unit = item?.units.find((option) => option.key === line.unitKey) ?? item?.units[0];
    const quantity = parseQuantity(line.quantityText);
    if (!item || !unit || quantity === null) return [];
    const typed = line.priceText !== undefined ? Number(line.priceText) : NaN;
    const special = Number.isFinite(typed) && line.priceText !== "" && toCents(typed) !== toCents(unit.price);
    const unitPrice = special ? typed : unit.price;
    return [{ line, item, unit, quantity, unitPrice, special, amountCents: lineCents(quantity, unitPrice), overStock: !unit.outOfStock && isOverStock(unit, quantity), outOfStock: unit.outOfStock }];
  });
}

export function isOverStock(unit: Pick<UnitOption, "stock" | "stockStatus">, quantity: number): boolean {
  if (unit.stockStatus === "out_of_stock") return true;
  return unit.stock !== null && quantity > unit.stock;
}

export function stockTag(unit: Pick<UnitOption, "stock" | "stockStatus" | "unit" | "outOfStock" | "stockUnknown">): { label: string; tone: "success" | "warning" | "danger" | "neutral" } | undefined {
  if (unit.outOfStock) return { label: "Out of stock", tone: "danger" };
  if (unit.stockUnknown) return { label: "Stock unavailable", tone: "neutral" };
  if (unit.stockStatus === null) return undefined;
  const amount = `${formatQuantityText(unit.stock ?? 0)} ${unit.unit}`;
  if (unit.stockStatus === "out_of_stock") return { label: "Out of stock", tone: "danger" };
  if (unit.stockStatus === "low_stock") return { label: `Low · ${amount} left`, tone: "warning" };
  return { label: `In stock · ${amount}`, tone: "success" };
}

/** Lines that can't be saved because the product is out of stock (for example copied by Order again). */
export function outOfStockProblem(lines: PricedLine[]): string | null {
  const names = lines.filter((line) => line.outOfStock).map((line) => `${line.item.name} (${line.unit.unit})`);
  if (!names.length) return null;
  return `${names.join(", ")} ${names.length === 1 ? "is" : "are"} out of stock. Remove ${names.length === 1 ? "it" : "them"} to continue.`;
}

/** Plain words for the warning on step 2 and step 3. */
export function stockWarning(lines: PricedLine[]): string | null {
  const over = lines.filter((line) => line.overStock);
  if (!over.length) return null;
  const names = over.map((line) => {
    const onHand = line.unit.stockStatus === "out_of_stock" || !line.unit.stock ? "none in stock" : `${formatQuantityText(line.unit.stock)} ${line.unit.unit} in stock`;
    return `${line.item.name} (${formatQuantityText(line.quantity)} ${line.unit.unit}, ${onHand})`;
  });
  return `${over.length === 1 ? "This item is" : "These items are"} more than the stock on hand: ${names.join(", ")}. You can still save the order. Stock is not reserved or deducted.`;
}

export type DraftDiscount = { type: DiscountType; value: number; reason: string };

export function estimate(lines: PricedLine[], discount: DraftDiscount | null) {
  const subtotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  const discountAmountCents = discount ? Math.min(discountCents(subtotalCents, discount.type, discount.value), subtotalCents) : 0;
  return { subtotal: fromCents(subtotalCents), discount: fromCents(discountAmountCents), total: fromCents(subtotalCents - discountAmountCents) };
}

/** What blocks a changed price: the server needs a price of zero or more. The reason is optional. */
export function priceProblem(line: PricedLine): string | null {
  if (!line.special) return null;
  if (!(line.unitPrice >= 0) || toCents(line.unitPrice) / 100 !== Number(line.line.priceText)) return "Enter a price with up to two decimals";
  return null;
}

// ---------------------------------------------------------------------------
// Delivery time
// ---------------------------------------------------------------------------

/** "07:30" or "07:30:00" → "7:30 AM". */
export function timeLabel(value: string | null | undefined): string {
  if (!value) return "";
  const [h, m] = value.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** How an order's delivery time reads everywhere: "7:00 AM – 9:00 AM", "From 7:00 AM" or "Not specified". */
export function deliveryTimeText(start: string | null | undefined, end: string | null | undefined): string {
  if (!start) return "Not specified";
  return end ? `${timeLabel(start)} – ${timeLabel(end)}` : `From ${timeLabel(start)}`;
}

/** 12-hour picker values → "HH:MM". */
export function toTime(hour12: number, minute: number, period: "AM" | "PM"): string {
  const hour = (hour12 % 12) + (period === "PM" ? 12 : 0);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function fromTime(value: string | null): { hour: number; minute: number; period: "AM" | "PM" } {
  if (!value) return { hour: 7, minute: 0, period: "AM" };
  const [h, m] = value.split(":").map(Number);
  return { hour: h % 12 === 0 ? 12 : h % 12, minute: m, period: h >= 12 ? "PM" : "AM" };
}

export type DeliveryTime = { start: string | null; end: string | null; slotId: string | null };

export function deliveryTimeProblem(time: DeliveryTime): string | null {
  if (time.end && !time.start) return "Add a start time before an end time";
  if (time.start && time.end && time.end.slice(0, 5) <= time.start.slice(0, 5)) return "The end time must be after the start time";
  return null;
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

export type DraftOrder = {
  customerId: string;
  date: string;
  sourceId: string;
  time: DeliveryTime;
  notes: string;
  salesInvoice: string;
  needsChecking: boolean;
  checkingNote: string;
  discount: DraftDiscount | null;
};

export type SeenPrice = { product_id: string; unit: string; price: number };

/**
 * The prices shown on screen for lines at the list or customer price (Phase
 * 10). The server compares them with today's prices when the order is saved,
 * so an order saved offline is never sent at prices nobody saw. Lines with a
 * price the order-taker typed are left out: that price is kept as typed.
 */
export function seenPrices(lines: PricedLine[]): SeenPrice[] {
  const seen = new Map<string, SeenPrice>();
  for (const line of lines) {
    if (line.special) continue;
    seen.set(`${line.item.id}|${line.unit.unit.toLowerCase()}`, { product_id: line.item.id, unit: line.unit.unit, price: line.unitPrice });
  }
  return [...seen.values()];
}

/** The create_order payload. Prices are not sent unless the order-taker changed one. */
export function buildPayload(order: DraftOrder, lines: PricedLine[]) {
  return {
    p_order: {
      customer_id: order.customerId,
      requested_delivery_date: order.date,
      order_source_id: order.sourceId,
      delivery_time_slot_id: order.time.slotId,
      delivery_time_start: order.time.start,
      delivery_time_end: order.time.end,
      notes: order.notes.trim(),
      sales_invoice_number: order.salesInvoice.trim() || null,
      requires_attention: order.needsChecking,
      attention_reason: order.needsChecking ? order.checkingNote.trim() : "",
      discount: order.discount,
    },
    p_items: lines.map((line) => ({
      product_id: line.item.id,
      product_sku_id: line.unit.skuId,
      variety_id: line.line.varietyId ?? null,
      quantity: line.quantity,
      unit_of_measurement: line.unit.unit,
      notes: line.line.notes ?? "",
      ...(line.special ? { special_price: line.unitPrice, special_price_reason: line.line.priceReason?.trim() || undefined } : {}),
    })),
  };
}
