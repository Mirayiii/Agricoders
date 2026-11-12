import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from "react-native";
import { PAGE_SIZE, pageSlice } from "@/utils/pagination";
import { usePage } from "@/utils/usePage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";

import { Avatar, BottomSheet, Button, Card, EmptyState, ErrorState, FormInput, Icon, LoadingState, Pagination, SegmentedControl, StaleNotice, StatusBadge, useToast, type IconName } from "@/components";
import { PERMISSIONS } from "@/constants/permissions";
import { colors, radii, shadows, spacing, text } from "@/constants/theme";
import { useAuth, usePermission } from "@/features/auth";
import { useManilaToday } from "@/features/purchasing/purchasingData";
import { manilaToday } from "@/features/purchasing/purchasingLogic";
import { DataError } from "@/services/data";
import { callPhone, openDirections } from "@/utils/links";
import { customerName } from "@/utils/customer";
import { QueuedDeliveryNote, useDeliveryQueued, useMarkDelivered } from "../shared";
import { DONE_WINDOW_DAYS, useAssignDriver, useDeliveryBoard, useDrivers, useReorderRoute, type DriverOption } from "../deliveriesData";
import {
  buildRoutes,
  canCompleteDelivery,
  deliveredLabel,
  driverName,
  driverStopsText,
  moveStop,
  overlappingStops,
  splitTabs,
  stopTimeText,
  upcomingLabel,
  type Route,
  type StopRow,
  stopIsRepacking,
} from "../deliveriesLogic";

type Tab = "today" | "upcoming" | "done";

function problemText(error: unknown): string {
  if (error instanceof DataError && error.code) return error.message;
  if (error instanceof Error && /fetch|network/i.test(error.message)) return "Couldn’t reach the server. Nothing was saved twice: try again.";
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

const itemsText = (stop: StopRow) => {
  const count = stop.orders?.order_items.length ?? 0;
  return `${stop.orders?.order_number ?? ""} · ${count} ${count === 1 ? "item" : "items"}`;
};

export function DeliveriesScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const me = useAuth().profile;
  const canAssign = usePermission(PERMISSIONS.manageDeliveries) && (me?.role === "administrator" || me?.role === "administrative_staff");
  const [tab, setTab] = useState<Tab>("today");
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<{ key: string; ids: string[] } | null>(null);
  const [assigning, setAssigning] = useState<StopRow | null>(null);
  const [confirming, setConfirming] = useState<StopRow | null>(null);

  const serverToday = useManilaToday();
  const today = serverToday.data ?? manilaToday();
  const board = useDeliveryBoard();
  const drivers = useDrivers(today, canAssign);
  const reorder = useReorderRoute();
  const assign = useAssignDriver();
  const markDelivered = useMarkDelivered();
  const [delivering, setDelivering] = useState(false);

  const { refetch } = board;
  useFocusEffect(useCallback(() => { void refetch(); }, [refetch]));
  async function refresh() {
    setRefreshing(true);
    await Promise.all([refetch(), canAssign ? drivers.refetch() : null]);
    setRefreshing(false);
  }

  const tabs = useMemo(() => splitTabs(board.data ?? [], today), [board.data, today]);
  const routes = useMemo(() => buildRoutes(tabs.today), [tabs.today]);
  const overlapIds = useMemo(() => new Set(routes.flatMap((route) => [...route.overlaps])), [routes]);
  const canEditRoute = (route: Route) => canAssign || (route.driverId !== null && route.driverId === me?.id);
  const canComplete = (stop: StopRow) => canCompleteDelivery(me?.role, stop.assigned_driver_id, me?.id);

  function saveRoute(route: Route) {
    if (!editing) return;
    const unchanged = editing.ids.join() === route.stops.map((stop) => stop.id).join();
    if (unchanged) { setEditing(null); return; }
    // Every stop of the route is saved with the day it is due (late stops keep their own day).
    const date = route.stops[0].scheduled_date;
    if (route.stops.some((stop) => stop.scheduled_date !== date)) {
      toast({ title: "Late stops are on another day’s route", message: "Reschedule them to today before reordering.", tone: "error" });
      return;
    }
    reorder.mutate({ date, driverId: route.driverId, ids: editing.ids }, {
      onSuccess: () => { setEditing(null); toast({ title: "Route saved" }); },
      onError: (error) => {
        setEditing(null);
        toast({ title: "Couldn’t save the route", message: problemText(error), tone: "error" });
        void refetch();
      },
    });
  }

  function chooseDriver(stop: StopRow, driver: DriverOption | null) {
    assign.mutate({ deliveryId: stop.id, driverId: driver?.id ?? null }, {
      onSuccess: () => { setAssigning(null); toast({ title: driver ? `Assigned to ${driver.full_name}` : "Driver removed", message: customerName(stop.orders?.customers) ?? undefined }); },
      onError: (error) => { setAssigning(null); toast({ title: "Couldn’t assign the driver", message: problemText(error), tone: "error" }); void refetch(); },
    });
  }

  async function confirmDelivered(stop: StopRow, receivedBy: string) {
    setDelivering(true);
    const outcome = await markDelivered(stop, receivedBy);
    setDelivering(false);
    const order = stop.orders?.order_number ?? "Delivery";
    if (outcome.status === "not_saved") return;
    if (outcome.status === "error") {
      toast({ title: "Couldn’t confirm the delivery", message: problemText(outcome.error), tone: "error" });
      void refetch();
      return;
    }
    setConfirming(null);
    if (outcome.status === "queued") toast({ title: `${order} saved offline`, message: "It will be sent when you’re back online." });
    else toast({ title: `${order} delivered`, message: outcome.drLabel ? `Receipt ${outcome.drLabel} is on the order.` : undefined });
  }

  const list = tab === "today" ? tabs.today : tab === "upcoming" ? tabs.upcoming : tabs.done;
  // Prototype: Done deliveries show 15 per page; Today and Upcoming stay whole so routes read in order.
  const [page, setPage] = usePage(tab);
  const scroller = useRef<ScrollViewInstance>(null);
  const goTo = (next: number) => { setPage(next); scroller.current?.scrollTo({ y: 0, animated: false }); };
  const shown = tab === "done" ? pageSlice(list, page, PAGE_SIZE) : list;

  return (
    <View style={styles.page}>
      <ScrollView
        ref={scroller}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} colors={[colors.primary]} />}
      >
        <SegmentedControl
          options={[{ key: "today", label: board.data ? `Today · ${tabs.today.length}` : "Today" }, { key: "upcoming", label: "Upcoming" }, { key: "done", label: "Done" }]}
          value={tab}
          onChange={(next) => { setEditing(null); setTab(next); }}
        />
        <StaleNotice query={board} />

        {board.isPending ? <LoadingState message="Loading deliveries..." /> : !board.data ? (
          <Card><ErrorState description="We couldn’t load deliveries. Pull down to try again." onRetry={() => void refetch()} /></Card>
        ) : (
          <>
            {tab === "today" && routes.length ? (
              <>
                <View style={styles.sectionRow}>
                  <Text style={styles.section} accessibilityRole="header">Rider routes</Text>
                  {routes.some(canEditRoute) ? <Text style={styles.sectionHint}>Tap Edit to reorder stops</Text> : null}
                </View>
                {routes.map((route) => {
                  const key = route.driverId ?? "unassigned";
                  return (
                    <RouteCard
                      key={key}
                      route={route}
                      editIds={editing?.key === key ? editing.ids : null}
                      canEdit={canEditRoute(route)}
                      canAssign={canAssign}
                      busy={reorder.isPending && editing?.key === key}
                      onEdit={() => setEditing({ key, ids: route.stops.map((stop) => stop.id) })}
                      onMove={(index, delta) => setEditing((current) => (current ? { ...current, ids: moveStop(current.ids, index, delta) } : current))}
                      onAssign={setAssigning}
                      onDone={() => saveRoute(route)}
                    />
                  );
                })}
                <Text style={styles.section} accessibilityRole="header">All stops</Text>
              </>
            ) : null}

            {list.length ? shown.map((stop) => tab === "done" ? (
              <DeliveredCard key={stop.id} stop={stop} today={today} />
            ) : (
              <DeliveryCard
                key={stop.id}
                stop={stop}
                when={tab === "today" ? (stop.scheduled_date < today ? `Late · ${upcomingLabel(stop, today)}` : stopTimeText(stop)) : upcomingLabel(stop, today)}
                overlap={tab === "today" ? overlapIds.has(stop.id) : overlappingStops(tabs.upcoming.filter((other) => other.scheduled_date === stop.scheduled_date && other.assigned_driver_id === stop.assigned_driver_id)).has(stop.id)}
                late={tab === "today" && stop.scheduled_date < today}
                canAssign={canAssign}
                canComplete={canComplete(stop)}
                onAssign={() => setAssigning(stop)}
                onDeliver={() => setConfirming(stop)}
              />
            )).concat(tab === "done" ? [<Pagination key="pages" page={page} total={list.length} pageSize={PAGE_SIZE} onChange={goTo} label="deliveries" />] : []) : (
              <Card>
                <EmptyState
                  icon="car-outline"
                  title={tab === "done" ? "No deliveries yet" : tab === "upcoming" ? "Nothing scheduled ahead" : "No stops today"}
                  description={tab === "done" ? `Deliveries from the last ${DONE_WINDOW_DAYS} days appear here.` : "Orders appear once packing is complete and a delivery is scheduled."}
                />
              </Card>
            )}
          </>
        )}
      </ScrollView>

      <AssignDriverSheet
        stop={assigning}
        drivers={drivers.data ?? []}
        loading={drivers.isPending}
        busy={assign.isPending}
        onChoose={(driver) => { if (assigning) chooseDriver(assigning, driver); }}
        onClose={() => setAssigning(null)}
      />
      <ConfirmDeliverySheet
        stop={confirming}
        busy={delivering}
        onConfirm={(receivedBy) => { if (confirming) void confirmDelivered(confirming, receivedBy); }}
        onClose={() => setConfirming(null)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Rider route card (Figma "Rider routes" and "Reorder route (edit mode)")
// ---------------------------------------------------------------------------

function RouteCard({ route, editIds, canEdit, canAssign, busy, onEdit, onMove, onAssign, onDone }: {
  route: Route; editIds: string[] | null; canEdit: boolean; canAssign: boolean; busy: boolean;
  onEdit: () => void; onMove: (index: number, delta: -1 | 1) => void; onAssign: (stop: StopRow) => void; onDone: () => void;
}) {
  const byId = new Map(route.stops.map((stop) => [stop.id, stop]));
  const stops = editIds ? editIds.map((id) => byId.get(id)).filter((stop): stop is StopRow => Boolean(stop)) : route.stops;
  const count = `${route.stops.length} ${route.stops.length === 1 ? "stop" : "stops"}`;
  const hasOverlap = route.overlaps.size > 0;
  return (
    <View style={styles.card}>
      <View style={styles.routeHead}>
        {route.driverId ? <Avatar name={route.driverName} size={40} /> : (
          <View style={styles.unassignedAvatar}><Text style={styles.unassignedMark}>?</Text></View>
        )}
        <View style={styles.flex}>
          <Text style={styles.customer}>{route.driverName}</Text>
          <Text style={[styles.meta, hasOverlap && styles.warnText]}>{hasOverlap ? `${count} · time overlap` : count}</Text>
        </View>
        {canEdit ? (editIds ? <Button label="Done" size="md" loading={busy} onPress={onDone} /> : <Button label="Edit route" type="secondary" size="md" onPress={onEdit} />) : null}
      </View>
      {stops.map((stop, index) => {
        const overlap = route.overlaps.has(stop.id);
        const name = customerName(stop.orders?.customers) ?? "Customer";
        return (
          <View key={stop.id} style={styles.stopRow}>
            <View style={styles.rail}>
              <View style={styles.stopNumber}><Text style={styles.stopNumberText}>{index + 1}</Text></View>
              {index < stops.length - 1 ? <View style={styles.railLine} /> : null}
            </View>
            <View style={styles.flex}>
              <View style={styles.stopTitle}>
                <TimePill label={stopTimeText(stop)} tone={overlap ? "warning" : stopTimeText(stop) === "Not specified" ? "muted" : "brand"} small />
                <Text style={styles.stopName} numberOfLines={1}>{name}</Text>
              </View>
              <Text style={styles.meta} numberOfLines={1}>{stop.orders?.customers?.delivery_address ?? "No address recorded"}</Text>
            </View>
            {editIds ? (
              <View style={styles.editButtons}>
                <SmallIconButton icon="chevron-down" up label={`Move ${name} up`} disabled={index === 0} onPress={() => onMove(index, -1)} />
                <SmallIconButton icon="chevron-down" label={`Move ${name} down`} disabled={index === stops.length - 1} onPress={() => onMove(index, 1)} />
                {canAssign ? <SmallIconButton icon="user" label={`Assign a driver to ${name}`} tinted onPress={() => onAssign(stop)} /> : null}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function SmallIconButton({ icon, label, onPress, disabled, up, tinted }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; up?: boolean; tinted?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.smallButton, tinted && styles.smallButtonTinted, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <View style={up ? styles.flip : undefined}><Icon name={icon} size={16} color={tinted ? colors.primary : colors.text} /></View>
    </Pressable>
  );
}

function TimePill({ label, tone, small }: { label: string; tone: "warning" | "brand" | "muted"; small?: boolean }) {
  const palette = tone === "warning" ? { bg: colors.warningSoft, fg: colors.warning } : tone === "muted" ? { bg: colors.surfaceMuted, fg: colors.textSecondary } : { bg: colors.primarySoft, fg: colors.primary };
  return (
    <View style={[styles.pill, small && styles.pillSmall, { backgroundColor: palette.bg }]}>
      {small ? null : <Icon name="clock" size={15} color={palette.fg} />}
      <Text style={[small ? styles.pillTextSmall : styles.pillText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Delivery Card and Delivered Card
// ---------------------------------------------------------------------------

function DeliveryCard({ stop, when, overlap, late, canAssign, canComplete, onAssign, onDeliver }: {
  stop: StopRow; when: string; overlap: boolean; late: boolean; canAssign: boolean; canComplete: boolean; onAssign: () => void; onDeliver: () => void;
}) {
  const customer = stop.orders?.customers;
  const assigned = Boolean(stop.assigned_driver_id);
  const queued = useDeliveryQueued(stop.id);
  const repacking = stopIsRepacking(stop);
  return (
    <View style={[styles.card, (overlap || late) && styles.cardWarn]}>
      <View style={styles.cardTop}>
        <TimePill label={when} tone={overlap || late ? "warning" : when.endsWith("Not specified") ? "muted" : "brand"} />
        <StatusBadge label={repacking ? "Repacking" : stop.status === "for_delivery" ? "Out for delivery" : "To deliver"} tone={repacking ? "warning" : "success"} />
      </View>
      {overlap ? <Text style={styles.warnNote}>Time overlaps another stop on this route</Text> : null}
      <Pressable accessibilityRole="button" accessibilityHint="Opens the delivery" onPress={() => router.push({ pathname: "/deliveries/[id]", params: { id: stop.id } })} style={({ pressed }) => [styles.cardBody, pressed && styles.pressed]}>
        <Text style={styles.customerLarge}>{customerName(customer) ?? "Customer"}</Text>
        <View style={styles.line}>
          <Icon name="map-pin" size={15} color={colors.textSecondary} />
          <Text style={styles.lineText}>{customer?.delivery_address ?? "No address recorded"}</Text>
        </View>
      </Pressable>
      <View style={styles.driverRow}>
        <Icon name="user" size={15} color={colors.textSecondary} />
        <Text style={styles.lineText}>Driver: <Text style={assigned ? styles.driverName : styles.unassigned}>{assigned ? driverName(stop) : "Unassigned"}</Text></Text>
        {canAssign ? (
          <Pressable accessibilityRole="button" accessibilityLabel={assigned ? `Change driver for ${customerName(customer) ?? "this stop"}` : `Assign a driver to ${customerName(customer) ?? "this stop"}`} onPress={onAssign} style={({ pressed }) => [styles.assignChip, pressed && styles.pressed]}>
            <Text style={styles.assignChipText}>{assigned ? "Change" : "Assign Driver"}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.small}>{itemsText(stop)}</Text>
      <QueuedDeliveryNote deliveryId={stop.id} />
      {repacking ? <Text style={styles.warnNote}>The order was changed and is being repacked. Mark it delivered once packing is finished.</Text> : null}
      {canComplete && !repacking ? (
        <View style={styles.actions}>
          <SquareButton icon="phone" label="Call customer" disabled={!customer?.phone} onPress={() => void callPhone(customer?.phone ?? "")} />
          <SquareButton icon="navigation" label="Directions" disabled={!customer?.delivery_address} onPress={() => void openDirections(customer?.delivery_address ?? "")} />
          <Button label={queued ? "Saved offline" : "Mark delivered"} icon="check-check" size="lg" onPress={onDeliver} disabled={queued} style={styles.flex} />
        </View>
      ) : null}
    </View>
  );
}

function SquareButton({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.square, disabled && styles.disabled, pressed && styles.pressed]}>
      <Icon name={icon} size={20} color={colors.primary} />
    </Pressable>
  );
}

function DeliveredCard({ stop, today }: { stop: StopRow; today: string }) {
  const customer = stop.orders?.customers;
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <TimePill label={stop.completed_at ? deliveredLabel(stop.completed_at, today) : "Delivered"} tone="brand" />
        <StatusBadge label="Delivered" tone="neutral" />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.customerLarge}>{customerName(customer) ?? "Customer"}</Text>
        <View style={styles.line}>
          <Icon name="map-pin" size={15} color={colors.textSecondary} />
          <Text style={styles.lineText}>{customer?.delivery_address ?? "No address recorded"}</Text>
        </View>
        <View style={styles.line}>
          <Icon name="user" size={15} color={colors.textSecondary} />
          <Text style={styles.lineText}>Driver: <Text style={styles.driverName}>{stop.assigned_driver_id ? driverName(stop) : "Unassigned"}</Text></Text>
        </View>
        <Text style={styles.small}>{itemsText(stop)}</Text>
      </View>
      <View style={styles.doneRow}>
        <Icon name="check-circle" size={16} color={colors.primary} />
        <Text style={styles.doneText}>Delivered{stop.received_by ? <Text style={styles.receivedBy}>{`  · received by ${stop.received_by}`}</Text> : null}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Delivery receipt for ${stop.orders?.order_number ?? "this order"}`} onPress={() => router.push({ pathname: "/orders/[id]/receipt", params: { id: stop.order_id } })} hitSlop={8} style={({ pressed }) => [styles.receiptLink, pressed && styles.pressed]}>
          <Icon name="file-text" size={14} color={colors.primary} />
          <Text style={styles.receiptLinkText}>Receipt</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

function AssignDriverSheet({ stop, drivers, loading, busy, onChoose, onClose }: { stop: StopRow | null; drivers: DriverOption[]; loading: boolean; busy: boolean; onChoose: (driver: DriverOption | null) => void; onClose: () => void }) {
  return (
    <BottomSheet visible={stop !== null} onClose={onClose}>
      <View>
        <Text style={styles.sheetTitle}>Assign Driver to Order</Text>
        <Text style={styles.sheetCaption}>Select a driver for this delivery dispatch{stop?.orders ? ` (${stop.orders.order_number})` : ""}:</Text>
      </View>
      {loading ? <LoadingState message="Loading drivers..." /> : drivers.length ? drivers.map((driver) => {
        const current = driver.id === stop?.assigned_driver_id;
        return (
          <Pressable
            key={driver.id}
            accessibilityRole="button"
            accessibilityLabel={`${driver.full_name}, ${driverStopsText(Number(driver.open_stops))}${current ? ", assigned now" : ""}`}
            disabled={busy || current}
            onPress={() => onChoose(driver)}
            style={({ pressed }) => [styles.driverOption, current && styles.driverOptionCurrent, pressed && styles.pressed]}
          >
            <Avatar name={driver.full_name} size={36} />
            <View style={styles.flex}>
              <Text style={styles.customer}>{driver.full_name}</Text>
              <Text style={styles.meta}>{current ? "Assigned now" : driverStopsText(Number(driver.open_stops))}</Text>
            </View>
            {current ? <Icon name="check" size={18} color={colors.primary} /> : <Icon name="chevron-right" size={18} color={colors.textMuted} />}
          </Pressable>
        );
      }) : <Text style={styles.sheetCaption}>No active delivery staff. Add one in Accounts.</Text>}
      {stop?.assigned_driver_id ? <Button label="Leave unassigned" type="outline" size="lg" disabled={busy} onPress={() => onChoose(null)} /> : null}
      <Button label="Cancel" type="muted" size="lg" onPress={onClose} />
    </BottomSheet>
  );
}

function ConfirmDeliverySheet({ stop, busy, onConfirm, onClose }: { stop: StopRow | null; busy: boolean; onConfirm: (receivedBy: string) => void; onClose: () => void }) {
  return (
    <BottomSheet visible={stop !== null} onClose={onClose}>
      {stop ? <ConfirmBody key={stop.id} stop={stop} busy={busy} onConfirm={onConfirm} /> : null}
    </BottomSheet>
  );
}

function ConfirmBody({ stop, busy, onConfirm }: { stop: StopRow; busy: boolean; onConfirm: (receivedBy: string) => void }) {
  const [receivedBy, setReceivedBy] = useState("");
  return (
    <>
      <Text style={styles.sheetTitle}>Confirm delivery</Text>
      <View style={styles.confirmStop}>
        <Icon name="map-pin" size={18} color={colors.primary} />
        <View style={styles.flex}>
          <Text style={styles.customer}>{customerName(stop.orders?.customers) ?? "Customer"}</Text>
          <Text style={styles.meta}>{itemsText(stop)}</Text>
        </View>
      </View>
      <FormInput icon="user" label="Received by (optional)" placeholder="Name of the person who received it" value={receivedBy} onChangeText={setReceivedBy} autoCapitalize="words" maxLength={80} />
      <Button label="Delivered" icon="check-check" size="lg" loading={busy} onPress={() => onConfirm(receivedBy)} />
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 120, gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.4 },
  flip: { transform: [{ rotate: "180deg" }] },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs },
  section: { ...text.heading, color: colors.text },
  sectionHint: { ...text.caption, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.lg, gap: 10, ...shadows.card },
  cardWarn: { borderColor: colors.warningBorder },
  routeHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  unassignedAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.warningSoft, alignItems: "center", justifyContent: "center" },
  unassignedMark: { ...text.heading, color: colors.warning },
  customer: { ...text.bodyStrong, color: colors.text },
  customerLarge: { ...text.heading, color: colors.text },
  meta: { ...text.caption, color: colors.textSecondary },
  warnText: { ...text.captionStrong, color: colors.warning },
  stopRow: { flexDirection: "row", gap: spacing.sm, minHeight: 50 },
  rail: { width: 22, alignItems: "center" },
  stopNumber: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginTop: 2 },
  stopNumberText: { ...text.captionStrong, fontSize: 12, color: colors.onBrand },
  railLine: { flex: 1, width: 2, backgroundColor: colors.primaryMuted, marginTop: 2 },
  stopTitle: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stopName: { ...text.label, color: colors.text, flex: 1 },
  editButtons: { flexDirection: "row", gap: 6, alignItems: "flex-start" },
  smallButton: { width: 30, height: 30, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  smallButtonTinted: { backgroundColor: colors.primarySoft, borderColor: colors.primarySoft },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radii.sm, paddingVertical: 5, paddingHorizontal: spacing.sm, alignSelf: "flex-start" },
  pillSmall: { paddingVertical: 2, paddingHorizontal: 6, borderRadius: 6 },
  pillText: { ...text.label, fontSize: 14 },
  pillTextSmall: { ...text.captionStrong, fontSize: 12 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  warnNote: { ...text.caption, color: colors.warning, marginTop: -4 },
  cardBody: { gap: 6 },
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  lineText: { ...text.caption, color: colors.textSecondary, flex: 1 },
  driverRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  driverName: { ...text.captionStrong, color: colors.text },
  unassigned: { ...text.captionStrong, color: colors.textSecondary },
  assignChip: { borderWidth: 1, borderColor: colors.primaryMuted, backgroundColor: colors.primarySoft, borderRadius: radii.sm, paddingHorizontal: 8, paddingVertical: 3 },
  assignChipText: { ...text.captionStrong, fontSize: 12, color: colors.primary },
  small: { ...text.caption, fontSize: 12, color: colors.textMuted },
  actions: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  square: { width: 52, height: 52, borderRadius: radii.md, borderWidth: 1, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  doneRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  doneText: { ...text.captionStrong, color: colors.primary, flex: 1 },
  receivedBy: { ...text.caption, color: colors.primary },
  receiptLink: { flexDirection: "row", alignItems: "center", gap: 4 },
  receiptLinkText: { ...text.captionStrong, color: colors.primary },
  sheetTitle: { ...text.title, color: colors.text },
  sheetCaption: { ...text.caption, color: colors.textSecondary, marginTop: 4 },
  driverOption: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md },
  driverOptionCurrent: { borderColor: colors.primaryMuted, backgroundColor: colors.primarySoft },
  confirmStop: { flexDirection: "row", gap: 10, backgroundColor: colors.background, borderRadius: radii.md, padding: spacing.md },
});
