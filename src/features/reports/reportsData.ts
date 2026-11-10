import { useQuery } from "@tanstack/react-query";
import { Platform, Share } from "react-native";

import { unwrap } from "@/services/data";
import { supabase } from "@/services/supabase";
import type { OrderStatus } from "@/types/orders";
import type { DailyPoint, Range, Statement, Totals } from "./reportsLogic";

export const reportsKeys = {
  all: ["reports"] as const,
  sales: (range: Range) => ["reports", "sales", range.start, range.end] as const,
  statement: (customerId: string, range: Range) => ["reports", "statement", customerId, range.start, range.end] as const,
  item: (productId: string, range: Range) => ["reports", "item", productId, range.start, range.end] as const,
  orders: (range: Range) => ["reports", "orders", range.start, range.end] as const,
  prices: (date: string) => ["reports", "prices", date] as const,
};

export type CustomerTotals = Totals & { customer_id: string; name: string; code: string; status: string };
export type ProductTotals = Totals & { product_id: string; name: string; unit: string | null; clients: number; main_volume: number };
export type SalesReport = { start: string; end: string; totals: Totals; daily: DailyPoint[]; customers: CustomerTotals[]; products: ProductTotals[]; active_customers: number; products_total: number };

/** Overview, Customer report and Product volume report (administrators only, checked on the server). */
export function useSalesReport(range: Range) {
  return useQuery({
    queryKey: reportsKeys.sales(range),
    queryFn: async () => (await unwrap(supabase.rpc("get_sales_report", { p_start: range.start, p_end: range.end }))) as SalesReport,
  });
}

export function useCustomerStatement(customerId: string, range: Range) {
  return useQuery({
    queryKey: reportsKeys.statement(customerId, range),
    enabled: Boolean(customerId),
    queryFn: async () => (await unwrap(supabase.rpc("get_customer_statement", { p_customer_id: customerId, p_start: range.start, p_end: range.end }))) as Statement,
  });
}

export type ItemAnalytics = {
  product: { id: string; name: string; unit: string | null; unit_key: string | null; selling_sku: string | null; buying_sku: string | null; selling_price: number | null; cost_price: number | null };
  start: string;
  end: string;
  totals: Totals;
  daily: DailyPoint[];
  customers: (Totals & { customer_id: string; name: string; main_volume: number })[];
};

export function useItemAnalytics(productId: string, range: Range) {
  return useQuery({
    queryKey: reportsKeys.item(productId, range),
    enabled: Boolean(productId),
    queryFn: async () => (await unwrap(supabase.rpc("get_item_analytics", { p_product_id: productId, p_start: range.start, p_end: range.end }))) as ItemAnalytics,
  });
}

export type OrderReportRow = { order_id: string; order_number: string; customer_name: string; status: OrderStatus; requested_delivery_date: string; item_count: number; total: number; total_rows: number };

const PAGE = 100;

/** Every order in the period (the existing order report, now administrator-only). */
export function useOrderReport(range: Range) {
  return useQuery({
    queryKey: reportsKeys.orders(range),
    queryFn: async () => {
      const rows: OrderReportRow[] = [];
      for (let page = 0; page < 20; page += 1) {
        const batch = ((await unwrap(supabase.rpc("get_order_report", { p_start: range.start, p_end: range.end, p_customer_id: null, p_status: null, p_limit: PAGE, p_offset: page * PAGE }))) as OrderReportRow[])
          .map((row) => ({ ...row, total: Number(row.total), item_count: Number(row.item_count) }));
        rows.push(...batch);
        if (batch.length < PAGE || rows.length >= Number(batch[0]?.total_rows ?? 0)) break;
      }
      return rows;
    },
  });
}

export type DailyPrices = {
  date: string;
  dates: string[];
  products: { product_id: string; name: string; unit: string | null; sku: string | null; cost_price: number | null; selling_price: number | null; margin_percent: number | null; set_on_date: boolean }[];
};

export function useDailyPrices(date: string) {
  return useQuery({
    queryKey: reportsKeys.prices(date),
    queryFn: async () => (await unwrap(supabase.rpc("get_daily_prices", { p_date: date }))) as DailyPrices,
  });
}

/**
 * Shares a CSV: a download on the web, the share sheet (as text) on phones,
 * where a spreadsheet app or email can take it.
 */
export async function shareCsv(csv: string, fileName: string): Promise<void> {
  if (Platform.OS === "web") {
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  await Share.share({ title: fileName, message: csv });
}
