import { useQuery } from "@tanstack/react-query";
import { Redirect, useLocalSearchParams } from "expo-router";

import { LoadingState, Screen } from "@/components";
import { unwrap } from "@/services/data";
import { supabase } from "@/services/supabase";

/** Old stock links name a SKU; they open that product's Stock tab. */
export default function InventoryDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sku = useQuery({
    queryKey: ["inventory", "sku-product", id],
    queryFn: async () => (await unwrap(supabase.from("product_skus").select("product_id").eq("id", id).maybeSingle())) as { product_id: string } | null,
  });
  if (sku.isPending) return <Screen title="Stock" showBackButton><LoadingState message="Opening product..." /></Screen>;
  if (!sku.data) return <Redirect href={{ pathname: "/products", params: { filter: "stocked" } }} />;
  return <Redirect href={{ pathname: "/products/[id]", params: { id: sku.data.product_id, tab: "stock" } }} />;
}
