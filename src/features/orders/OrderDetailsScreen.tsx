import { useCallback, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";

import { Button, Card, EmptyState, ErrorState, Icon, type IconName, LoadingState, StaleNotice, useToast } from "@/components";
import { PERMISSIONS } from "@/constants/permissions";
import { colors, radii, spacing, text } from "@/constants/theme";
import { useAuth, usePermission } from "@/features/auth";
import { useReceipt } from "@/features/deliveries/deliveriesData";
import { RECEIPT_STATUSES, canCompleteDelivery, receiptNumber } from "@/features/deliveries/deliveriesLogic";
import { DeliverSheet, useMarkDelivered } from "@/features/deliveries/shared";
import { useRequestId } from "@/services/data";
import { NotQueuedError, useIsOnline, useQueuedChange } from "@/services/offline";
import { dayLabel, formatMoney, formatTime, plural, relativeTime } from "@/utils/format";
import { callPhone, openDirections } from "@/utils/links";
import { customerName as displayName } from "@/utils/customer";
import { DiscountForm } from "./detail/DiscountForm";
import { nextStepFor, orderEditing, type NextAction } from "./detail/nextStep";
import { deliveryTimeText } from "./new/newOrderLogic";
import {
  ActivityCard,
  AddDiscountButton,
  AttentionBanner,
  CancelledBanner,
  DetailHeader,
  DiscountRow,
  InfoRow,
  ItemLines,
  OrderSummary,
  ProgressCard,
  SalesInvoiceCard,
  DeliveryReceiptCard,
  SectionCard,
  SubtotalRow,
  TextLink,
  TotalRow,
} from "./detail/sections";
import { ActionsSheet, CancelSheet, FlagSheet, RemoveDiscountSheet, SalesInvoiceSheet, type SheetAction } from "./detail/sheets";
import { discountLabel, type DiscountType } from "./orderMoney";
import { type OrderActivity, type OrderDetail, useApplyDiscount, useOrderDetail, useRemoveDiscount, useSetAttention, useConfirmOrder, useSetSalesInvoice, useTransitionOrder } from "./ordersData";
import { SOURCE_LABELS, describeActivity, isFlagged } from "./status";


type Sheet = "actions" | "flag" | "cancel" | "invoice" | "removeDiscount" | null;
type Person = { full_name: string | null; email: string } | null;
const personName = (person: Person) => person?.full_name ?? person?.email ?? "MEAH staff";

function activityIcon(action: string): IconName {
  if (action.startsWith("created")) return "message";
  if (action.startsWith("discount")) return "tag";
  if (action === "sales_invoice_set") return "receipt";
  if (action === "requires_attention" || action === "attention_cleared") return "flag";
  if (action === "order_edited") return "edit";
  if (action === "removed_item_confirmed") return "package";
  if (action === "cancelled") return "x-circle";
  if (action.startsWith("delivery")) return "car";
  if (action.startsWith("preparation")) return "package";
  return "check-circle";
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong. Try again.");

/** Figma "Order detail" (DR-1048, 1047, 1046, 1045, 1043): one layout, sections change with the status. */
export function OrderDetailsScreen({ orderId }: { orderId?: string }) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const me = useAuth().profile;
  const role = me?.role;
  const can = {
    manage: usePermission(PERMISSIONS.manageOrders),
    prepare: usePermission(PERMISSIONS.manageFulfillment),
    viewPurchasing: usePermission(PERMISSIONS.viewFulfillment),
    manageDeliveries: usePermission(PERMISSIONS.manageDeliveries),
    viewDeliveries: usePermission(PERMISSIONS.viewDeliveries),
  };
  const isAdministrator = role === "administrator";
  const detail = useOrderDetail(orderId);
  const receipt = useReceipt(orderId ?? "");
  const { refetch } = detail;
  const [sheet, setSheet] = useState<Sheet>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [confirmingDelivery, setConfirmingDelivery] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const markDelivered = useMarkDelivered();
  const [refreshing, setRefreshing] = useState(false);
  const transition = useTransitionOrder();
  const attention = useSetAttention();
  const applyDiscount = useApplyDiscount();
  const removeDiscount = useRemoveDiscount();
  const setInvoice = useSetSalesInvoice();
  const discountRequest = useRequestId();
  const removeRequest = useRequestId();
  const invoiceRequest = useRequestId();

  const confirm = useConfirmOrder();
  const online = useIsOnline();
  const queuedOrder = useQueuedChange(orderId);
  const queuedDelivery = useQueuedChange(detail.data?.deliveries?.[0]?.id);

  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));

  const back = () => (router.canGoBack() ? router.back() : router.navigate("/orders"));

  if (detail.isPending && orderId) {
    return <View style={styles.page}><DetailHeader title="Order" onBack={back} /><LoadingState message="Loading order..." /></View>;
  }
  if (!detail.data) {
    return (
      <View style={styles.page}>
        <DetailHeader title="Order" onBack={back} />
        <View style={styles.content}>
          {detail.isError ? (
            <Card><ErrorState description="We couldn’t load this order. Check your connection and try again." onRetry={() => void refetch()} /></Card>
          ) : (
            <Card><EmptyState title="Order unavailable" description="This order could not be found or is outside your access." icon="alert-circle-outline" /></Card>
          )}
        </View>
      </View>
    );
  }

  const order: OrderDetail = detail.data;
  const delivery = order.deliveries?.[0];
  // Administrator and office for any stop, a driver for their own (no driver needed).
  const canComplete = canCompleteDelivery(role, delivery?.assigned_driver_id, me?.id);
  const flagged = isFlagged(order);
  const editing = orderEditing(order.status, can.manage, { isAdministrator, hasSalesInvoice: Boolean(order.sales_invoice_number) });
  const customer = order.customers;
  const customerName = displayName(customer) ?? "Customer";
  const packed = order.order_items.filter((item) => item.preparation_status === "completed").length;
  const subtotal = Number(order.order_subtotal);
  const discountAmount = Number(order.order_discount);
  const total = Number(order.order_total);
  const hasDiscount = Boolean(order.discount_type);
  const deliveryWhen = delivery ? `${dayLabel(delivery.scheduled_date)}${delivery.scheduled_time ? `, ${formatTime(delivery.scheduled_time)}` : ""}` : "";

  const next = nextStepFor({
    status: order.status,
    flagged,
    packed,
    itemCount: order.order_items.length,
    removalsToConfirm: (order.order_item_removals ?? []).filter((removal) => !removal.confirmed_at).length,
    delivery: delivery
      ? {
        status: delivery.status,
        when: `${dayLabel(delivery.scheduled_date).toLowerCase()}${delivery.scheduled_time ? ` at ${formatTime(delivery.scheduled_time)}` : ""}`,
        driver: delivery.profiles ? personName(delivery.profiles) : null,
        receivedBy: delivery.received_by,
      }
      : null,
    can: { ...can, completeDelivery: canComplete },
  });

  function done(message: string) {
    setSheet(null);
    toast(message);
  }

  const fail = (title: string) => (error: unknown) => Alert.alert(title, errorText(error));

  function changeStatus(nextStatus: OrderDetail["status"], message: string) {
    transition.mutate({ orderId: order.id, next: nextStatus }, { onSuccess: () => done(message), onError: fail("Unable to update order") });
  }

  function setFlag(flaggedNow: boolean, reason?: string) {
    attention.mutate(
      { orderId: order.id, flagged: flaggedNow, reason },
      { onSuccess: () => done(flaggedNow ? `${order.order_number} flagged` : "Flag resolved"), onError: fail("Unable to update flag") },
    );
  }

  async function confirmOrder() {
    let seenUpdatedAt = order.updated_at;
    // Confirming means the open question was answered, so the flag is cleared first.
    if (flagged) {
      if (!online) {
        Alert.alert("Clear the flag first", "This order is flagged for checking. Clearing the flag and confirming need a connection.");
        return;
      }
      try {
        await attention.mutateAsync({ orderId: order.id, flagged: false });
        seenUpdatedAt = (await refetch()).data?.updated_at ?? undefined;
      } catch (error) {
        fail("Unable to confirm order")(error);
        return;
      }
    }
    confirm.mutate({ orderId: order.id, orderNumber: order.order_number, updatedAt: seenUpdatedAt }, {
      onSuccess: (result) => done(result.queued ? `${order.order_number} confirmed offline. It will be sent when you’re back online.` : `${order.order_number} confirmed`),
      onError: (error) => { if (!(error instanceof NotQueuedError)) fail("Unable to confirm order")(error); void refetch(); },
    });
  }

  async function confirmDelivery(receivedBy: string) {
    if (!delivery) return;
    setDelivering(true);
    const outcome = await markDelivered({ ...delivery, orders: { order_number: order.order_number } }, receivedBy, order.updated_at, order.packing_version);
    setDelivering(false);
    if (outcome.status === "not_saved") return;
    if (outcome.status === "error") {
      Alert.alert("Unable to confirm delivery", outcome.error.message);
      void refetch();
      return;
    }
    setConfirmingDelivery(false);
    toast(outcome.status === "queued" ? `${order.order_number} saved offline. It will be sent when you’re back online.` : `${order.order_number} marked delivered`);
    if (outcome.status === "done") void refetch();
  }

  const runNext: Record<NextAction, () => void> = {
    confirm: () => void confirmOrder(),
    startPacking: () => changeStatus("for_preparation", `${order.order_number} moved to packing`),
    openPacking: () => router.navigate("/purchasing"),
    markDelivered: () => setConfirmingDelivery(true),
    orderAgain: () => router.push({ pathname: "/orders/[id]/duplicate", params: { id: order.id } }),
  };

  function apply(discount: { type: DiscountType; value: number; reason: string }) {
    const requestId = discountRequest.idFor(`${order.id}|${discount.type}|${discount.value}|${discount.reason}`);
    applyDiscount.mutate(
      { orderId: order.id, ...discount, requestId },
      {
        onSuccess: (money) => {
          discountRequest.reset();
          setDiscountOpen(false);
          toast({ title: "Discount applied", message: `New total ${formatMoney(Number(money.total))}` });
        },
      },
    );
  }

  function remove(reason: string) {
    removeDiscount.mutate(
      { orderId: order.id, reason, requestId: removeRequest.idFor(`${order.id}|${order.discount_type}|${order.discount_value}|${reason.trim()}`) },
      { onSuccess: () => { removeRequest.reset(); done("Discount removed"); } },
    );
  }

  function saveInvoice(value: string, reason: string | null) {
    setInvoice.mutate(
      { orderId: order.id, value, reason, requestId: invoiceRequest.idFor(`${order.id}|${value.trim()}|${reason?.trim() ?? ""}`) },
      { onSuccess: () => { invoiceRequest.reset(); done(value.trim() ? `SI# ${value.trim()} saved` : "SI# removed"); } },
    );
  }

  const maybeActions: (SheetAction | false)[] = [
    editing.canEditItems && { key: "edit", label: "Edit order", icon: "edit", onPress: () => { setSheet(null); router.push({ pathname: "/orders/[id]/edit", params: { id: order.id } }); } },
    can.manage && !editing.closed && (flagged
      ? { key: "flag", label: "Clear flag", icon: "flag", onPress: () => setFlag(false) }
      : { key: "flag", label: "Flag for checking", icon: "flag", onPress: () => setSheet("flag") }),
    can.manage && { key: "again", label: "Order again", icon: "repeat", onPress: () => { setSheet(null); router.push({ pathname: "/orders/[id]/duplicate", params: { id: order.id } }); } },
    can.manage && !editing.closed && { key: "cancel", label: "Cancel order", icon: "x-circle", danger: true, onPress: () => setSheet("cancel") },
  ];
  // Offline, only "Order again" works (a new order can be saved offline).
  const actions = maybeActions.filter((item): item is SheetAction => item !== false && (online || item.key === "again"));

  const activity = order.order_activity.map((item: OrderActivity) => ({
    id: item.id,
    icon: activityIcon(item.action),
    text: describeActivity(item.action, item.details ?? {}, order.order_source),
    meta: `${personName(item.profiles)} · ${relativeTime(item.created_at)}`,
  }));

  const busy = transition.isPending || attention.isPending || confirm.isPending;
  // Only confirming and "delivered" can be saved offline; the rest need a connection.
  const OFFLINE_OK: NextAction[] = ["confirm", "markDelivered", "openPacking", "orderAgain"];
  const waitingConfirm = queuedOrder && queuedOrder.rpc === "offline_confirm_order" && queuedOrder.status !== "synced" ? queuedOrder : undefined;
  const waitingDelivery = queuedDelivery && queuedDelivery.status !== "synced" ? queuedDelivery : undefined;
  const queuedNow = next.action?.key === "confirm" ? waitingConfirm : next.action?.key === "markDelivered" ? waitingDelivery : undefined;

  return (
    <View style={styles.page}>
      <DetailHeader title={order.order_number} onBack={back} onMore={actions.length ? () => setSheet("actions") : undefined} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refetch(); setRefreshing(false); }} tintColor={colors.primary} colors={[colors.primary]} />}
      >
        <StaleNotice query={detail} />
        <OrderSummary status={order.status} when={dayLabel(order.requested_delivery_date)} source={order.order_sources?.label ?? SOURCE_LABELS[order.order_source]} customer={customerName} itemCount={order.order_items.length} total={total} />

        {flagged ? <AttentionBanner reason={order.attention_reason ?? "Needs checking"} onResolve={can.manage ? () => setFlag(false) : undefined} /> : null}
        {order.status === "cancelled" ? <CancelledBanner /> : <ProgressCard status={order.status} next={next} />}

        <SectionCard title="Customer">
          <InfoRow
            label="Contact"
            value={[customer?.contact_person, customer?.phone].filter(Boolean).join(" · ") || "Not recorded"}
            action={customer?.phone ? { icon: "phone", label: `Call ${customer.contact_person ?? customerName}`, onPress: () => void callPhone(customer.phone ?? "") } : undefined}
          />
          <InfoRow
            label="Delivery address"
            value={customer?.delivery_address ?? "No address recorded"}
            action={customer?.delivery_address ? { icon: "navigation", label: "Directions", onPress: () => void openDirections(customer.delivery_address ?? "") } : undefined}
          />
          <InfoRow label="Requested delivery time" value={deliveryTimeText(order.delivery_time_start, order.delivery_time_end)} />
          {delivery ? <InfoRow label="Delivery" value={`${deliveryWhen} · ${delivery.profiles ? personName(delivery.profiles) : "Unassigned"}`} /> : null}
          {delivery?.received_by ? <InfoRow label="Received by" value={delivery.received_by} /> : null}
          {order.notes ? <InfoRow label="Notes" value={order.notes} /> : null}
        </SectionCard>

        <SalesInvoiceCard value={order.sales_invoice_number} onEdit={editing.canSetSalesInvoice ? () => setSheet("invoice") : undefined} />
        {RECEIPT_STATUSES.includes(order.status) || receipt.data ? (
          <DeliveryReceiptCard
            label={receipt.data ? receiptNumber(receipt.data) : null}
            busy={receipt.isPending}
            onOpen={() => router.push({ pathname: "/orders/[id]/receipt", params: { id: order.id } })}
          />
        ) : null}

        <SectionCard
          title="Items"
          style={styles.items}
          right={editing.canEditItems ? <TextLink icon="edit" label="Edit order" onPress={() => router.push({ pathname: "/orders/[id]/edit", params: { id: order.id } })} /> : undefined}
        >
          <View>
            <ItemLines
              lines={order.order_items.map((item) => ({
                id: item.id,
                name: `${item.products?.product_name ?? "Product"}${item.product_varieties ? ` · ${item.product_varieties.variety_name}` : ""}`,
                quantity: Number(item.quantity),
                unit: item.unit_of_measurement,
                unitPrice: Number(item.unit_price),
                lineTotal: Number(item.line_total),
              }))}
            />
            <SubtotalRow subtotal={subtotal} muted={hasDiscount} />
            {discountOpen ? (
              <DiscountForm
                subtotal={subtotal}
                initial={hasDiscount && order.discount_type ? { type: order.discount_type, value: Number(order.discount_value), reason: order.discount_reason ?? "" } : null}
                busy={applyDiscount.isPending}
                serverError={applyDiscount.error ? errorText(applyDiscount.error) : null}
                onCancel={() => { applyDiscount.reset(); setDiscountOpen(false); }}
                onApply={apply}
              />
            ) : hasDiscount && order.discount_type ? (
              <DiscountRow
                amount={discountAmount}
                label={discountLabel(order.discount_type, Number(order.discount_value), formatMoney)}
                reason={order.discount_reason}
                busy={removeDiscount.isPending}
                onEdit={editing.canChangeDiscount ? () => { applyDiscount.reset(); setDiscountOpen(true); } : undefined}
                onRemove={editing.canChangeDiscount ? () => setSheet("removeDiscount") : undefined}
              />
            ) : editing.canChangeDiscount ? (
              <AddDiscountButton onPress={() => { applyDiscount.reset(); setDiscountOpen(true); }} />
            ) : null}
            <TotalRow total={total} />
          </View>
        </SectionCard>

        <ActivityCard items={activity} />
      </ScrollView>

      {next.action ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 8) + 8 }]}>
          {queuedNow ? (
            <Pressable accessibilityRole="button" accessibilityHint="Opens offline changes" onPress={() => router.push("/sync")} style={[styles.queued, queuedNow.status === "rejected" && styles.queuedReview]}>
              <Icon name={queuedNow.status === "rejected" ? "alert-circle" : "clock"} size={16} color={queuedNow.status === "rejected" ? colors.warning : colors.info} />
              <Text style={[styles.queuedText, queuedNow.status === "rejected" && styles.queuedTextReview]}>
                {queuedNow.status === "rejected" ? `Not saved: ${queuedNow.rejection?.reason ?? "needs review"}` : `${queuedNow.label} saved offline · waiting to sync`}
              </Text>
            </Pressable>
          ) : null}
          {queuedNow?.status === "rejected" || !queuedNow ? (
            <Button
              label={!online && !OFFLINE_OK.includes(next.action.key) ? `${next.action.label} (needs a connection)` : next.action.label}
              icon={next.action.icon}
              size="lg"
              loading={busy}
              disabled={!online && !OFFLINE_OK.includes(next.action.key)}
              onPress={runNext[next.action.key]}
            />
          ) : null}
        </View>
      ) : null}

      <ActionsSheet visible={sheet === "actions"} caption={online ? `${order.order_number} · ${customerName}` : `${order.order_number} · Offline: other actions need a connection`} actions={actions} onClose={() => setSheet(null)} />
      <FlagSheet visible={sheet === "flag"} busy={attention.isPending} onFlag={(reason) => setFlag(true, reason)} onClose={() => setSheet(null)} />
      <CancelSheet visible={sheet === "cancel"} orderNumber={order.order_number} busy={transition.isPending} onConfirm={() => changeStatus("cancelled", `${order.order_number} cancelled`)} onClose={() => setSheet(null)} />
      <SalesInvoiceSheet
        visible={sheet === "invoice"}
        caption={`${order.order_number} · ${customerName}`}
        initial={order.sales_invoice_number}
        requireReason={editing.salesInvoiceNeedsReason}
        busy={setInvoice.isPending}
        serverError={setInvoice.error ? errorText(setInvoice.error) : null}
        onSave={saveInvoice}
        onClose={() => { setInvoice.reset(); setSheet(null); }}
      />
      <RemoveDiscountSheet
        visible={sheet === "removeDiscount"}
        caption={`${order.order_number} · ${hasDiscount ? discountLabel(order.discount_type as DiscountType, Number(order.discount_value), formatMoney) : ""}`}
        newTotal={formatMoney(subtotal)}
        busy={removeDiscount.isPending}
        serverError={removeDiscount.error ? errorText(removeDiscount.error) : null}
        onRemove={remove}
        onClose={() => { removeDiscount.reset(); setSheet(null); }}
      />
      <DeliverSheet
        target={confirmingDelivery ? { customer: customerName, summary: `${order.order_number} · ${plural(order.order_items.length, "item")}` } : null}
        busy={delivering}
        onClose={() => setConfirmingDelivery(false)}
        onConfirm={(receivedBy) => void confirmDelivery(receivedBy)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  items: { gap: 8 },
  queued: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.infoSoft, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: 10, marginBottom: 8 },
  queuedReview: { backgroundColor: colors.warningSoft },
  queuedText: { ...text.caption, color: colors.info, flex: 1 },
  queuedTextReview: { color: colors.warning },
  footer: { paddingTop: 12, paddingHorizontal: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
});
