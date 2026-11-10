import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { BottomSheet, Button, Card, EmptyState, ErrorState, FormInput, Icon, InlineAlert, LoadingState, Screen, SegmentedControl, StaleNotice, StatusBadge, Switch, useToast } from "@/components";
import { PERMISSIONS } from "@/constants/permissions";
import { colors, radii, shadows, spacing, text } from "@/constants/theme";
import { usePermission } from "@/features/auth";
import { OfflineReadOnly, REQUIRES_CONNECTION } from "@/features/sync/OfflineReadOnly";
import { useIsOnline } from "@/services/offline";
import { manilaToday } from "@/features/purchasing/purchasingLogic";
import { formatMoney, relativeTime } from "@/utils/format";
import {
  problemText, useAdjustStock, usePriceHistory, useProduct, useProductUnits, useSetProductArchived, useSetProductPrice, useStockActivity, useUpdateProduct,
  type ProductChanges, type UnitRow,
} from "../productsData";
import {
  MORE_UNITS, STOCK_META, cleanUnit, formatPercent, formatQty, marginAmount, marginPercent, marginPreview, marginTone, parsePrice, priceProblem, stockAfter,
  type ProductOverview, type StockMode,
} from "../productsLogic";

export type ProductTab = "details" | "pricing" | "stock";
export function isProductTab(value: unknown): value is ProductTab {
  return value === "details" || value === "pricing" || value === "stock";
}

/** Figma "Product detail" (Details, Pricing, Stock). */
export function ProductDetailScreen({ productId = "", initialTab = "details" }: { productId?: string; initialTab?: ProductTab }) {
  const toast = useToast();
  const canManage = usePermission(PERMISSIONS.manageProducts);
  const canPrice = usePermission(PERMISSIONS.managePricing);
  const canStock = usePermission(PERMISSIONS.manageInventory);
  const online = useIsOnline();
  const query = useProduct(productId);
  const [tab, setTab] = useState<ProductTab>(initialTab);
  const [confirming, setConfirming] = useState(false);
  const archive = useSetProductArchived();

  const product = query.product;
  if (query.isPending) return <Screen title="Product" showBackButton><LoadingState message="Loading product..." /></Screen>;
  if (!product) {
    return (
      <Screen title="Product" showBackButton>
        {query.isError && !query.data
          ? <ErrorState description="This product couldn’t be loaded." onRetry={() => void query.refetch()} />
          : <Card><EmptyState icon="alert-circle-outline" title="Product unavailable" description="This product could not be found." /></Card>}
      </Screen>
    );
  }

  const archived = product.status === "archived";
  const tabs: { key: ProductTab; label: string }[] = [
    { key: "details", label: "Details" },
    ...(canPrice ? [{ key: "pricing" as const, label: "Pricing" }] : []),
    ...(product.track_stock ? [{ key: "stock" as const, label: "Stock" }] : []),
  ];
  const current = tabs.some((item) => item.key === tab) ? tab : "details";
  // Figma puts the destructive action under Stock; untracked products have no Stock tab.
  const archiveHere = canManage && (current === "stock" || (current === "details" && !product.track_stock) || archived);

  function setArchived(next: boolean) {
    archive.mutate({ productId: product!.id, archived: next }, {
      onSuccess: () => {
        setConfirming(false);
        toast(next ? `${product!.product_name} archived. Past orders keep it.` : `${product!.product_name} restored`);
      },
    });
  }

  return (
    <Screen title={product.product_name} showBackButton contentStyle={styles.content} refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <StaleNotice query={query} />
      <OfflineReadOnly what="products" />
      <Hero product={product} showPrice={canPrice} />
      {archived ? (
        <View style={styles.note} accessibilityRole="text">
          <Icon name="archive" size={16} color={colors.textSecondary} />
          <Text style={styles.noteText}>Archived products can’t be added to new orders or priced. Past orders keep their lines and totals. Restore it to sell it again.</Text>
        </View>
      ) : null}
      {tabs.length > 1 ? <SegmentedControl options={tabs} value={current} onChange={setTab} /> : null}

      {current === "details" ? <DetailsTab product={product} canManage={canManage && !archived} canPrice={canPrice} offline={!online} /> : null}
      {current === "pricing" ? <PricingTab product={product} canManage={canPrice && !archived} offline={!online} /> : null}
      {current === "stock" ? <StockTab product={product} canManage={canStock && !archived} editable={online} /> : null}

      {archiveHere ? (
        <Button
          label={archived ? "Restore product" : "Archive product"}
          type={archived ? "brandOutline" : "destructive"}
          size="lg"
          icon={archived ? "refresh" : "archive"}
          disabled={!online}
          onPress={() => { archive.reset(); setConfirming(true); }}
        />
      ) : null}

      <BottomSheet visible={confirming} onClose={() => setConfirming(false)}>
        <View style={styles.sheetHead}>
          <View style={[styles.sheetIcon, archived && styles.sheetIconRestore]}><Icon name={archived ? "refresh" : "archive"} size={20} color={archived ? colors.primary : colors.danger} /></View>
          <View style={styles.flex}>
            <Text style={styles.sheetTitle} accessibilityRole="header">{archived ? `Restore ${product.product_name}?` : `Archive ${product.product_name}?`}</Text>
            <Text style={styles.sheetBody}>
              {archived
                ? "It comes back to the product list and can be priced and added to new orders again."
                : "It will be removed from products, stock and new orders. Past orders keep their records. Nothing is deleted, and you can restore it at any time."}
            </Text>
          </View>
        </View>
        {archive.isError ? <InlineAlert title={archived ? "Not restored" : "Not archived"} message={problemText(archive.error)} /> : null}
        <Button label={archived ? "Restore product" : "Archive product"} type={archived ? "primary" : "destructive"} size="lg" loading={archive.isPending} onPress={() => setArchived(!archived)} />
        <Button label={archived ? "Cancel" : "Keep product"} type="brandOutline" size="lg" onPress={() => setConfirming(false)} />
      </BottomSheet>
    </Screen>
  );
}

function Hero({ product, showPrice }: { product: ProductOverview; showPrice: boolean }) {
  const meta = product.track_stock && product.stock_status ? STOCK_META[product.stock_status] : null;
  return (
    <Card style={styles.hero}>
      <View style={styles.heroTop}>
        <View style={styles.leaf}><Icon name="leaf" size={22} color={colors.primary} /></View>
        <Text style={styles.heroName}>{product.product_name}</Text>
      </View>
      <View style={styles.heroBottom}>
        <View style={styles.flex}>
          {showPrice ? (
            <>
              <Text style={styles.caption}>Selling price</Text>
              <Text style={styles.heroPrice}>{product.selling_price === null ? "No price yet" : `${formatMoney(product.selling_price)}${product.unit ? ` / ${product.unit}` : ""}`}</Text>
            </>
          ) : (
            <>
              <Text style={styles.caption}>Sold by</Text>
              <Text style={styles.heroPrice}>{product.unit ?? "No unit"}</Text>
            </>
          )}
        </View>
        {meta ? (
          <View style={styles.heroStock}>
            <StatusBadge label={meta.label} tone={meta.tone} />
            <Text style={styles.caption}>{formatQty(product.stock_quantity ?? 0)} {product.unit} in stock</Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------

function DetailsTab({ product, canManage, canPrice, offline }: { product: ProductOverview; canManage: boolean; canPrice: boolean; offline: boolean }) {
  const toast = useToast();
  const units = useProductUnits(product.id);
  const update = useUpdateProduct();
  const [custom, setCustom] = useState("");
  const [makingDefault, setMakingDefault] = useState<string | null>(null);
  const [editingSkus, setEditingSkus] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const list = units.data ?? [];
  const isDefault = (unit: UnitRow) => unit.unit_of_measurement.toLowerCase() === (product.unit ?? "").toLowerCase();
  const sorted = [...list].sort((a, b) => Number(isDefault(b)) - Number(isDefault(a)));
  const suggestions = MORE_UNITS.filter((unit) => !list.some((row) => row.unit_of_measurement.toLowerCase() === unit)).slice(0, 4);

  function change(changes: ProductChanges, done?: string) {
    update.mutate({ productId: product.id, changes }, { onSuccess: () => { if (done) toast(done); void units.refetch(); } });
  }

  function setDefault(unit: string) {
    // A priced product needs prices in the new unit (the server checks it too).
    if (product.selling_price !== null && canPrice) { update.reset(); setMakingDefault(unit); return; }
    change({ default_unit: unit }, `Prices and new orders now use ${unit}`);
  }

  return (
    <>
      <Card style={styles.toggleCard}>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>Track inventory (stock)</Text>
          <Text style={styles.caption}>{product.track_stock ? "Stock tracking enabled (inventory held)" : "Not tracked: no stock count is kept"}</Text>
        </View>
        <Switch
          value={product.track_stock}
          disabled={!canManage || offline || update.isPending}
          accessibilityLabel="Track inventory"
          onChange={(value) => change({ track_stock: value }, value ? "Stock tracking on. Count the stock on the Stock tab." : "Stock tracking off. The last count is kept.")}
        />
      </Card>

      <Card style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.cardTitle}>Units</Text>
          <StatusBadge label={`${list.length} unit${list.length === 1 ? "" : "s"}`} tone="success" />
        </View>
        {units.isPending ? <LoadingState message="Loading units..." /> : sorted.map((unit) => (
          <View key={unit.id} style={styles.unitRow}>
            <Text style={styles.unitName}>{unit.unit_of_measurement}</Text>
            {isDefault(unit) ? <View style={styles.defaultPill}><Text style={styles.defaultText}>Default</Text></View> : canManage ? (
              <Pressable accessibilityRole="button" disabled={offline} onPress={() => setDefault(unit.unit_of_measurement)} style={[styles.smallButton, offline && styles.offControl]}><Text style={styles.smallButtonText}>Set as default</Text></Pressable>
            ) : null}
            {canManage ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${unit.unit_of_measurement}`} disabled={offline} onPress={() => { update.reset(); setRenaming(unit.unit_of_measurement); }} style={[styles.smallButton, offline && styles.offControl]}>
                <Text style={styles.smallButtonText}>Rename</Text>
              </Pressable>
            ) : null}
            {canManage && !isDefault(unit) ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${unit.unit_of_measurement}`} disabled={offline} onPress={() => change({ remove_unit: unit.unit_of_measurement }, `${unit.unit_of_measurement} removed`)} style={[styles.removeButton, offline && styles.offControl]}>
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {canManage ? (
          <>
            <Text style={styles.caption}>Add another unit:</Text>
            <View style={styles.wrap}>
              {suggestions.map((unit) => (
                <Pressable key={unit} accessibilityRole="button" accessibilityLabel={`Add ${unit}`} disabled={offline} onPress={() => change({ add_unit: unit }, `${unit} added`)} style={[styles.suggestion, offline && styles.offControl]}>
                  <Text style={styles.suggestionText}>+ {unit}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.addRow}>
              <TextInput value={custom} onChangeText={setCustom} editable={!offline} placeholder="Custom unit (e.g. box, pack)..." placeholderTextColor={colors.textMuted} maxLength={20} style={[styles.input, offline && styles.offControl]} accessibilityLabel="Custom unit" />
              <Button label="Add unit" size="md" disabled={offline || !cleanUnit(custom)} onPress={() => { change({ add_unit: cleanUnit(custom) }, `${cleanUnit(custom)} added`); setCustom(""); }} />
            </View>
          </>
        ) : null}
        {update.isError && !makingDefault && !editingSkus && !renaming ? <InlineAlert title="Not changed" message={problemText(update.error)} /> : null}
      </Card>

      <Card style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.cardTitle}>SKUs</Text>
          {canManage ? <Text style={styles.caption}>{offline ? REQUIRES_CONNECTION : "Tap code to edit"}</Text> : null}
        </View>
        {(["buying", "selling"] as const).map((kind) => {
          const code = kind === "buying" ? product.buying_sku : product.selling_sku;
          return (
            <Pressable key={kind} disabled={!canManage || offline} accessibilityRole="button" accessibilityLabel={`${kind === "buying" ? "Buying" : "Selling"} SKU ${code ?? "not set"}`} onPress={() => { update.reset(); setEditingSkus(true); }} style={styles.skuRow}>
              <View style={styles.skuCode}><Text style={[styles.unitName, !code && styles.muted]}>{code ?? "Not set"}</Text></View>
              <StatusBadge label={kind === "buying" ? "Buying" : "Selling"} tone="neutral" />
            </Pressable>
          );
        })}
        <Text style={styles.caption}>Codes belong to the default unit ({product.unit ?? "none"}).</Text>
      </Card>

      <DefaultUnitSheet product={product} unit={makingDefault} onClose={() => setMakingDefault(null)} />
      <SkuSheet product={product} visible={editingSkus} onClose={() => setEditingSkus(false)} />
      <RenameUnitSheet product={product} unit={renaming} onClose={() => setRenaming(null)} />
    </>
  );
}

/** Changing the default unit of a priced product asks for prices in that unit. */
function DefaultUnitSheet({ product, unit, onClose }: { product: ProductOverview; unit: string | null; onClose: () => void }) {
  return (
    <BottomSheet visible={Boolean(unit)} onClose={onClose}>
      {unit ? <DefaultUnitForm product={product} unit={unit} onClose={onClose} /> : null}
    </BottomSheet>
  );
}

function DefaultUnitForm({ product, unit, onClose }: { product: ProductOverview; unit: string; onClose: () => void }) {
  const toast = useToast();
  const update = useUpdateProduct();
  const [cost, setCost] = useState("");
  const [selling, setSelling] = useState("");
  const problem = priceProblem(cost, selling);
  const preview = marginPreview(cost, selling);
  return (
    <>
      <Text style={styles.sheetTitle} accessibilityRole="header">Make {unit} the default unit</Text>
      <Text style={styles.sheetBody}>
        Prices are set per {product.unit} ({formatMoney(product.selling_price ?? 0)} now). Enter the price per {unit}; it applies to orders saved from now on. Past orders keep their units and prices.
      </Text>
      <View style={styles.row}>
        <View style={styles.flex}><FormInput label={`Cost per ${unit} (₱)`} value={cost} onChangeText={setCost} placeholder="0.00" keyboardType="decimal-pad" /></View>
        <View style={styles.flex}><FormInput label={`Selling per ${unit} (₱)`} value={selling} onChangeText={setSelling} placeholder="0.00" keyboardType="decimal-pad" /></View>
      </View>
      {preview ? <MarginStrip text={preview.text} unit={unit} /> : null}
      {update.isError ? <InlineAlert title="Not changed" message={problemText(update.error)} /> : null}
      <Button
        label={`Use ${unit} with this price`}
        size="lg"
        disabled={Boolean(problem)}
        loading={update.isPending}
        onPress={() => update.mutate(
          { productId: product.id, changes: { default_unit: unit, cost_price: parsePrice(cost) as number, selling_price: parsePrice(selling) as number } },
          { onSuccess: () => { onClose(); toast(`Prices and new orders now use ${unit}`); } },
        )}
      />
    </>
  );
}

/**
 * Renaming a unit. Past orders and receipts saved their unit name, so they keep
 * the old one. A unit with stock or prices can only be respelled as the same
 * measure (kg to kilo); the server checks this and logs every rename.
 */
function RenameUnitSheet({ product, unit, onClose }: { product: ProductOverview; unit: string | null; onClose: () => void }) {
  return <BottomSheet visible={Boolean(unit)} onClose={onClose}>{unit ? <RenameUnitForm product={product} unit={unit} onClose={onClose} /> : null}</BottomSheet>;
}

function RenameUnitForm({ product, unit, onClose }: { product: ProductOverview; unit: string; onClose: () => void }) {
  const toast = useToast();
  const update = useUpdateProduct();
  const [name, setName] = useState(unit);
  const next = cleanUnit(name);
  return (
    <>
      <Text style={styles.sheetTitle} accessibilityRole="header">Rename {unit}</Text>
      <FormInput label="Unit name" value={name} onChangeText={setName} placeholder="e.g. kilo" maxLength={20} />
      <Text style={styles.caption}>
        Orders and receipts already saved keep &quot;{unit}&quot;. If this unit has stock or prices, you can only respell it as the same measure (for example kg to kilo). To sell by a different measure, add a new unit instead.
      </Text>
      {update.isError ? <InlineAlert title="Not renamed" message={problemText(update.error)} /> : null}
      <Button label="Save name" size="lg" disabled={!next || next === unit} loading={update.isPending}
        onPress={() => update.mutate({ productId: product.id, changes: { rename_unit: { from: unit, to: next } } }, { onSuccess: () => { onClose(); toast(`${unit} renamed to ${next}`); } })} />
    </>
  );
}

function SkuSheet({ product, visible, onClose }: { product: ProductOverview; visible: boolean; onClose: () => void }) {
  return <BottomSheet visible={visible} onClose={onClose}>{visible ? <SkuForm product={product} onClose={onClose} /> : null}</BottomSheet>;
}

function SkuForm({ product, onClose }: { product: ProductOverview; onClose: () => void }) {
  const toast = useToast();
  const update = useUpdateProduct();
  const [buying, setBuying] = useState(product.buying_sku ?? "");
  const [selling, setSelling] = useState(product.selling_sku ?? "");
  const changed = buying.trim().toUpperCase() !== (product.buying_sku ?? "") || selling.trim().toUpperCase() !== (product.selling_sku ?? "");
  return (
    <>
      <Text style={styles.sheetTitle} accessibilityRole="header">SKU codes · {product.unit}</Text>
      <View style={styles.row}>
        <View style={styles.flex}><FormInput label="Buying SKU" value={buying} onChangeText={setBuying} placeholder="e.g. 100011" autoCapitalize="characters" maxLength={40} /></View>
        <View style={styles.flex}><FormInput label="Selling SKU" value={selling} onChangeText={setSelling} placeholder="e.g. 101011" autoCapitalize="characters" maxLength={40} /></View>
      </View>
      <Text style={styles.caption}>Leave a code blank to clear it. Each code can belong to one product only.</Text>
      {update.isError ? <InlineAlert title="Not saved" message={problemText(update.error)} /> : null}
      <Button label="Save codes" size="lg" disabled={!changed} loading={update.isPending}
        onPress={() => update.mutate({ productId: product.id, changes: { buying_sku: buying, selling_sku: selling } }, { onSuccess: () => { onClose(); toast("SKU codes saved"); } })} />
    </>
  );
}

function MarginStrip({ text: label, unit }: { text: string; unit: string | null }) {
  return (
    <View style={styles.marginStrip}>
      <Text style={styles.marginStripText}>{label}</Text>
      {unit ? <Text style={styles.caption}>per {unit}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

function PricingTab({ product, canManage, offline }: { product: ProductOverview; canManage: boolean; offline: boolean }) {
  const history = usePriceHistory(product.id);
  const [updating, setUpdating] = useState(false);
  const [today] = useState(manilaToday);
  const percent = marginPercent(product.cost_price, product.selling_price);
  const amount = marginAmount(product.cost_price, product.selling_price);
  return (
    <>
      <Card style={styles.section}>
        <Text style={styles.caption}>Selling price</Text>
        <Text style={styles.bigPrice}>{product.selling_price === null ? "No price yet" : formatMoney(product.selling_price)}{product.selling_price !== null && product.unit ? <Text style={styles.perUnit}> / {product.unit}</Text> : null}</Text>
        <View style={styles.divider} />
        <View style={styles.figures}>
          <Figure label="Cost" value={product.cost_price === null ? "—" : product.cost_price === 0 ? "Not recorded" : formatMoney(product.cost_price)} />
          <Figure label="Margin" value={amount === null ? "—" : formatMoney(amount)} />
          <View style={styles.figure}>
            <Text style={styles.caption}>Margin %</Text>
            {percent === null ? <Text style={styles.figureValue}>—</Text> : <StatusBadge label={formatPercent(percent)} tone={marginTone(percent)} />}
          </View>
        </View>
        {product.selling_price !== null && percent === null ? <Text style={styles.caption}>No cost recorded, so the margin isn’t shown. Add the cost to see it.</Text> : null}
      </Card>
      {canManage ? <Button label="Update price" size="lg" icon="edit" disabled={offline} onPress={() => setUpdating(true)} /> : null}
      {canManage && offline ? <Text style={styles.offlineCaption}>{REQUIRES_CONNECTION}</Text> : null}
      <Card style={styles.section}>
        <Text style={styles.cardTitle}>Price history</Text>
        {history.isPending ? <LoadingState message="Loading prices..." /> : history.isError && !history.data ? (
          <ErrorState description="Price history couldn’t be loaded." onRetry={() => void history.refetch()} />
        ) : history.data?.length ? history.data.map((row) => {
          const future = row.price_date > today;
          return (
            <View key={row.id} style={styles.historyRow}>
              <View style={[styles.dot, row.is_current && styles.dotCurrent]} />
              <View style={styles.flex}>
                <Text style={styles.historyDate}>
                  {usDate(row.price_date)}
                  {row.is_current ? <Text style={styles.current}>  Current</Text> : future ? <Text style={styles.scheduled}>  Scheduled</Text> : null}
                </Text>
                <Text style={styles.caption}>Cost {row.cost_price ? formatMoney(row.cost_price) : "not recorded"} · Selling {formatMoney(row.selling_price)}</Text>
                <Text style={styles.by}>by {row.set_by ?? "Unknown"}</Text>
              </View>
              <Text style={styles.historyPercent}>{row.margin_percent === null ? "—" : formatPercent(row.margin_percent)}</Text>
            </View>
          );
        }) : <Text style={styles.caption}>No prices yet. Prices you set are kept here, and past orders keep the price they were saved with.</Text>}
      </Card>
      <PriceSheet product={product} visible={updating} onClose={() => setUpdating(false)} />
    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.caption}>{label}</Text>
      <Text style={styles.figureValue}>{value}</Text>
    </View>
  );
}

/** "08/25/2026", as Figma's price history. */
function usDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${m}/${d}/${y}`;
}

function PriceSheet({ product, visible, onClose }: { product: ProductOverview; visible: boolean; onClose: () => void }) {
  return <BottomSheet visible={visible} onClose={onClose}>{visible ? <PriceForm product={product} onClose={onClose} /> : null}</BottomSheet>;
}

/** Figma "Product detail · Update price". */
function PriceForm({ product, onClose }: { product: ProductOverview; onClose: () => void }) {
  const toast = useToast();
  const save = useSetProductPrice();
  const [cost, setCost] = useState(product.cost_price === null ? "" : String(product.cost_price));
  const [selling, setSelling] = useState(product.selling_price === null ? "" : String(product.selling_price));
  const problem = priceProblem(cost, selling);
  const preview = marginPreview(cost, selling);
  const unchanged = parsePrice(cost) === product.cost_price && parsePrice(selling) === product.selling_price;
  return (
    <>
      <Text style={styles.sheetTitle} accessibilityRole="header">Update price · {product.product_name}</Text>
      <View style={styles.row}>
        <View style={styles.flex}><FormInput label="Cost price (₱)" value={cost} onChangeText={setCost} placeholder="0.00" keyboardType="decimal-pad" /></View>
        <View style={styles.flex}><FormInput label="Selling price (₱)" value={selling} onChangeText={setSelling} placeholder="0.00" keyboardType="decimal-pad" /></View>
      </View>
      {preview ? <MarginStrip text={preview.text} unit={product.unit} /> : null}
      {cost.trim() || selling.trim() ? (problem ? <Text style={styles.problem}>{problem}</Text> : null) : null}
      <Text style={styles.caption}>The new price applies to orders saved from today. Past orders keep their prices. Enter 0 as the cost if it isn’t known yet.</Text>
      {save.isError ? <InlineAlert title="Price not saved" message={problemText(save.error)} /> : null}
      <Button label="Save price" size="lg" disabled={Boolean(problem) || unchanged} loading={save.isPending}
        onPress={() => save.mutate({ productId: product.id, cost: parsePrice(cost) as number, selling: parsePrice(selling) as number }, { onSuccess: () => { onClose(); toast("Price saved"); } })} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Stock (manual, as before)
// ---------------------------------------------------------------------------

const REASONS: Record<StockMode, string[]> = {
  increase: ["Supplier delivery", "Returned by customer", "Count correction"],
  decrease: ["Spoilage", "Damaged", "Count correction"],
};

function StockTab({ product, canManage, editable }: { product: ProductOverview; canManage: boolean; editable: boolean }) {
  const toast = useToast();
  const activity = useStockActivity(canManage ? product.sku_id : null);
  const adjust = useAdjustStock();
  const [mode, setMode] = useState<StockMode>("increase");
  const [amount, setAmount] = useState("0");
  const [threshold, setThreshold] = useState("");
  const [reason, setReason] = useState("");
  const quantity = product.stock_quantity ?? 0;
  const meta = product.stock_status ? STOCK_META[product.stock_status] : null;
  const after = stockAfter(quantity, mode, amount);
  const amountValue = Number(amount || 0);
  const thresholdValue = threshold.trim() === "" ? null : Number(threshold);
  const thresholdChanged = thresholdValue !== null && thresholdValue !== product.low_stock_threshold;
  const thresholdProblem = thresholdValue !== null && !(Number.isFinite(thresholdValue) && thresholdValue >= 0) ? "Enter an alert level of 0 or more" : null;
  const problem = after.problem ?? thresholdProblem ?? (!amountValue && !thresholdChanged ? "Enter a quantity or a new alert level" : amountValue && !reason.trim() ? "Choose or type a reason" : null);
  const step = (delta: number) => setAmount(String(Math.max(0, Math.round((amountValue + delta) * 1000) / 1000)));

  function save() {
    if (problem || !product.sku_id) return;
    // Only the alert level changed: record a count at the current quantity.
    const onlyAlert = !amountValue;
    adjust.mutate(
      { skuId: product.sku_id, type: onlyAlert ? "increase" : mode, quantity: amountValue, reason: onlyAlert ? "Low-stock alert changed" : reason.trim(), threshold: thresholdValue },
      { onSuccess: () => { setAmount("0"); setReason(""); setThreshold(""); void activity.refetch(); toast(onlyAlert ? "Alert level saved" : "Stock updated"); } },
    );
  }

  return (
    <>
      <Card style={styles.section}>
        <View style={styles.wrapCenter}>
          <Text style={styles.caption}>Stock on hand</Text>
          {product.selling_sku || product.buying_sku ? <View style={styles.codePill}><Text style={styles.codePillText}>{product.selling_sku ?? product.buying_sku} · {product.unit}</Text></View> : null}
          {meta ? <StatusBadge label={meta.label} tone={meta.tone} /> : null}
        </View>
        <Text style={[styles.stockBig, { color: product.stock_status === "available" ? colors.text : colors.danger }]}>{formatQty(quantity)} <Text style={styles.perUnit}>{product.unit} available</Text></Text>
        <View style={styles.alertNote}>
          <Icon name="alert-circle" size={14} color={colors.textSecondary} />
          <Text style={styles.caption}>{product.low_stock_threshold === null ? "No low-stock alert set" : `Low-stock alert at ${formatQty(product.low_stock_threshold)} ${product.unit}`}</Text>
        </View>
      </Card>

      {canManage ? (
        <Card style={styles.section}>
          <Text style={styles.cardTitle}>Update stock</Text>
          {!editable ? <Text style={styles.caption}>{REQUIRES_CONNECTION}</Text> : null}
          <SegmentedControl options={[{ key: "increase", label: "Add stock" }, { key: "decrease", label: "Remove" }]} value={mode} onChange={(value) => { setMode(value); setReason(""); }} />
          <Text style={styles.fieldLabel}>{mode === "increase" ? "Quantity to add" : "Quantity to remove"}</Text>
          <View style={styles.stepper}>
            <Pressable accessibilityRole="button" accessibilityLabel="Less" onPress={() => step(-1)} style={[styles.stepButton, styles.stepMinus]}><Icon name="minus" size={20} color={colors.onBrand} /></Pressable>
            <View style={styles.stepField}>
              <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" style={styles.stepInput} accessibilityLabel="Quantity" selectTextOnFocus />
              <Text style={styles.unitName}>{product.unit}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="More" onPress={() => step(1)} style={[styles.stepButton, styles.stepPlus]}><Icon name="plus" size={20} color={colors.onBrand} /></Pressable>
          </View>
          {amountValue ? (
            <>
              <Text style={styles.fieldLabel}>Reason</Text>
              <View style={styles.wrap}>
                {REASONS[mode].map((item) => (
                  <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: reason === item }} onPress={() => setReason(item)} style={[styles.reason, reason === item && styles.reasonOn]}>
                    <Text style={[styles.reasonText, reason === item && styles.reasonTextOn]}>{item}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput value={reason} onChangeText={setReason} placeholder="Or type a reason (e.g. Spoilage — soft bulbs)" placeholderTextColor={colors.textMuted} maxLength={200} style={styles.input} accessibilityLabel="Reason" />
            </>
          ) : null}
          <FormInput label="Low-stock alert at" value={threshold} onChangeText={setThreshold} placeholder={product.low_stock_threshold === null ? "e.g. 10" : `Now ${formatQty(product.low_stock_threshold)}`} keyboardType="decimal-pad" />
          <View style={styles.afterRow}>
            <Text style={styles.caption}>After update</Text>
            <Text style={styles.afterValue}>{formatQty(quantity)} → {formatQty(after.after)} {product.unit}</Text>
          </View>
          {(amountValue || thresholdChanged) && problem ? <Text style={styles.problem}>{problem}</Text> : null}
          {adjust.isError ? <InlineAlert title="Stock not updated" message={problemText(adjust.error)} /> : null}
          <Button label="Save stock update" size="lg" disabled={!editable || Boolean(problem)} loading={adjust.isPending} onPress={save} />
        </Card>
      ) : null}

      {canManage ? (
        <Card style={styles.section}>
          <Text style={styles.cardTitle}>Recent activity</Text>
          {activity.isPending ? <LoadingState message="Loading activity..." /> : activity.data?.length ? activity.data.map((entry) => (
            <View key={entry.id} style={styles.activity}>
              <Text style={styles.activityTitle}>{entry.transaction_type === "increase" ? "Added" : entry.transaction_type === "decrease" ? "Removed" : "Counted"} · {formatQty(Number(entry.previous_quantity))} → {formatQty(Number(entry.new_quantity))} {product.unit}</Text>
              <Text style={styles.caption}>{entry.reason}</Text>
              <Text style={styles.by}>{entry.performed_by_name} · {relativeTime(entry.created_at)}</Text>
            </View>
          )) : <Text style={styles.caption}>No stock changes yet.</Text>}
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  offControl: { opacity: 0.45 },
  offlineCaption: { ...text.caption, color: colors.textSecondary, textAlign: "center" },
  content: { gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: "row", gap: spacing.sm },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  wrapCenter: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  caption: { ...text.caption, color: colors.textSecondary },
  muted: { color: colors.textMuted },
  hero: { gap: spacing.md },
  heroTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  leaf: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  heroName: { ...text.title, color: colors.text, flex: 1 },
  heroBottom: { flexDirection: "row", alignItems: "flex-end", gap: spacing.md },
  heroPrice: { ...text.heading, color: colors.text },
  heroStock: { alignItems: "flex-end", gap: 4 },
  note: { flexDirection: "row", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceMuted },
  noteText: { ...text.caption, color: colors.textSecondary, flex: 1 },
  toggleCard: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  section: { gap: spacing.md },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { ...text.heading, color: colors.text },
  unitRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  unitName: { ...text.bodyStrong, color: colors.text },
  defaultPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.primarySoft },
  defaultText: { ...text.overline, color: colors.primary },
  smallButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  smallButtonText: { ...text.overline, color: colors.primary },
  removeButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.dangerSoft },
  removeText: { ...text.overline, color: colors.danger },
  suggestion: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: colors.primary },
  suggestionText: { ...text.overline, color: colors.primary },
  addRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: { ...text.body, color: colors.text, flex: 1, minHeight: 44, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, backgroundColor: colors.surface },
  skuRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  skuCode: { minWidth: 136, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  bigPrice: { fontSize: 34, lineHeight: 40, fontWeight: "700", color: colors.text },
  perUnit: { ...text.body, color: colors.textSecondary, fontWeight: "400" },
  divider: { height: 1, backgroundColor: colors.border },
  figures: { flexDirection: "row", gap: spacing.md },
  figure: { flex: 1, gap: 4, alignItems: "flex-start" },
  figureValue: { ...text.bodyStrong, color: colors.text },
  historyRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border, marginTop: 6 },
  dotCurrent: { backgroundColor: colors.primary },
  historyDate: { ...text.bodyStrong, color: colors.text },
  current: { ...text.overline, color: colors.primary },
  scheduled: { ...text.overline, color: colors.warning },
  by: { ...text.overline, color: colors.textMuted },
  historyPercent: { ...text.bodyStrong, color: colors.text },
  marginStrip: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.primarySoft },
  marginStripText: { ...text.bodyStrong, color: colors.primary },
  problem: { ...text.caption, color: colors.danger },
  stockBig: { fontSize: 34, lineHeight: 40, fontWeight: "700" },
  codePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.surfaceMuted },
  codePillText: { ...text.overline, color: colors.textSecondary },
  alertNote: { flexDirection: "row", gap: 6, alignItems: "center", padding: spacing.sm, borderRadius: radii.md, backgroundColor: colors.background },
  fieldLabel: { ...text.label, color: colors.text },
  stepper: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  stepButton: { width: 48, height: 48, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  stepMinus: { backgroundColor: colors.danger },
  stepPlus: { backgroundColor: colors.primary },
  stepField: { flex: 1, height: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  stepInput: { ...text.heading, color: colors.text, flex: 1, minWidth: 0, width: "100%", textAlign: "center" },
  reason: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  reasonOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  reasonText: { ...text.overline, color: colors.text },
  reasonTextOn: { color: colors.onBrand },
  afterRow: { flexDirection: "row", justifyContent: "space-between", padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.background },
  afterValue: { ...text.bodyStrong, color: colors.text },
  activity: { gap: 2 },
  activityTitle: { ...text.bodyStrong, color: colors.text },
  sheetHead: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  sheetIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.dangerSoft, alignItems: "center", justifyContent: "center" },
  sheetIconRestore: { backgroundColor: colors.primarySoft },
  sheetTitle: { ...text.title, color: colors.text },
  sheetBody: { ...text.body, color: colors.textSecondary, marginTop: 4 },
  shadow: { ...shadows.card },
});
