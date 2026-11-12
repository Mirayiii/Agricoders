// Edit order's out-of-stock rule (Jac, 8 Nov 2026), the same as the server's
// order_items_block_out_of_stock trigger:
//   * a saved line keeps its product, SKU and unit: it may keep or lower its
//     quantity, but not raise it while that unit's recorded stock is 0 or less;
//   * a new line, or a saved line whose product, SKU or unit changed, is
//     refused when that unit's recorded stock is 0 or less.
// outOfStockSkus holds only units with a recorded 0 or less, so a unit with no
// stock record, an untracked product or a failed lookup is never blocked here.
// The server checks again when the order is saved.

export type StockSku = { id: string; product_id: string; unit_of_measurement: string; selling_sku: string | null };

export type EditLine = {
  product_id: string;
  product_sku_id: string | null;
  unit_of_measurement: string;
  quantity: string;
};

export type SavedLine = { product_id: string; product_sku_id: string | null; unit_of_measurement: string; quantity: number };

const unitKey = (unit: string) => unit.trim().toLowerCase();

// The SKU whose stock counts for a line: its own SKU, else the product's SKU in
// that unit (a selling SKU first), as the server picks it.
export function lineStockSku(line: Pick<EditLine, "product_id" | "product_sku_id" | "unit_of_measurement">, skus: StockSku[]) {
  if (line.product_sku_id) return line.product_sku_id;
  const unit = unitKey(line.unit_of_measurement);
  return skus
    .filter((sku) => sku.product_id === line.product_id && unitKey(sku.unit_of_measurement) === unit)
    .sort((a, b) => Number(Boolean(b.selling_sku)) - Number(Boolean(a.selling_sku)))[0]?.id ?? null;
}

export type LineStockProblem = { kind: "raise"; savedQuantity: number } | { kind: "out" } | null;

export function lineStockProblem(line: EditLine, saved: SavedLine | undefined, skus: StockSku[], outOfStockSkus: ReadonlySet<string>): LineStockProblem {
  const sku = lineStockSku(line, skus);
  if (!sku || !outOfStockSkus.has(sku)) return null;
  const sameLine = Boolean(saved) && saved!.product_id === line.product_id
    && (saved!.product_sku_id ?? null) === (line.product_sku_id ?? null)
    && saved!.unit_of_measurement === line.unit_of_measurement.trim();
  if (!sameLine) return { kind: "out" };
  const quantity = Number(line.quantity);
  return Number.isFinite(quantity) && quantity > saved!.quantity ? { kind: "raise", savedQuantity: saved!.quantity } : null;
}

export function lineStockMessage(problem: LineStockProblem, unit: string) {
  if (!problem) return null;
  if (problem.kind === "out") return "Out of stock: this unit can't be added. Choose another unit or product, or update the stock first.";
  return `Out of stock: keep or lower the quantity (saved: ${problem.savedQuantity} ${unit.trim()}), or update the stock first.`;
}
