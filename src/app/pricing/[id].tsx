import { Redirect, useLocalSearchParams } from "expo-router";

/** Old Pricing detail links open the product's Pricing tab. */
export default function PriceDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: "/products/[id]", params: { id, tab: "pricing" } }} />;
}
