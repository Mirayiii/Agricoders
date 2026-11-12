/**
 * Pages of a list, as in the prototype (MEAH-Prototype 2, createPaginationBar):
 * 15 per page for Orders, Products, Archived products, Done deliveries and the
 * New order product list; 10 for Customers. With 5 pages or fewer every number
 * shows; otherwise the first and last page, the pages around the current one,
 * and "…" for the gaps.
 */
export type PageItem = { kind: "page"; page: number; current: boolean } | { kind: "gap"; key: string };

export const PAGE_SIZE = 15;
export const CUSTOMER_PAGE_SIZE = 10;

export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

/** The page clamped to what exists, so a shorter list never shows an empty page. */
export function clampPage(page: number, total: number, size: number): number {
  return Math.min(Math.max(1, Math.floor(page) || 1), pageCount(total, size));
}

export function pageSlice<T>(items: readonly T[], page: number, size: number): T[] {
  const current = clampPage(page, items.length, size);
  return items.slice((current - 1) * size, current * size);
}

export function pageItems(current: number, pages: number): PageItem[] {
  const page = (n: number): PageItem => ({ kind: "page", page: n, current: n === current });
  const gap = (key: string): PageItem => ({ kind: "gap", key });
  if (pages <= 1) return [];
  if (pages <= 5) return Array.from({ length: pages }, (_, i) => page(i + 1));
  if (current <= 3) return [page(1), page(2), page(3), page(4), gap("end"), page(pages)];
  if (current >= pages - 2) return [page(1), gap("start"), page(pages - 3), page(pages - 2), page(pages - 1), page(pages)];
  return [page(1), gap("start"), page(current - 1), page(current), page(current + 1), gap("end"), page(pages)];
}
