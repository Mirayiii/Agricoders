import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";

import { BottomSheet, Button, Card, EmptyState, ErrorState, Icon, LoadingState, PackItem, ProgressBar, SegmentedControl, StaleNotice, StatusBadge, useToast } from "@/components";
import { PERMISSIONS } from "@/constants/permissions";
import { colors, radii, shadows, spacing, text } from "@/constants/theme";
import { useAuth, usePermission } from "@/features/auth";
import { DataError } from "@/services/data";
import { NotQueuedError, useIsOnline, useOutbox, useQueuedChange } from "@/services/offline";
import { customerName } from "@/utils/customer";
import { DateRangeSheet } from "./DateRangeSheet";
import { exportBuyList, useBuyList, useCancelPacking, useManilaToday, usePackingBoard, useSetBought, useSetItemPacked, useStartPacking } from "./purchasingData";
import {
  buyProgress,
  buySaveProblem,
  buySummary,
  focusRange,
  isBought,
  needMoreText,
  deliveryDay,
  formatAmount,
  horizonLabel,
  horizonQuery,
  isAdvanceOrder,
  manilaToday,
  packedCount,
  shortDate,
  shortageText,
  splitBoard,
  withQueuedTicks,
  type BuyItem,
  type DateRange,
  type Horizon,
  type PackOrder,
} from "./purchasingLogic";

type Tab = "pack" | "buy";

const HORIZONS: { key: Horizon; label: string }[] = [
  { key: "immediate", label: "Immediate" },
  { key: "3days", label: "3 Days" },
  { key: "7days", label: "7 Days" },
  { key: "custom", label: "Custom" },
];

/** A failed write in words staff can act on. */
function problemText(error: unknown): string {
  if (error instanceof DataError && error.code) return error.message;
  if (error instanceof Error && /fetch|network/i.test(error.message)) return "Couldn’t reach the server. Nothing was changed twice: try again.";
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

export function PurchasingScreen({ initialTab = "pack", openTab, focusOrderId }: { initialTab?: Tab; openTab?: Tab; focusOrderId?: string }) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const canPack = usePermission(PERMISSIONS.manageFulfillment);
  // SI-02, PS-02: warehouse stock is for the administrator; the server sends it to no one else.
  const showStock = useAuth().profile?.role === "administrator";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [horizon, setHorizon] = useState<Horizon>("immediate");
  const [custom, setCustom] = useState<DateRange | null>(null);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState<PackOrder | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const serverToday = useManilaToday();
  const today = serverToday.data ?? manilaToday();
  const board = usePackingBoard();
  const range = horizonQuery(horizon, today, custom);
  const buy = useBuyList(range.from, range.to);
  const setBought = useSetBought(range.from, range.to);
  const label = horizonLabel(horizon, today, custom);

  const online = useIsOnline();
  // PU-01: ticks the server refused or could not get, by line, until tapped again.
  const [unsaved, setUnsaved] = useState<Record<string, boolean>>({});
  const lineKey = (item: BuyItem) => `${item.product_id}|${item.unit_key}`;
  function toggleBought(item: BuyItem, bought: boolean) {
    const key = lineKey(item);
    setUnsaved((current) => ({ ...current, [key]: false }));
    if (!online) {
      setUnsaved((current) => ({ ...current, [key]: true }));
      return;
    }
    setBought.mutate({ item, bought }, {
      onError: (error) => {
        setUnsaved((current) => ({ ...current, [key]: true }));
        toast({ title: "Tick not saved", message: error instanceof DataError && error.code ? error.message : buySaveProblem(online), tone: "error" });
      },
    });
  }

  // AS-02: a "Ready to buy" notification opens To buy on that order's day.
  // Applied once per notification tap, while rendering (React's pattern for
  // state that follows a prop).
  const focusKey = openTab || focusOrderId ? `${openTab ?? ""}|${focusOrderId ?? ""}` : null;
  const [appliedFocus, setAppliedFocus] = useState<string | null>(null);
  const focusOrder = focusOrderId ? board.data?.find((entry) => entry.id === focusOrderId) : undefined;
  if (focusKey && appliedFocus !== focusKey && (!focusOrderId || board.data)) {
    setAppliedFocus(focusKey);
    if (openTab) setTab(openTab);
    if (focusOrder) {
      const next = focusRange(focusOrder.requested_delivery_date, today);
      setCustom(next.custom);
      setHorizon(next.horizon);
    }
  }

  const startPacking = useStartPacking();
  const cancelPacking = useCancelPacking();
  const setPacked = useSetItemPacked();

  const { refetch: refetchBoard } = board;
  const { refetch: refetchBuy } = buy;
  useFocusEffect(useCallback(() => { void refetchBoard(); void refetchBuy(); }, [refetchBoard, refetchBuy]));

  async function refresh() {
    setRefreshing(true);
    await Promise.all([refetchBoard(), refetchBuy()]);
    setRefreshing(false);
  }

  const outbox = useOutbox();
  const boardRows = useMemo(() => withQueuedTicks(board.data ?? [], outbox.items), [board.data, outbox.items]);
  const split = useMemo(() => splitBoard(boardRows, today), [boardRows, today]);
  const toPackCount = split.packing.length + split.ready.length;

  function tick(order: PackOrder, lineId: string, packed: boolean) {
    const line = order.order_items.find((item) => item.id === lineId);
    if (!line) return;
    setPacked.mutate({ line, orderNumber: order.order_number, packed }, {
      onSuccess: (result) => {
        if (!result.queued && result.status === "for_delivery") toast({ title: `${order.order_number} is packed`, message: "It has moved to For delivery." });
      },
      onError: (error) => {
        if (error instanceof NotQueuedError) return;
        toast({ title: "Couldn’t save the tick", message: problemText(error), tone: "error" });
      },
    });
  }

  function start(order: PackOrder) {
    startPacking.mutate(order.id, {
      onSuccess: () => toast({ title: `Packing ${order.order_number}`, message: customerName(order.customers) ?? undefined }),
      onError: (error) => { toast({ title: "Couldn’t start packing", message: problemText(error), tone: "error" }); void refetchBoard(); },
    });
  }

  function stopPacking(order: PackOrder) {
    cancelPacking.mutate(order.id, {
      onSuccess: () => { setConfirmCancel(null); toast({ title: `${order.order_number} moved back to Ready to start` }); },
      onError: (error) => { setConfirmCancel(null); toast({ title: "Couldn’t cancel packing", message: problemText(error), tone: "error" }); void refetchBoard(); },
    });
  }

  function chooseHorizon(next: Horizon) {
    if (next === "custom") setRangeOpen(true);
    else setHorizon(next);
  }

  async function exportPdf() {
    if (!buy.data) return;
    setExporting(true);
    try {
      const shared = await exportBuyList(buy.data, label, showStock);
      if (!shared) toast({ title: "Sharing isn’t available on this device", tone: "error" });
    } catch (error) {
      toast({ title: "Couldn’t make the PDF", message: problemText(error), tone: "error" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <View style={styles.page}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} colors={[colors.primary]} />}
      >
        <SegmentedControl
          options={[
            { key: "pack", label: board.data ? `To pack · ${toPackCount}` : "To pack" },
            { key: "buy", label: buy.data ? `To buy · ${buy.data.items.length}` : "To buy" },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === "pack" ? (
          <>
            <StaleNotice query={board} />
            {board.isPending ? <LoadingState message="Loading packing list..." /> : !board.data ? (
              <Card><ErrorState description="We couldn’t load the packing list. Pull down to try again." onRetry={() => void refetchBoard()} /></Card>
            ) : (
              <>
                <Text style={styles.section} accessibilityRole="header">Packing now</Text>
                {split.packing.length ? split.packing.map((order) => (
                  <PackingCard
                    key={order.id}
                    order={order}
                    today={today}
                    canPack={canPack}
                    onTick={(lineId, packed) => tick(order, lineId, packed)}
                    onCancel={() => setConfirmCancel(order)}
                  />
                )) : <Text style={styles.empty}>Nothing is being packed. Start an order below.</Text>}

                <View style={styles.sectionRow}>
                  <Text style={styles.section} accessibilityRole="header">Ready to start</Text>
                  {split.advanceCount ? (
                    <View style={styles.advanceCount}>
                      <View style={styles.dot} />
                      <Text style={styles.advanceCountText}>{split.advanceCount} advance</Text>
                    </View>
                  ) : null}
                </View>
                {split.ready.length ? split.ready.map((order) => (
                  <ReadyCard
                    key={order.id}
                    order={order}
                    today={today}
                    canPack={canPack}
                    busy={startPacking.isPending && startPacking.variables === order.id}
                    onStart={() => start(order)}
                  />
                )) : <Text style={styles.empty}>No confirmed orders are waiting.</Text>}
              </>
            )}
          </>
        ) : (
          <>
            <SegmentedControl compact options={HORIZONS} value={horizon} onChange={chooseHorizon} />
            <Pressable
              disabled={horizon !== "custom"}
              onPress={() => setRangeOpen(true)}
              accessibilityRole={horizon === "custom" ? "button" : "text"}
              accessibilityHint={horizon === "custom" ? "Change the date range" : undefined}
            >
              <Text style={styles.horizon}>{label}</Text>
            </Pressable>
            <StaleNotice query={buy} />
            {buy.isPending ? <LoadingState message="Adding up orders..." /> : !buy.data ? (
              <Card><ErrorState description={buy.error ? problemText(buy.error) : "We couldn’t load the buy list."} onRetry={() => void refetchBuy()} /></Card>
            ) : buy.data.items.length ? (
              <>
                {buy.data.overdue_orders ? (
                  <Text style={styles.overdue}>Includes {buy.data.overdue_orders} late {buy.data.overdue_orders === 1 ? "order" : "orders"} not packed yet.</Text>
                ) : null}
                <BuyProgress done={buyProgress(buy.data).done} total={buyProgress(buy.data).total} share={buyProgress(buy.data).share} />
                {canPack && !online ? <Text style={styles.overdue}>You’re offline. Ticking lines as bought needs a connection.</Text> : null}
                <View style={styles.buyCard}>
                  {buy.data.items.map((item, index) => (
                    <BuyRow
                      key={`${item.product_id}|${item.unit_key}`}
                      item={item}
                      showStock={showStock}
                      last={index === buy.data.items.length - 1}
                      saving={setBought.isPending && setBought.variables && lineKey(setBought.variables.item) === lineKey(item) ? true : false}
                      problem={unsaved[lineKey(item)] ? buySaveProblem(online) : null}
                      onToggle={canPack ? (bought) => toggleBought(item, bought) : undefined}
                    />
                  ))}
                </View>
                <Button label="Export as PDF" icon="download" size="lg" loading={exporting} onPress={() => void exportPdf()} />
                <Text style={styles.footnote}>Confirmed and packing orders only. Ticks are saved for each delivery day, so other date ranges and the administrator see the same bought amounts. If an order grows after a tick, the line shows how much more is needed.</Text>
              </>
            ) : (
              <Card><EmptyState icon="basket-outline" title="Nothing to buy" description="No confirmed or packing orders are due in this range." /></Card>
            )}
          </>
        )}
      </ScrollView>

      <DateRangeSheet
        visible={rangeOpen}
        initial={custom}
        today={today}
        onClose={() => setRangeOpen(false)}
        onApply={(next) => { setCustom(next); setHorizon("custom"); setRangeOpen(false); }}
      />

      <BottomSheet visible={confirmCancel !== null} onClose={() => setConfirmCancel(null)}>
        <Text style={styles.sheetTitle}>Move {confirmCancel?.order_number} back to Ready to start?</Text>
        <Text style={styles.sheetBody}>This only stops packing for now. The order is not cancelled: it stays Confirmed for the customer, and items already ticked stay ticked.</Text>
        <View style={styles.sheetActions}>
          <Button label="Move back to Ready to start" type="primary" size="lg" loading={cancelPacking.isPending} onPress={() => { if (confirmCancel) stopPacking(confirmCancel); }} />
          <Button label="Keep packing" type="brandOutline" size="lg" onPress={() => setConfirmCancel(null)} />
        </View>
      </BottomSheet>
    </View>
  );
}

function DeliveryLine({ order, today, items }: { order: PackOrder; today: string; items: number }) {
  return (
    <Text style={styles.meta}>
      {order.order_number} · <Text style={styles.metaStrong}>Delivery {deliveryDay(order.requested_delivery_date, today)}</Text> · {items} {items === 1 ? "item" : "items"}
    </Text>
  );
}

function PackingCard({ order, today, canPack, onTick, onCancel }: { order: PackOrder; today: string; canPack: boolean; onTick: (lineId: string, packed: boolean) => void; onCancel: () => void }) {
  const online = useIsOnline();
  const done = packedCount(order);
  const total = order.order_items.length;
  const share = total ? done / total : 0;
  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityHint="Opens the order" onPress={() => router.push({ pathname: "/orders/[id]", params: { id: order.id } })} style={styles.cardHead}>
        <View style={styles.flex}>
          <Text style={styles.customer}>{customerName(order.customers) ?? "Customer"}</Text>
          <DeliveryLine order={order} today={today} items={total} />
        </View>
        <Icon name="chevron-right" size={18} color={colors.textMuted} />
      </Pressable>
      <View style={styles.progress} accessible accessibilityLabel={`${done} of ${total} packed`}>
        <View style={styles.progressLabels}>
          <Text style={styles.progressText}>{done} of {total} packed</Text>
          <Text style={styles.progressText}>{Math.round(share * 100)}%</Text>
        </View>
        <ProgressBar value={share} />
      </View>
      <View style={styles.checklist}>
        {order.order_items.map((line) => (
          <View key={line.id} style={styles.checkRow}>
            <PackItem
              name={line.products?.product_name ?? "Product"}
              quantity={`${formatAmount(Number(line.quantity))} ${line.unit_of_measurement}`}
              note={line.notes}
              packed={line.preparation_status === "completed"}
              onToggle={canPack ? (packed) => onTick(line.id, packed) : undefined}
            />
            <QueuedTickNote lineId={line.id} />
          </View>
        ))}
      </View>
      <Text style={styles.hint}>{canPack ? (online ? "Tap each item once it is packed." : "You’re offline. Ticks are saved on this phone and sent when you’re back online.") : "Packing is updated by purchasing staff."}</Text>
      {canPack ? <Button label="Cancel packing" type="danger" size="lg" disabled={!online} onPress={onCancel} /> : null}
    </View>
  );
}

function ReadyCard({ order, today, canPack, busy, onStart }: { order: PackOrder; today: string; canPack: boolean; busy: boolean; onStart: () => void }) {
  const advance = isAdvanceOrder(order.requested_delivery_date, today);
  const online = useIsOnline();
  return (
    <View style={[styles.card, advance && styles.advanceCard]}>
      {advance ? (
        <View style={styles.advanceTag}>
          <Text style={styles.advanceTagText}>Advance order · {shortDate(order.requested_delivery_date)}</Text>
        </View>
      ) : null}
      <View style={styles.cardHead}>
        <View style={styles.flex}>
          <Text style={styles.customer}>{customerName(order.customers) ?? "Customer"}</Text>
          <DeliveryLine order={order} today={today} items={order.order_items.length} />
        </View>
        <StatusBadge label="Confirmed" tone="info" />
      </View>
      <View style={styles.address}>
        <Icon name="map-pin" size={15} color={colors.textSecondary} />
        <Text style={styles.addressText}>{order.customers?.delivery_address ?? "No address recorded"}</Text>
      </View>
      {canPack ? <Button label={online ? "Start packing" : "Start packing when online"} size="lg" loading={busy} disabled={!online} onPress={onStart} /> : null}
    </View>
  );
}

/** A tick saved offline: waiting to sync, or held for review with the reason. */
function QueuedTickNote({ lineId }: { lineId: string }) {
  const queued = useQueuedChange(lineId);
  if (!queued || queued.status === "synced") return null;
  const review = queued.status === "rejected";
  return (
    <Pressable accessibilityRole="button" accessibilityHint="Opens offline changes" onPress={() => router.push("/sync")} style={styles.queuedRow}>
      <Icon name={review ? "alert-circle" : "clock"} size={14} color={review ? colors.warning : colors.info} />
      <Text style={[styles.queuedText, review && styles.queuedReview]}>{review ? `Not saved: ${queued.rejection?.reason ?? "needs review"}` : queued.status === "syncing" ? "Sending…" : "Saved offline · waiting to sync"}</Text>
    </Pressable>
  );
}

function BuyProgress({ done, total, share }: { done: number; total: number; share: number }) {
  return (
    <View style={styles.progress} accessible accessibilityLabel={`${done} of ${total} bought`}>
      <View style={styles.progressLabels}>
        <Text style={styles.progressText}>{done} of {total} bought</Text>
        <Text style={styles.progressText}>{Math.round(share * 100)}%</Text>
      </View>
      <ProgressBar value={share} />
    </View>
  );
}

/** PU-01: tick a line when it is bought. "Need 5 kg more" when demand went up after the tick. */
function BuyRow({ item, last, showStock, saving, problem, onToggle }: { item: BuyItem; last: boolean; showStock: boolean; saving: boolean; problem: string | null; onToggle?: (bought: boolean) => void }) {
  const bought = isBought(item);
  const needMore = needMoreText(item);
  const short = showStock ? shortageText(item) : null;
  return (
    <View style={[styles.buyRow, !last && styles.divider]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`${item.product_name}, ${formatAmount(item.quantity)} ${item.unit} needed. ${buySummary(item, showStock)}.${needMore ? ` ${needMore}.` : ""}${short ? ` ${short}.` : ""}`}
        accessibilityState={{ checked: bought, disabled: !onToggle || saving, busy: saving }}
        disabled={!onToggle || saving}
        onPress={() => onToggle?.(!bought)}
        style={styles.buyTick}
      >
        <View style={[styles.circle, bought ? styles.circleOn : styles.circleOff]}>
          {bought ? <Icon name="check" size={16} color={colors.onBrand} /> : null}
        </View>
        <View style={styles.flex}>
          <Text style={[styles.buyName, bought && styles.struck]}>{item.product_name}</Text>
          <Text style={styles.meta}>{buySummary(item, showStock)}</Text>
          {needMore ? <Text style={styles.short}>{needMore}</Text> : null}
          {short ? <Text style={styles.meta}>{short}</Text> : null}
          {saving ? <Text style={styles.meta}>Saving…</Text> : null}
          {problem && !saving ? <Text style={styles.short} accessibilityRole="alert">{problem}</Text> : null}
        </View>
        <Text style={[styles.buyQty, bought && styles.boughtQty]}>{formatAmount(item.quantity)} {item.unit}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  queuedRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, paddingBottom: 8 },
  queuedText: { ...text.caption, color: colors.info, flex: 1 },
  queuedReview: { color: colors.warning },
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 120, gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  section: { ...text.heading, color: colors.text, marginTop: spacing.sm },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  advanceCount: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.info },
  advanceCountText: { ...text.captionStrong, color: colors.info },
  empty: { ...text.caption, color: colors.textMuted, paddingVertical: spacing.xs },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md, ...shadows.card },
  advanceCard: { borderColor: colors.advanceOrderStroke },
  advanceTag: { alignSelf: "flex-start", backgroundColor: colors.infoSoft, borderRadius: radii.sm, paddingHorizontal: 8, paddingVertical: 3, marginBottom: -4 },
  advanceTagText: { ...text.captionStrong, fontSize: 12, color: colors.info },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  customer: { ...text.bodyStrong, color: colors.text },
  meta: { ...text.caption, color: colors.textSecondary, marginTop: 2 },
  metaStrong: { ...text.captionStrong, color: colors.text },
  progress: { gap: 6 },
  progressLabels: { flexDirection: "row", justifyContent: "space-between" },
  progressText: { ...text.captionStrong, color: colors.textSecondary },
  checklist: { borderTopWidth: 1, borderTopColor: colors.border },
  checkRow: { borderBottomWidth: 1, borderBottomColor: colors.border },
  hint: { ...text.caption, color: colors.textMuted, textAlign: "center" },
  address: { flexDirection: "row", alignItems: "center", gap: 6 },
  addressText: { ...text.caption, color: colors.textSecondary, flex: 1 },
  horizon: { ...text.caption, color: colors.textSecondary },
  overdue: { ...text.captionStrong, color: colors.warning },
  buyCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, paddingHorizontal: spacing.xl, ...shadows.card },
  buyRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 12 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  buyName: { ...text.bodyStrong, color: colors.text },
  short: { ...text.captionStrong, color: colors.warning, marginTop: 2 },
  buyQty: { ...text.title, color: colors.text },
  buyTick: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  circle: { width: 26, height: 26, borderRadius: radii.full, alignItems: "center", justifyContent: "center" },
  circleOff: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.borderStrong },
  circleOn: { backgroundColor: colors.primary },
  struck: { textDecorationLine: "line-through", color: colors.textMuted },
  boughtQty: { color: colors.textMuted },
  footnote: { ...text.caption, color: colors.textMuted, textAlign: "center" },
  sheetTitle: { ...text.title, color: colors.text },
  sheetBody: { ...text.body, color: colors.textSecondary },
  sheetActions: { gap: spacing.sm },
});
