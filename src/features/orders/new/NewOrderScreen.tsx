import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import { Avatar, Banner, BottomSheet, Button, DatePickerField, EmptyState, ErrorState, FormInput, Icon, LoadingState, Pagination, ProductRow, SearchBar, ToggleRow, useToast } from "@/components";
import { colors, radii, shadows, spacing, text } from "@/constants/theme";
import { useAuth, usePermission } from "@/features/auth";
import { PERMISSIONS } from "@/constants/permissions";
import { DataError, queryClient, useRequestId } from "@/services/data";
import { NotQueuedError, PriceChangedError, type PriceChange } from "@/services/offline";
import { PriceReview } from "@/features/sync/PriceReview";
import { formatMoney, fullDateLabel, plural, toISODate } from "@/utils/format";
import { presetCustomerNotice } from "@/features/customers/customersLogic";
import { customerName } from "@/utils/customer";
import { PAGE_SIZE, pageSlice } from "@/utils/pagination";
import { usePage } from "@/utils/usePage";
import { DiscountForm } from "../detail/DiscountForm";
import { discountLabel, salesInvoiceProblem } from "../orderMoney";
import {
  type CatalogData,
  type CustomerOption,
  type DeliveryTimeOption,
  type OrderSourceOption,
  useAddDeliveryTime,
  useAddOrderSource,
  useCreateOrder,
  useCustomerPrices,
  useNewOrderCatalog,
  useOrderLists,
  useOrderToCopy,
  useRemoveDeliveryTime,
  useRemoveOrderSource,
  useSameDayOrder,
  newOrderKeys,
} from "./newOrderData";
import {
  buildCatalog,
  buildPayload,
  cleanQuantityInput,
  type DeliveryTime,
  deliveryTimeProblem,
  deliveryTimeText,
  type DraftDiscount,
  type DraftLine,
  estimate,
  formatQuantityText,
  priceLines,
  priceProblem,
  seenPrices,
  stepQuantity,
  stockTag,
  outOfStockProblem,
  stockWarning,
} from "./newOrderLogic";
import { clearNewOrderDraft, keepNewOrderDraft, readNewOrderDraft } from "./newOrderDraft";
import { ManageSourcesSheet, ManageTimesSheet, TimeBox, TimeSheet, UnitSheet } from "./sheets";

type Step = 1 | 2 | 3;
const errorText = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong. Try again.");

/**
 * Figma "New order" (task 4.1 to 4.3): choose the customer, add products, then
 * delivery and review. Saving is one server call with a request id, so a
 * retry after a lost connection returns the same order instead of a second one.
 *
 * Provisional stock rules (until D-S1 to D-S3): products can be ordered above
 * the stock on hand, or when out of stock, with a warning; nothing is reserved
 * or deducted; every new order is saved For verification.
 */
type Initial = {
  step: Step; customer: CustomerOption | null; lines: DraftLine[]; sourceId: string | null; notes: string; notice?: string | null;
  // Restored from a kept draft (prototype).
  date?: string | null; time?: DeliveryTime; salesInvoice?: string; needsChecking?: boolean; checkingNote?: string; discount?: DraftDiscount | null;
};

/** Loads what the form needs, then starts it from a customer or a copied order. */
export function NewOrderScreen({ customerId, duplicateOrderId }: { customerId?: string; duplicateOrderId?: string }) {
  const catalogQuery = useNewOrderCatalog();
  const listsQuery = useOrderLists();
  const copyQuery = useOrderToCopy(duplicateOrderId);
  const isAgain = Boolean(duplicateOrderId);
  const loading = catalogQuery.isPending || listsQuery.isPending || (isAgain && copyQuery.isPending);
  const failed = catalogQuery.isError || listsQuery.isError || (isAgain && copyQuery.isError);

  if (loading || failed || !catalogQuery.data || !listsQuery.data) {
    return (
      <View style={styles.page}>
        <WizardHeader step={1} title={isAgain ? "Order again" : "New order"} closing onBack={leave} />
        <View style={styles.content}>
          {failed ? (
            <ErrorState description="We couldn’t load customers and products. Check your connection and try again." onRetry={() => { void catalogQuery.refetch(); void listsQuery.refetch(); void copyQuery.refetch(); }} />
          ) : <LoadingState message="Loading customers and products..." />}
        </View>
      </View>
    );
  }

  let initial: Initial = { step: 1, customer: null, lines: [], sourceId: null, notes: "" };
  const copy = copyQuery.data;
  if (isAgain && copy) {
    const sources = listsQuery.data.sources;
    initial = {
      step: 3,
      customer: copy.customers,
      notes: copy.notes ?? "",
      sourceId: (sources.find((item) => item.id === copy.order_source_id) ?? sources.find((item) => item.code === copy.order_source))?.id ?? null,
      lines: copy.order_items.map((item) => ({
        productId: item.product_id,
        unitKey: item.product_sku_id ?? "base",
        quantityText: formatQuantityText(Number(item.quantity)),
        varietyId: item.variety_id,
        notes: item.notes,
      })),
    };
    // An archived customer can't take new orders: keep the items and ask for a customer.
    if (copy.customers && !catalogQuery.data.customers.some((item) => item.id === copy.customers?.id)) {
      initial = { ...initial, step: 1, customer: null, notice: `${customerName(copy.customers)} is archived, so they can’t be picked for a new order. Choose a customer for these items, or restore them on the Customers screen first.` };
    }
  } else if (!customerId && readNewOrderDraft()) {
    // Prototype: New order reopens the order that was closed without saving.
    const kept = readNewOrderDraft()!;
    const products = new Set(catalogQuery.data.products.map((item) => item.id));
    initial = {
      step: kept.step,
      customer: catalogQuery.data.customers.find((item) => item.id === kept.customerId) ?? null,
      lines: (kept.lines as DraftLine[]).filter((line) => products.has(line.productId)),
      sourceId: kept.sourceId,
      notes: kept.notes,
      date: kept.date,
      time: kept.time as DeliveryTime,
      salesInvoice: kept.salesInvoice,
      needsChecking: kept.needsChecking,
      checkingNote: kept.checkingNote,
      discount: kept.discount as DraftDiscount | null,
    };
    if (!initial.customer) initial = { ...initial, step: 1 };
  } else if (customerId) {
    const preset = catalogQuery.data.customers.find((item) => item.id === customerId);
    if (preset) initial = { ...initial, step: 2, customer: preset };
    else initial = { ...initial, notice: presetCustomerNotice(customerId, catalogQuery.data.customers.map((item) => item.id)) };
  }
  return <NewOrderForm data={catalogQuery.data} lists={listsQuery.data} initial={initial} duplicateOrderId={duplicateOrderId} />;
}

function leave() {
  if (router.canGoBack()) router.back(); else router.navigate("/orders");
}

function WizardHeader({ step, title, closing, onBack }: { step: Step; title: string; closing: boolean; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
      <View style={styles.headerRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={closing ? "Close" : "Back"} hitSlop={4} onPress={onBack} style={({ pressed }) => [styles.round, pressed && styles.pressed]}>
          {/* Figma shows the back arrow on every step; on step 1 it closes the wizard. */}
          <Icon name="arrow-left" size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">{title}</Text>
        <View style={styles.stepPill}><Text style={styles.stepPillText}>{step} of 3</Text></View>
      </View>
      <View style={styles.bars} accessibilityLabel={`Step ${step} of 3`}>
        {[1, 2, 3].map((value) => <View key={value} style={[styles.bar, value <= step && styles.barDone]} />)}
      </View>
    </View>
  );
}

function NewOrderForm({ data, lists, initial, duplicateOrderId }: { data: CatalogData; lists: { sources: OrderSourceOption[]; times: DeliveryTimeOption[] }; initial: Initial; duplicateOrderId?: string }) {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const isAdministrator = useAuth().profile?.role === "administrator";
  // Prototype: anyone who takes orders may type a different line price.
  const canChangePrice = usePermission(PERMISSIONS.manageOrders);
  const isAgain = Boolean(duplicateOrderId);

  const [step, setStep] = useState<Step>(initial.step);
  const [customer, setCustomer] = useState<CustomerOption | null>(initial.customer);
  const [lines, setLines] = useState<DraftLine[]>(initial.lines);
  const [date, setDate] = useState<string | null>(initial.date ?? null);
  const [time, setTime] = useState<DeliveryTime>(initial.time ?? { start: null, end: null, slotId: null });
  const [sourceId, setSourceId] = useState<string | null>(initial.sourceId);
  const [notes, setNotes] = useState(initial.notes);
  const [salesInvoice, setSalesInvoice] = useState(initial.salesInvoice ?? "");
  const [needsChecking, setNeedsChecking] = useState(initial.needsChecking ?? false);
  const [checkingNote, setCheckingNote] = useState(initial.checkingNote ?? "");
  const [discount, setDiscount] = useState<DraftDiscount | null>(initial.discount ?? null);
  const saved = useRef(false);

  // Keep the draft while the form changes, so closing it loses nothing (prototype).
  useEffect(() => {
    if (isAgain || saved.current) return;
    keepNewOrderDraft({ step, customerId: customer?.id ?? null, lines, date, time, sourceId, notes, salesInvoice, needsChecking, checkingNote, discount });
  }, [isAgain, step, customer, lines, date, time, sourceId, notes, salesInvoice, needsChecking, checkingNote, discount]);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [productQuery, setProductQuery] = useState("");
  // Prototype: 15 products per page; a new search starts at page 1.
  const [productPage, setProductPage] = usePage(productQuery.trim());
  const scroller = useRef<ScrollViewInstance>(null);
  const goToProducts = (next: number) => { setProductPage(next); scroller.current?.scrollTo({ y: 0, animated: false }); };
  const [unitFor, setUnitFor] = useState<string | null>(null);
  const [timeFor, setTimeFor] = useState<"start" | "end" | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [manage, setManage] = useState<"sources" | "times" | null>(null);
  const [manageError, setManageError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [priceReview, setPriceReview] = useState<PriceChange[] | null>(null);

  const customerPrices = useCustomerPrices(customer?.id ?? null);
  const sameDay = useSameDayOrder(customer?.id ?? null, date);
  const create = useCreateOrder();
  const request = useRequestId();
  const addSource = useAddOrderSource();
  const removeSource = useRemoveOrderSource();
  const addTime = useAddDeliveryTime();
  const removeTime = useRemoveDeliveryTime();

  const catalog = useMemo(
    () => buildCatalog(data.products, data.listPrices, customer ? customerPrices.data ?? [] : [], data.availability, undefined, new Set(data.outOfStockSkus ?? [])),
    [data, customer, customerPrices.data],
  );
  const productTerm = productQuery.trim().toLowerCase();
  const matchingProducts = catalog.filter((item) => item.name.toLowerCase().includes(productTerm));
  // Kept fresh after an administrator edits the lists.
  const liveLists = useOrderLists().data ?? lists;
  const sources = liveLists.sources;
  const times = liveLists.times;

  const priced = useMemo(() => priceLines(lines, catalog), [lines, catalog]);
  const money = estimate(priced, discount);
  const warning = stockWarning(priced);
  const timeProblem = deliveryTimeProblem(time);
  const invoiceProblem = salesInvoiceProblem(salesInvoice);
  const priceIssue = outOfStockProblem(priced) ?? priced.map(priceProblem).find(Boolean) ?? null;
  const discountTooBig = discount?.type === "fixed" && discount.value > money.subtotal;

  const missing =
    !date ? "Choose a delivery date"
      : !sourceId ? "Choose where the order came from"
        : timeProblem ?? invoiceProblem ?? priceIssue
          ?? (needsChecking && !checkingNote.trim() ? "Say what needs checking" : null)
          ?? (discountTooBig ? "The discount is more than the new subtotal. Edit or remove it." : null)
          ?? (priced.length ? null : "Add at least one product");

  function updateLine(productId: string, change: Partial<DraftLine> | null) {
    setLines((current) => {
      if (change === null) return current.filter((line) => line.productId !== productId);
      const existing = current.find((line) => line.productId === productId);
      if (!existing) return [...current, { productId, unitKey: "base", quantityText: "1", ...change }];
      const next = { ...existing, ...change };
      if (!next.quantityText) return current.filter((line) => line.productId !== productId);
      return current.map((line) => (line.productId === productId ? next : line));
    });
  }

  function back() {
    if (step === 1 || (isAgain && step === 3)) leave();
    else setStep((step - 1) as Step);
  }

  function save(acceptCurrentPrices = false) {
    if (!customer || !date || !sourceId || missing || create.isPending) return;
    const payload = buildPayload({ customerId: customer.id, date, sourceId, time, notes, salesInvoice, needsChecking, checkingNote, discount }, priced);
    setSaveError(null);
    create.mutate(
      // Same details, same request id: a retry returns the first order.
      {
        payload,
        sourceOrderId: duplicateOrderId,
        requestId: request.idFor(JSON.stringify([payload, duplicateOrderId ?? null])),
        seenPrices: seenPrices(priced),
        label: `New order · ${customerName(customer) ?? "customer"} · ${formatMoney(money.total)}`,
        acceptCurrentPrices,
      },
      {
        onSuccess: (result) => {
          saved.current = true;
          clearNewOrderDraft();
          request.reset();
          setPriceReview(null);
          if (result.queued) {
            toast({ title: "Order saved offline", message: `It will be ${needsChecking ? "sent for verification" : "confirmed and sent to Purchasing"} when you’re back online. If a price changes by then, you’ll be asked to review it.` });
            router.replace("/orders");
            return;
          }
          // Prototype: an order that isn't flagged is confirmed as it is saved.
          toast(result.order.status === "confirmed"
            ? { title: `${result.order.order_number} confirmed and sent to Purchasing`, message: `Total ${formatMoney(Number(result.order.total))}` }
            : { title: `${result.order.order_number} saved for verification`, message: `Total ${formatMoney(Number(result.order.total))}` });
          router.replace({ pathname: "/orders/[id]", params: { id: result.order.order_id } });
        },
        onError: (error) => {
          if (error instanceof NotQueuedError) return;
          if (error instanceof PriceChangedError) {
            setPriceReview(error.changes);
            // Show today's prices on the form too.
            void queryClient.invalidateQueries({ queryKey: newOrderKeys.base });
            return;
          }
          const lost = !(error instanceof DataError) || !error.code;
          setSaveError(lost ? "Couldn’t reach the server. Your order was not saved twice: tap Save again to retry." : errorText(error));
        },
      },
    );
  }

  function manageAction<T>(run: Promise<T>, done?: () => void) {
    setManageError(null);
    run.then(() => done?.()).catch((error: unknown) => setManageError(errorText(error)));
  }

  return (
    <View style={styles.page}>
      <WizardHeader step={step} title={isAgain ? "Order again" : "New order"} closing={step === 1 || (isAgain && step === 3)} onBack={back} />

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView ref={scroller} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {step === 1 ? (
            <>
              {initial.notice && !customer ? (
                <View style={styles.notice} accessibilityRole="alert">
                  <Icon name="alert-circle" size={18} color={colors.warning} />
                  <Text style={styles.noticeText}>{initial.notice}</Text>
                </View>
              ) : null}
              <Text style={styles.question}>Who is this order for?</Text>
              <SearchBar value={customerQuery} onChangeText={setCustomerQuery} placeholder="Search customers" />
              {data.customers
                .filter((item) => `${customerName(item)} ${item.brand_name ?? ""} ${item.customer_code} ${item.contact_person ?? ""}`.toLowerCase().includes(customerQuery.trim().toLowerCase()))
                .map((item) => {
                  const selected = customer?.id === item.id;
                  return (
                    <Pressable
                      key={item.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => { if (customer?.id !== item.id) { setCustomer(item); setDiscount(null); } }}
                      style={({ pressed }) => [styles.customer, selected && styles.customerSelected, pressed && styles.pressed]}
                    >
                      <Avatar name={customerName(item) ?? ""} />
                      <View style={styles.flex}>
                        <Text style={styles.customerName}>{customerName(item)}</Text>
                        <Text style={styles.caption}>{item.customer_code}{item.contact_person ? ` · ${item.contact_person}` : ""}</Text>
                      </View>
                      {selected ? <Icon name="check-circle" size={22} color={colors.primary} /> : <Icon name="chevron-right" size={20} color={colors.textMuted} />}
                    </Pressable>
                  );
                })}
              {data.customers.length === 0 ? <EmptyState icon="people-outline" title="No customers yet" description="Add a customer before taking an order." /> : null}
            </>
          ) : step === 2 ? (
            <>
              {/* Figma and prototype: step 2 is headed by the customer's name. */}
              <Text style={styles.question} accessibilityRole="header">{customerName(customer)}</Text>
              <SearchBar value={productQuery} onChangeText={setProductQuery} placeholder="Search products" />
              {data.stockLookupFailed ? (
                <View style={styles.stockNotice}>
                  <Banner tone="warning" icon="alert-circle">Stock unavailable: we couldn’t check stock just now. Products can still be added, and stock is checked again when you save.</Banner>
                  <Button label="Retry" type="secondary" size="md" icon="refresh" onPress={() => void queryClient.invalidateQueries({ queryKey: newOrderKeys.catalog() })} />
                </View>
              ) : null}
              {catalog.length === 0 ? <EmptyState icon="leaf-outline" title="No products yet" description="Add products and prices before creating orders." /> : null}
              {pageSlice(matchingProducts, productPage, PAGE_SIZE)
                .map((item) => {
                  const line = lines.find((entry) => entry.productId === item.id);
                  // Not added yet: offer the first unit that can be ordered (Jac, 8 Nov: out of stock can't be added).
                  const unit = item.units.find((option) => option.key === line?.unitKey) ?? item.units.find((option) => !option.outOfStock) ?? item.units[0];
                  const pricedLine = priced.find((entry) => entry.item.id === item.id);
                  const tag = unit ? stockTag(unit) : undefined;
                  return (
                    <View key={item.id} style={styles.productBlock}>
                      <ProductRow
                        name={item.name}
                        priceLabel={unit ? `${formatMoney(unit.price)} / ${unit.unit}` : "No price yet"}
                        stock={tag}
                        // Prototype rule (Jac, 8 Nov): out of stock stays visible but can't be added; low stock can.
                        state={line ? "added" : !unit || unit.outOfStock ? "unavailable" : "default"}
                        onAdd={() => updateLine(item.id, { unitKey: unit?.key ?? "base", quantityText: "1" })}
                        quantity={line?.quantityText}
                        onQuantityChange={(value) => setLines((current) => current.map((entry) => (entry.productId === item.id ? { ...entry, quantityText: cleanQuantityInput(value) } : entry)))}
                        onDecrease={() => updateLine(item.id, { quantityText: stepQuantity(line?.quantityText ?? "", -1) })}
                        onIncrease={() => updateLine(item.id, { quantityText: stepQuantity(line?.quantityText ?? "", 1) })}
                        unit={unit?.unit}
                        onUnitPress={item.units.length > 1 ? () => setUnitFor(item.id) : undefined}
                        unitPrice={line?.priceText ?? (unit ? unit.price.toFixed(2) : "")}
                        // Order-takers may change a line price; the reason is optional.
                        onUnitPriceChange={canChangePrice ? (value) => updateLine(item.id, { priceText: value.replace(/[^0-9.]/g, "") }) : undefined}
                      />
                      {line && pricedLine?.outOfStock ? (
                        <View style={styles.rowWarning}>
                          <Icon name="alert-circle" size={14} color={colors.danger} />
                          <Text style={[styles.rowWarningText, styles.rowErrorText]}>Out of stock. Remove it to continue.</Text>
                        </View>
                      ) : line && pricedLine?.overStock ? (
                        <View style={styles.rowWarning}>
                          <Icon name="alert-circle" size={14} color={colors.warning} />
                          <Text style={styles.rowWarningText}>More than the stock on hand. It can still be ordered.</Text>
                        </View>
                      ) : null}
                      {pricedLine?.special ? (
                        <FormInput
                          label={`Reason for the new price, optional (${formatMoney(pricedLine.unit.price)} → ${formatMoney(pricedLine.unitPrice)})`}
                          value={line?.priceReason ?? ""}
                          onChangeText={(value) => updateLine(item.id, { priceReason: value })}
                          placeholder="e.g. Agreed with customer"
                          maxLength={200}
                          error={priceProblem(pricedLine) ?? undefined}
                        />
                      ) : null}
                    </View>
                  );
                })}
              <Pagination page={productPage} total={matchingProducts.length} pageSize={PAGE_SIZE} onChange={goToProducts} label="products" />
            </>
          ) : (
            <>
              <Text style={styles.question}>Delivery & review</Text>
              <DatePickerField label="Delivery date" value={date} onChange={setDate} minDate={toISODate(new Date())} />
              {sameDay.data && date ? (
                <View style={styles.notice}>
                  <Icon name="alert-circle" size={18} color={colors.warning} />
                  <Text style={styles.noticeText}><Text style={styles.noticeStrong}>Possible duplicate. </Text>{customerName(customer)} already has {sameDay.data} for {fullDateLabel(date)}. Save only if this is a separate order.</Text>
                </View>
              ) : null}

              <View style={styles.field}>
                <View style={styles.fieldHead}>
                  <Text style={styles.fieldLabel}>Delivery time <Text style={styles.optional}>(optional)</Text></Text>
                  {isAdministrator ? <EditLink label="Edit delivery times" onPress={() => { setManageError(null); setManage("times"); }} /> : null}
                </View>
                <View style={styles.timeRow}>
                  <TimeBox label="Start with" value={time.start} onPress={() => setTimeFor("start")} />
                  <TimeBox label="End with (optional)" value={time.end} onPress={() => setTimeFor("end")} error={Boolean(timeProblem)} />
                </View>
                {times.length ? (
                  <View style={styles.wrap}>
                    {times.map((slot: DeliveryTimeOption) => {
                      const selected = time.slotId === slot.id;
                      return (
                        <Pressable key={slot.id} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => setTime(selected ? { start: null, end: null, slotId: null } : { start: slot.starts_at?.slice(0, 5) ?? null, end: slot.ends_at?.slice(0, 5) ?? null, slotId: slot.id })} style={[styles.slot, selected && styles.slotSelected]}>
                          <Text style={[styles.slotLabel, selected && styles.slotLabelSelected]}>{slot.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
                {timeProblem ? <Text style={styles.errorText}>{timeProblem}</Text> : null}
              </View>

              <View style={styles.field}>
                <View style={styles.fieldHead}>
                  <Text style={styles.fieldLabel}>Order came from</Text>
                  {isAdministrator ? <EditLink label="Edit order sources" onPress={() => { setManageError(null); setManage("sources"); }} /> : null}
                </View>
                <SourcePicker sources={sources} value={sourceId} open={sourceOpen} onToggle={() => setSourceOpen((open) => !open)} onChange={(id) => { setSourceId(id); setSourceOpen(false); }} />
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Notes for the team <Text style={styles.optional}>(optional)</Text></Text>
                <TextInput value={notes} onChangeText={setNotes} placeholder="e.g. Deliver to back entrance" placeholderTextColor={colors.textMuted} multiline accessibilityLabel="Notes for the team" style={styles.textarea} />
              </View>

              <FormInput label="Attached SI# (optional)" accessibilityLabel="Sales invoice number" icon="receipt" value={salesInvoice} onChangeText={setSalesInvoice} placeholder="e.g. SI-00123" autoCapitalize="characters" autoCorrect={false} maxLength={40} error={salesInvoice.trim() ? invoiceProblem ?? undefined : undefined} />

              <ToggleRow label="Needs checking" description="Flag if anything is unclear" value={needsChecking} onChange={setNeedsChecking} />
              {needsChecking ? <FormInput label="What needs checking?" value={checkingNote} onChangeText={setCheckingNote} placeholder="e.g. Confirm onion quantity" /> : null}

              {warning ? (
                <View style={styles.notice} accessibilityRole="alert">
                  <Icon name="package" size={18} color={colors.warning} />
                  <Text style={styles.noticeText}>{warning}</Text>
                </View>
              ) : null}

              <View style={styles.review}>
                <View style={styles.reviewHead}>
                  <Text style={styles.reviewTitle}>{customerName(customer)}</Text>
                  <Pressable accessibilityRole="button" onPress={() => setStep(2)} hitSlop={8} style={styles.editLink}>
                    <Icon name="edit" size={14} color={colors.primary} />
                    <Text style={styles.link}>Edit items</Text>
                  </Pressable>
                </View>
                <View style={styles.reviewLine}>
                  <Text style={styles.subtotalLabel}>Delivery</Text>
                  <Text style={styles.reviewMeta}>{date ? fullDateLabel(date) : "Date not chosen"} · {deliveryTimeText(time.start, time.end)}</Text>
                </View>
                {priced.map((line) => (
                  <View key={line.item.id} style={styles.reviewLine}>
                    <Text style={styles.reviewLabel}>{line.item.name} · {formatQuantityText(line.quantity)} {line.unit.unit} @ {formatMoney(line.unitPrice)}</Text>
                    <Text style={styles.reviewValue}>{formatMoney(line.amountCents / 100)}</Text>
                  </View>
                ))}
                <View style={styles.reviewLine}>
                  <Text style={styles.subtotalLabel}>Subtotal</Text>
                  <Text style={styles.reviewValue}>{formatMoney(money.subtotal)}</Text>
                </View>
                {discountOpen ? (
                  <DiscountForm
                    subtotal={money.subtotal}
                    initial={discount}
                    busy={false}
                    onCancel={() => setDiscountOpen(false)}
                    onApply={(next) => { setDiscount(next); setDiscountOpen(false); }}
                  />
                ) : discount ? (
                  <View style={styles.discount}>
                    <View style={styles.reviewLine}>
                      <Text style={styles.discountLabel}>Discount · {discountLabel(discount.type, discount.value, formatMoney)}</Text>
                      <Text style={styles.discountValue}>-{formatMoney(money.discount)}</Text>
                    </View>
                    <Text style={styles.caption}>Reason: {discount.reason}</Text>
                    <View style={styles.discountActions}>
                      <Pressable accessibilityRole="button" accessibilityLabel="Edit discount" onPress={() => setDiscountOpen(true)} hitSlop={8}><Text style={styles.link}>Edit</Text></Pressable>
                      <Pressable accessibilityRole="button" accessibilityLabel="Remove discount" onPress={() => setDiscount(null)} hitSlop={8}><Text style={styles.removeLink}>Remove</Text></Pressable>
                    </View>
                  </View>
                ) : (
                  <Pressable accessibilityRole="button" onPress={() => setDiscountOpen(true)} style={({ pressed }) => [styles.addDiscount, pressed && styles.pressed]}>
                    <Icon name="tag" size={16} color={colors.primary} />
                    <Text style={styles.link}>Add Discount</Text>
                  </Pressable>
                )}
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Estimated total</Text>
                  <Text style={styles.totalValue}>{formatMoney(money.total)}</Text>
                </View>
                <Text style={styles.hint}>The server prices the order again when it is saved. {needsChecking ? "Flagged orders are saved For verification." : "The order is confirmed and sent to Purchasing when you save it."}</Text>
              </View>
              {saveError ? (
                <View style={[styles.notice, styles.errorNotice]} accessibilityRole="alert">
                  <Icon name="alert-circle" size={18} color={colors.danger} />
                  <Text style={styles.noticeText}>{saveError}</Text>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>

        {(
          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 8) + 8 }]}>
            {step === 2 ? (
              <View style={styles.footerSummary}>
                <Text style={styles.caption}>{plural(priced.length, "item")}</Text>
                <Text style={styles.footerTotal}>{formatMoney(money.subtotal)}</Text>
              </View>
            ) : null}
            {step === 3 && missing && !saveError ? <Text style={styles.missing}>{missing}</Text> : null}
            <Button
              label={step === 3 ? (needsChecking ? "Save for verification" : "Confirm order") : "Continue"}
              size="lg"
              style={styles.footerButton}
              loading={create.isPending}
              disabled={step === 1 ? !customer : step === 2 ? !priced.length || Boolean(priceIssue) : Boolean(missing)}
              onPress={() => (step === 3 ? save() : setStep((step + 1) as Step))}
            />
          </View>
        )}
      </KeyboardAvoidingView>

      <BottomSheet visible={priceReview !== null} onClose={() => setPriceReview(null)}>
        {priceReview ? (
          <PriceReview changes={priceReview} busy={create.isPending} onAccept={() => save(true)} onBack={() => setPriceReview(null)} />
        ) : null}
      </BottomSheet>
      {unitFor ? (
        <UnitSheet
          visible
          product={catalog.find((item) => item.id === unitFor)?.name ?? ""}
          units={catalog.find((item) => item.id === unitFor)?.units ?? []}
          selected={lines.find((line) => line.productId === unitFor)?.unitKey ?? "base"}
          onSelect={(key) => { updateLine(unitFor, { unitKey: key, priceText: undefined, priceReason: undefined }); setUnitFor(null); }}
          onClose={() => setUnitFor(null)}
        />
      ) : null}
      <TimeSheet
        visible={timeFor !== null}
        initial={timeFor === "end" ? time.end ?? time.start : time.start}
        onClose={() => setTimeFor(null)}
        onClear={() => { setTime((current) => (timeFor === "start" ? { start: null, end: null, slotId: null } : { ...current, end: null, slotId: null })); setTimeFor(null); }}
        onDone={(value) => { setTime((current) => ({ ...current, [timeFor === "end" ? "end" : "start"]: value, slotId: null })); setTimeFor(null); }}
      />
      <ManageSourcesSheet
        visible={manage === "sources"}
        sources={sources}
        busy={addSource.isPending || removeSource.isPending}
        error={manageError}
        onAdd={(label, done) => manageAction(addSource.mutateAsync(label), done)}
        onRemove={(source: OrderSourceOption) => manageAction(removeSource.mutateAsync(source.id), () => { if (sourceId === source.id) setSourceId(null); })}
        onClose={() => setManage(null)}
      />
      <ManageTimesSheet
        visible={manage === "times"}
        times={times}
        busy={addTime.isPending || removeTime.isPending}
        error={manageError}
        onAdd={(start, end, done) => manageAction(addTime.mutateAsync({ start, end }), done)}
        onRemove={(slot) => manageAction(removeTime.mutateAsync(slot.id), () => { if (time.slotId === slot.id) setTime((current) => ({ ...current, slotId: null })); })}
        onClose={() => setManage(null)}
      />
    </View>
  );
}

function EditLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.editChip, pressed && styles.pressed]}>
      <Icon name="edit" size={13} color={colors.primary} />
      <Text style={styles.editChipText}>Edit</Text>
    </Pressable>
  );
}

/** Figma "Order came from" dropdown. */
function SourcePicker({ sources, value, open, onToggle, onChange }: { sources: OrderSourceOption[]; value: string | null; open: boolean; onToggle: () => void; onChange: (id: string) => void }) {
  const selected = sources.find((source) => source.id === value);
  return (
    <View style={styles.dropdownWrap}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Order came from: ${selected?.label ?? "not chosen"}`} accessibilityState={{ expanded: open }} onPress={onToggle} style={({ pressed }) => [styles.dropdown, selected && styles.dropdownSet, pressed && styles.pressed]}>
        <Icon name="message" size={20} color={selected ? colors.primary : colors.textSecondary} />
        <Text style={[styles.dropdownText, !selected && styles.placeholder]}>{selected?.label ?? "Choose source"}</Text>
        <Icon name="chevron-down" size={16} color={colors.textSecondary} />
      </Pressable>
      {open ? (
        <View style={styles.menu} accessibilityRole="menu">
          {sources.map((source) => {
            const active = source.id === value;
            return (
              <Pressable key={source.id} accessibilityRole="menuitem" accessibilityState={{ selected: active }} onPress={() => onChange(source.id)} style={({ pressed }) => [styles.menuItem, active && styles.menuItemActive, pressed && styles.pressed]}>
                <Text style={[styles.menuLabel, active && styles.menuLabelActive]}>{source.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stockNotice: { gap: spacing.sm },
  page: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  header: { backgroundColor: colors.background, paddingHorizontal: spacing.lg, paddingBottom: 10, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  round: { width: 40, height: 40, borderRadius: radii.full, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", ...shadows.card },
  headerTitle: { ...text.title, flex: 1, textAlign: "center", color: colors.text },
  stepPill: { minWidth: 40, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radii.pill, backgroundColor: colors.primarySoft },
  stepPillText: { ...text.captionStrong, color: colors.primary, textAlign: "center" },
  bars: { flexDirection: "row", gap: 6 },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.track },
  barDone: { backgroundColor: colors.primary },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: 14 },
  question: { ...text.title, color: colors.text },
  caption: { ...text.caption, color: colors.textSecondary },
  customer: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, ...shadows.card },
  customerSelected: { borderColor: colors.primary, borderWidth: 1.5, backgroundColor: colors.surfacePressed },
  customerName: { ...text.bodyStrong, color: colors.text },
  productBlock: { gap: 6 },
  rowWarning: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
  rowWarningText: { ...text.caption, color: colors.warning, flex: 1 },
  rowErrorText: { color: colors.danger },
  field: { gap: 8 },
  fieldHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fieldLabel: { ...text.captionStrong, color: colors.textSecondary },
  optional: { fontFamily: text.caption.fontFamily, color: colors.textMuted },
  editChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radii.sm, backgroundColor: colors.primarySoft },
  editChipText: { ...text.captionStrong, color: colors.primary },
  timeRow: { flexDirection: "row", gap: 10 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  slot: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  slotSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  slotLabel: { ...text.captionStrong, color: colors.textSecondary },
  slotLabelSelected: { color: colors.primary },
  errorText: { ...text.caption, color: colors.danger },
  // Figma: the source picker is half width, lined up with "Start with".
  dropdownWrap: { gap: 4, width: "48%", minWidth: 170 },
  dropdown: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  dropdownSet: { borderColor: colors.primaryMuted },
  dropdownText: { ...text.body, flex: 1, color: colors.text },
  placeholder: { color: colors.textMuted },
  menu: { borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 4, ...shadows.card },
  menuItem: { minHeight: 40, justifyContent: "center", alignItems: "center", borderRadius: radii.sm },
  menuItemActive: { backgroundColor: colors.primary },
  menuLabel: { ...text.body, color: colors.textSecondary },
  menuLabelActive: { color: colors.onBrand, fontFamily: text.label.fontFamily },
  textarea: { ...text.body, minHeight: 80, padding: 14, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, textAlignVertical: "top" },
  notice: { flexDirection: "row", gap: 10, padding: 12, borderRadius: radii.md, backgroundColor: colors.warningSoft, borderWidth: 1, borderColor: colors.warningBorder },
  errorNotice: { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
  noticeText: { ...text.caption, flex: 1, color: colors.text },
  noticeStrong: { fontFamily: text.captionStrong.fontFamily, color: colors.warning },
  review: { gap: 10, padding: 16, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, ...shadows.card },
  reviewHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.border },
  reviewTitle: { ...text.heading, flex: 1, color: colors.text },
  editLink: { flexDirection: "row", alignItems: "center", gap: 4 },
  link: { ...text.captionStrong, color: colors.primary },
  removeLink: { ...text.captionStrong, color: colors.danger },
  reviewLine: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  reviewLabel: { ...text.body, flex: 1, color: colors.text },
  reviewValue: { ...text.label, color: colors.text },
  reviewMeta: { ...text.caption, flex: 1, textAlign: "right", color: colors.textSecondary },
  subtotalLabel: { ...text.body, color: colors.textSecondary },
  addDiscount: { minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.primaryMuted, backgroundColor: colors.primarySoft },
  discount: { gap: 4 },
  discountLabel: { ...text.label, color: colors.danger, flex: 1 },
  discountValue: { ...text.label, color: colors.danger },
  discountActions: { flexDirection: "row", gap: 16 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  totalLabel: { ...text.bodyStrong, color: colors.text },
  totalValue: { ...text.title, color: colors.text },
  hint: { ...text.caption, color: colors.textMuted },
  footer: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, paddingHorizontal: spacing.lg, paddingTop: 12, backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  footerSummary: { gap: 2 },
  footerTotal: { ...text.title, color: colors.text },
  footerButton: { flex: 1 },
  missing: { ...text.caption, width: "100%", color: colors.textSecondary, textAlign: "center" },
});
