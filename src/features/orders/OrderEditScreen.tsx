import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";

import { Avatar, Banner, BottomSheet, Card, Chip, DateStrip, EmptyState, FormInput, LoadingState, PrimaryButton, Screen, SearchBar, StatusBadge, useToast } from "@/components";
import { colors, radii, shadows, spacing, typography } from "@/constants/theme";
import { supabase } from "@/services/supabase";
import type { Customer, Product, ProductSku, ProductVariety } from "@/types/business";
import { customerName } from "@/utils/customer";

import { lineStockMessage, lineStockProblem, lineStockSku, type SavedLine } from "./editOrderLogic";

type EditableItem = { key: string; product_id: string; product_name: string; product_sku_id: string | null; variety_id: string | null; quantity: string; unit_of_measurement: string; notes: string };
type EditOrder = { id: string; order_number: string; customer_id: string; requested_delivery_date: string; notes: string | null; status: string; deliveries: { status: string }[] | null; order_items: { id: string; product_id: string; product_sku_id: string | null; variety_id: string | null; quantity: number; unit_of_measurement: string; notes: string | null; products: { product_name: string } | null }[] };

export function OrderEditScreen({ orderId }: { orderId?: string }) {
  const toast = useToast();
  const [order, setOrder] = useState<EditOrder | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [skus, setSkus] = useState<ProductSku[]>([]);
  const [varieties, setVarieties] = useState<ProductVariety[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<EditableItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<"customer" | "product" | null>(null);
  const [search, setSearch] = useState("");
  // SKUs with none in stock (tracked products only). A failed lookup leaves this empty, never "all out".
  const [outOfStockSkus, setOutOfStockSkus] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!orderId) return;
    let active = true;
    void Promise.all([
      supabase.from("orders").select("id,order_number,customer_id,requested_delivery_date,notes,status,deliveries(status),order_items(id,product_id,product_sku_id,variety_id,quantity,unit_of_measurement,notes,products(product_name))").eq("id", orderId).single(),
      supabase.from("customers").select("*").eq("status", "active").order("business_name"),
      supabase.from("products").select("*").eq("status", "active").order("product_name"),
      supabase.from("product_skus").select("*").eq("status", "active"),
      supabase.from("product_varieties").select("*").eq("status", "active"),
    ]).then(([orderResult, customerResult, productResult, skuResult, varietyResult]) => {
      if (!active) return;
      if (orderResult.error) Alert.alert("Unable to load order", orderResult.error.message);
      const loadedOrder = orderResult.data as unknown as EditOrder | null;
      setOrder(loadedOrder);
      setCustomers((customerResult.data ?? []) as Customer[]);
      setProducts((productResult.data ?? []) as Product[]);
      const productIds = ((productResult.data ?? []) as Product[]).map((item) => item.id);
      if (productIds.length) {
        void supabase.rpc("get_out_of_stock_units", { p_product_ids: productIds }).then(({ data }) => {
          if (active && Array.isArray(data)) setOutOfStockSkus(new Set((data as { sku_id: string }[]).map((row) => row.sku_id)));
        });
      }
      setSkus((skuResult.data ?? []) as ProductSku[]);
      setVarieties((varietyResult.data ?? []) as ProductVariety[]);
      if (loadedOrder) {
        setCustomerId(loadedOrder.customer_id);
        setDate(loadedOrder.requested_delivery_date);
        setNotes(loadedOrder.notes ?? "");
        setItems(loadedOrder.order_items.map((item) => ({ key: item.id, product_id: item.product_id, product_name: item.products?.product_name ?? "Product", product_sku_id: item.product_sku_id, variety_id: item.variety_id, quantity: String(Number(item.quantity)), unit_of_measurement: item.unit_of_measurement, notes: item.notes ?? "" })));
      }
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [orderId]);

  function updateItem(key: string, changes: Partial<EditableItem>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...changes } : item)));
  }

  // Prototype rule (Jac, 8 Nov): a product is added in its own unit, so it is out of stock when that
  // unit's SKU (a selling SKU first, as the server picks it) has none on hand.
  function isOutOfStock(product: Product) {
    const sku = lineStockSku({ product_id: product.id, product_sku_id: null, unit_of_measurement: product.unit_of_measurement ?? "" }, skus);
    return Boolean(sku && outOfStockSkus.has(sku));
  }

  // Saved lines, by id, as the server compares them: a line whose unit has a recorded 0
  // may keep or lower its quantity but not raise it (Jac, 8 Nov).
  const savedLines = new Map<string, SavedLine>((order?.order_items ?? []).map((line) => [line.id, { product_id: line.product_id, product_sku_id: line.product_sku_id, unit_of_measurement: line.unit_of_measurement, quantity: Number(line.quantity) }]));
  const stockProblem = (item: EditableItem) => lineStockProblem(item, savedLines.get(item.key), skus, outOfStockSkus);

  function addProduct(product: Product) {
    if (isOutOfStock(product)) return;
    const sku = skus.find((item) => item.product_id === product.id && item.selling_sku) ?? skus.find((item) => item.product_id === product.id);
    setItems((current) => [...current, { key: `new-${product.id}-${Date.now()}`, product_id: product.id, product_name: product.product_name, product_sku_id: null, variety_id: null, quantity: "", unit_of_measurement: product.unit_of_measurement ?? sku?.unit_of_measurement ?? "unit", notes: "" }]);
    setSheet(null);
    setSearch("");
  }

  const valid = Boolean(customerId && date && items.length) && items.every((item) => Number(item.quantity) > 0 && item.unit_of_measurement.trim() && !stockProblem(item));

  async function save() {
    if (!order || !date || !valid) return;
    setSaving(true);
    const { error } = await supabase.rpc("edit_order_with_items", {
      p_order_id: order.id,
      p_order: { customer_id: customerId, requested_delivery_date: date, notes },
      p_items: items.map((item) => ({ product_id: item.product_id, product_sku_id: item.product_sku_id, variety_id: item.variety_id, quantity: Number(item.quantity), unit_of_measurement: item.unit_of_measurement.trim(), notes: item.notes })),
    });
    setSaving(false);
    if (error) {
      Alert.alert("Unable to save changes", error.message);
      return;
    }
    toast(`${order.order_number} updated`);
    router.back();
  }

  if (!loaded) return <Screen title="Edit order" showBackButton><LoadingState message="Loading order..." /></Screen>;
  // Prototype: any open order can be edited; completed and cancelled orders stay locked.
  if (!order || order.status === "completed" || order.status === "cancelled") return <Screen title="Edit order" showBackButton><Card><EmptyState title="Order cannot be edited" description="Completed and cancelled orders are locked." icon="lock-closed-outline" /></Card></Screen>;
  // Only the server's "Out for delivery" stop status means it has left; items are locked until it comes back.
  const outForDelivery = (order.deliveries ?? []).some((delivery) => delivery.status === "for_delivery");
  const packingStarted = order.status === "for_preparation" || order.status === "for_delivery";

  const customer = customers.find((item) => item.id === customerId);
  const term = search.trim().toLowerCase();

  return (
    <Screen
      title={`Edit ${order.order_number}`}
      showBackButton
      backIcon="close"
      keyboardAware
      footer={<PrimaryButton label="Save changes" size="lg" onPress={() => void save()} disabled={!valid} loading={saving} style={styles.flex} />}
      contentStyle={styles.content}
    >
      <Banner icon="information-circle">Items already on the order keep their price. New items, and every item if you change the customer, use current prices. The change is recorded in the order’s activity.</Banner>
      {outForDelivery ? (
        <Banner tone="warning" icon="alert-circle">This order is out for delivery. Products, varieties, units and quantities can’t be changed, and items can’t be added or removed, until the delivery comes back. Notes can still be changed.</Banner>
      ) : packingStarted ? (
        <Banner tone="warning" icon="alert-circle">{order.status === "for_delivery" ? "This order is already packed." : "This order is being packed."} Changing a product, variety, unit or quantity sends it back to Packing to recheck those items; other ticks stay and the delivery stays booked. Removed packed items must be confirmed as taken out. Note changes are shown to packers.</Banner>
      ) : null}

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Customer</Text>
        <Pressable accessibilityRole="button" onPress={() => { setSearch(""); setSheet("customer"); }} style={({ pressed }) => [styles.picker, pressed && styles.pressed]}>
          <Avatar name={customerName(customer) ?? "?"} />
          <View style={styles.flex}>
            <Text style={styles.pickerTitle}>{customerName(customer) ?? "Choose a customer"}</Text>
            {customer ? <Text style={styles.muted}>{customer.customer_code}{customer.contact_person ? ` · ${customer.contact_person}` : ""}</Text> : null}
          </View>
          <Text style={styles.link}>Change</Text>
        </Pressable>
      </View>

      <DateStrip label="Delivery date" value={date} onChange={setDate} />

      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Notes for the team</Text>
        <TextInput value={notes} onChangeText={setNotes} placeholder="Optional" placeholderTextColor={colors.textMuted} multiline style={styles.textarea} />
      </View>

      <View style={styles.itemsHead}>
        <Text style={styles.sectionTitle}>Items</Text>
        <Pressable accessibilityRole="button" onPress={() => { setSearch(""); setSheet("product"); }} hitSlop={8} style={styles.addLink}>
          <Ionicons name="add" size={18} color={colors.primary} />
          <Text style={styles.link}>Add product</Text>
        </Pressable>
      </View>
      {items.length ? items.map((item) => {
        const itemSkus = skus.filter((sku) => sku.product_id === item.product_id);
        const itemVarieties = varieties.filter((variety) => variety.product_id === item.product_id);
        const lineOut = Boolean(outOfStockSkus.has(lineStockSku(item, skus) ?? ""));
        const stockMessage = lineStockMessage(stockProblem(item), item.unit_of_measurement);
        return (
          <View key={item.key} style={styles.item}>
            <View style={styles.itemHead}>
              <Text style={styles.itemName}>{item.product_name}</Text>
              {lineOut ? <StatusBadge label="Out of stock" tone="danger" /> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.product_name}`} onPress={() => setItems((current) => current.filter((row) => row.key !== item.key))} hitSlop={8}>
                <Text style={styles.remove}>Remove</Text>
              </Pressable>
            </View>
            <View style={styles.row}>
              <View style={styles.flex}><FormInput label="Quantity" value={item.quantity} onChangeText={(quantity) => updateItem(item.key, { quantity: quantity.replace(/[^0-9.]/g, "") })} keyboardType="decimal-pad" placeholder="0" /></View>
              <View style={styles.flex}><FormInput label="Unit" value={item.unit_of_measurement} onChangeText={(unit) => updateItem(item.key, { unit_of_measurement: unit })} placeholder="kg, crate" autoCapitalize="none" /></View>
            </View>
            {stockMessage ? <Text style={styles.stockError}>{stockMessage}</Text> : null}
            {itemSkus.length ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>SKU</Text>
                <View style={styles.chips}>
                  <Chip label="None" selected={item.product_sku_id === null} onPress={() => updateItem(item.key, { product_sku_id: null })} />
                  {itemSkus.map((sku) => <Chip key={sku.id} label={sku.selling_sku ?? sku.buying_sku ?? "SKU"} selected={item.product_sku_id === sku.id} onPress={() => updateItem(item.key, { product_sku_id: sku.id, unit_of_measurement: sku.unit_of_measurement })} />)}
                </View>
              </View>
            ) : null}
            {itemVarieties.length ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Variety</Text>
                <View style={styles.chips}>
                  <Chip label="Any" selected={item.variety_id === null} onPress={() => updateItem(item.key, { variety_id: null })} />
                  {itemVarieties.map((variety) => <Chip key={variety.id} label={variety.variety_name} selected={item.variety_id === variety.id} onPress={() => updateItem(item.key, { variety_id: variety.id })} />)}
                </View>
              </View>
            ) : null}
            <FormInput label="Item note" value={item.notes} onChangeText={(value) => updateItem(item.key, { notes: value })} placeholder="Optional" />
          </View>
        );
      }) : <Card><EmptyState icon="cart-outline" title="No items" description="An order needs at least one item." /></Card>}

      <BottomSheet visible={sheet !== null} onClose={() => setSheet(null)}>
        <Text style={styles.sheetTitle}>{sheet === "customer" ? "Choose customer" : "Add product"}</Text>
        <SearchBar value={search} onChangeText={setSearch} placeholder={sheet === "customer" ? "Search customers" : "Search products"} />
        {sheet === "customer"
          ? customers.filter((item) => `${customerName(item)} ${item.brand_name ?? ""} ${item.customer_code}`.toLowerCase().includes(term)).map((item) => (
            <Pressable key={item.id} accessibilityRole="button" onPress={() => { setCustomerId(item.id); setSheet(null); }} style={({ pressed }) => [styles.option, item.id === customerId && styles.optionSelected, pressed && styles.pressed]}>
              <Text style={styles.pickerTitle}>{customerName(item)}</Text>
              <Text style={styles.muted}>{item.customer_code}</Text>
            </Pressable>
          ))
          : products.filter((item) => item.product_name.toLowerCase().includes(term)).map((item) => {
            const out = isOutOfStock(item);
            return (
              <Pressable key={item.id} accessibilityRole="button" accessibilityState={{ disabled: out }} disabled={out} onPress={() => addProduct(item)} style={({ pressed }) => [styles.option, styles.optionRow, out && styles.optionBlocked, pressed && styles.pressed]}>
                <Text style={[styles.pickerTitle, styles.flex]}>{item.product_name}</Text>
                {out ? <StatusBadge label="Out of stock" tone="danger" /> : null}
              </Pressable>
            );
          })}
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14 },
  flex: { flex: 1, minWidth: 0 },
  optionRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  optionBlocked: { opacity: 0.6 },
  pressed: { opacity: 0.75 },
  field: { gap: spacing.sm },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  picker: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md },
  pickerTitle: { ...typography.bodyMedium, color: colors.text },
  muted: { ...typography.caption, color: colors.textSecondary },
  link: { fontSize: 13, fontWeight: "700", color: colors.primary },
  textarea: { minHeight: 72, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, backgroundColor: colors.surface, ...typography.body, color: colors.text, textAlignVertical: "top" },
  itemsHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.xs },
  sectionTitle: { ...typography.section, color: colors.text },
  addLink: { flexDirection: "row", alignItems: "center", gap: 2 },
  item: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md, ...shadows.card },
  itemHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  itemName: { ...typography.bodyMedium, color: colors.text, flex: 1 },
  remove: { fontSize: 13, fontWeight: "700", color: colors.danger },
  stockError: { ...typography.caption, color: colors.danger },
  row: { flexDirection: "row", gap: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  option: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingVertical: spacing.md, paddingHorizontal: 14, gap: 2 },
  optionSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primaryMuted },
});
