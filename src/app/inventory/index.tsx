import { Redirect } from "expo-router";

/** Inventory is now the Stocked list on Products & stock. */
export default function InventoryRoute() {
  return <Redirect href={{ pathname: "/products", params: { filter: "stocked" } }} />;
}
