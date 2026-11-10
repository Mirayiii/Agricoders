import { useCallback, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";

import { Card, Chip, DateStrip, EmptyState, FormInput, LoadingState, PrimaryButton, Screen, SecondaryButton, StatusBadge, useToast } from "@/components";
import { PERMISSIONS } from "@/constants/permissions";
import { colors, radii, shadows, spacing, typography } from "@/constants/theme";
import { useAuth, usePermission } from "@/features/auth";
import { unwrap } from "@/services/data";
import { supabase } from "@/services/supabase";
import { dayLabel, formatMoney, formatQuantity, formatTime, plural, relativeTime } from "@/utils/format";
import { callPhone, openDirections } from "@/utils/links";
import { customerName } from "@/utils/customer";
import { canCompleteDelivery } from "../deliveriesLogic";
import { DELIVERY_STATUS_META, DeliverSheet, QueuedDeliveryNote, useDeliveryQueued, useMarkDelivered, type DeliveryStatus } from "../shared";

type Driver = { id: string; full_name: string | null; email: string };
type Delivery = {
  id: string;
  order_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  status: DeliveryStatus;
  notes: string | null;
  received_by: string | null;
  completed_at: string | null;
  profiles: Driver | null;
  orders: { order_number: string; updated_at?: string; order_total?: number | null; customers: { business_name: string; brand_name?: string | null; contact_person: string | null; phone: string | null; delivery_address: string | null } | null; order_items: { id: string; quantity: number; unit_of_measurement: string; products: { product_name: string } | null }[] } | null;
};

const DETAIL_COLUMNS = "id,order_id,scheduled_date,scheduled_time,status,notes,received_by,completed_at,profiles!deliveries_assigned_driver_id_fkey(id,full_name,email),orders(order_number,updated_at,order_total,customers(business_name,brand_name,contact_person,phone,delivery_address),order_items(id,quantity,unit_of_measurement,products(product_name)))";

const driverName = (driver: Driver | null) => driver?.full_name ?? driver?.email ?? "Unassigned";

export function DeliveryDetailsScreen({ deliveryId }: { deliveryId?: string }) {
  const toast = useToast();
  const canManage = usePermission(PERMISSIONS.manageDeliveries);
  const me = useAuth().profile;
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState("");
  const [driverId, setDriverId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  // Kept in the query cache (and saved for offline use) so a stop can be read without a connection.
  const detail = useQuery({
    queryKey: ["deliveries", "detail", deliveryId ?? ""],
    enabled: Boolean(deliveryId),
    queryFn: async () => (await unwrap(supabase.from("deliveries").select(DETAIL_COLUMNS).eq("id", deliveryId ?? "").maybeSingle())) as unknown as Delivery | null,
  });
  const driverList = useQuery({
    queryKey: ["deliveries", "driver-list"],
    enabled: canManage,
    queryFn: async () => (await unwrap(supabase.from("profiles").select("id,full_name,email").eq("role", "delivery_staff").eq("status", "active").order("full_name"))) as Driver[],
  });
  const delivery = detail.data ?? null;
  const drivers = driverList.data ?? [];
  const { refetch } = detail;
  const load = useCallback(async () => { await refetch(); }, [refetch]);
  const markDelivered = useMarkDelivered();
  const queued = useDeliveryQueued(deliveryId ?? "");

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (detail.isPending && deliveryId) return <Screen title="Delivery" showBackButton><LoadingState message="Loading delivery..." /></Screen>;
  if (!delivery) {
    const offline = detail.isError;
    return (
      <Screen title="Delivery" showBackButton>
        <Card>
          <EmptyState
            title={offline ? "Couldn’t load this delivery" : "Delivery unavailable"}
            description={offline ? "It hasn’t been saved on this device yet. Open it once while online to read it offline." : "This delivery could not be found or is outside your access."}
            icon="alert-circle-outline"
          />
        </Card>
      </Screen>
    );
  }

  const current = delivery;
  const customer = current.orders?.customers;
  const meta = DELIVERY_STATUS_META[current.status];
  const isOpen = current.status === "scheduled" || current.status === "for_delivery";
  const items = current.orders?.order_items ?? [];

  function startEditing() {
    setDate(current.scheduled_date);
    setTime(current.scheduled_time?.slice(0, 5) ?? "");
    setDriverId(current.profiles?.id ?? null);
    setNotes(current.notes ?? "");
    setEditing(true);
  }

  async function saveSchedule() {
    if (!date) return;
    setBusy(true);
    const { error } = await supabase.rpc("reschedule_delivery", { p_delivery_id: current.id, p_scheduled_date: date, p_scheduled_time: time.trim() || null, p_assigned_driver_id: driverId, p_notes: notes.trim() || null });
    setBusy(false);
    if (error) {
      Alert.alert("Unable to save schedule", error.message);
      return;
    }
    setEditing(false);
    toast("Delivery schedule saved");
    void load();
  }

  async function confirm(receivedBy: string) {
    setBusy(true);
    const outcome = await markDelivered(current, receivedBy);
    setBusy(false);
    if (outcome.status === "not_saved") return;
    if (outcome.status === "error") {
      Alert.alert("Unable to confirm delivery", outcome.error.message);
      void load();
      return;
    }
    setConfirming(false);
    const order = current.orders?.order_number ?? "Delivery";
    toast(outcome.status === "queued" ? `${order} saved offline. It will be sent when you’re back online.` : `${order} marked delivered`);
    if (outcome.status === "done") void load();
  }

  function cancelDelivery() {
    Alert.alert("Cancel this delivery?", "The delivery record is kept, but this order cannot be given a new delivery afterwards.", [
      { text: "Keep", style: "cancel" },
      {
        text: "Cancel delivery",
        style: "destructive",
        onPress: () => void supabase.rpc("update_delivery_status", { p_delivery_id: current.id, p_status: "cancelled" }).then(({ error }) => {
          if (error) Alert.alert("Unable to cancel delivery", error.message);
          else {
            toast("Delivery cancelled");
            void load();
          }
        }),
      },
    ]);
  }

  const time12 = formatTime(current.scheduled_time);

  return (
    <Screen
      title="Delivery"
      showBackButton
      keyboardAware
      footer={isOpen && !editing && !queued && canCompleteDelivery(me?.role, current.profiles?.id, me?.id) ? <PrimaryButton label="Mark delivered" size="lg" icon={<Ionicons name="checkmark-done" size={20} color={colors.surface} />} onPress={() => setConfirming(true)} style={styles.flex} /> : undefined}
      contentStyle={styles.content}
    >
      <View style={styles.summary}>
        <View style={styles.summaryTop}>
          <StatusBadge label={meta.label} tone={meta.tone} />
          <Text style={styles.muted}>{dayLabel(current.scheduled_date)}{time12 ? `, ${time12}` : ""}</Text>
        </View>
        <Text style={styles.customerName}>{customerName(customer) ?? "Customer"}</Text>
        <Text style={styles.summaryLine}>{current.orders?.order_number} · {plural(items.length, "item")}{current.orders?.order_total != null ? ` · Total ${formatMoney(Number(current.orders.order_total))}` : ""}</Text>
      </View>

      <QueuedDeliveryNote deliveryId={current.id} />

      <View style={styles.quick}>
        <QuickAction icon="call-outline" label="Call" disabled={!customer?.phone} onPress={() => void callPhone(customer?.phone ?? "")} />
        <QuickAction icon="navigate-outline" label="Directions" disabled={!customer?.delivery_address} onPress={() => void openDirections(customer?.delivery_address ?? "")} />
        <QuickAction icon="receipt-outline" label="Order" onPress={() => router.push({ pathname: "/orders/[id]", params: { id: current.order_id } })} />
      </View>

      {current.status === "completed" ? (
        <View style={styles.delivered}>
          <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
          <Text style={styles.deliveredText}>Delivered{current.completed_at ? ` ${relativeTime(current.completed_at)}` : ""}{current.received_by ? ` · received by ${current.received_by}` : ""}</Text>
        </View>
      ) : null}

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Drop-off</Text>
        <Info label="Contact" value={[customer?.contact_person, customer?.phone].filter(Boolean).join(" · ") || "Not recorded"} />
        <Info label="Address" value={customer?.delivery_address ?? "No address recorded"} />
        {current.notes ? <Info label="Delivery notes" value={current.notes} /> : null}
      </Card>

      <Card style={styles.section}>
        <Text style={styles.sectionTitle}>Items</Text>
        {items.map((item, index) => (
          <View key={item.id} style={[styles.item, index < items.length - 1 && styles.itemDivider]}>
            <Text style={styles.itemName}>{item.products?.product_name ?? "Product"}</Text>
            <Text style={styles.itemQty}>{formatQuantity(Number(item.quantity))} {item.unit_of_measurement}</Text>
          </View>
        ))}
      </Card>

      <Card style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Schedule</Text>
          {canManage && isOpen && !editing ? (
            <Pressable accessibilityRole="button" onPress={startEditing} hitSlop={8}>
              <Text style={styles.link}>Change</Text>
            </Pressable>
          ) : null}
        </View>
        {editing ? (
          <>
            <DateStrip label="Delivery date" value={date} onChange={setDate} />
            <FormInput label="Time (optional)" value={time} onChangeText={setTime} placeholder="e.g. 10:30 or 14:00" keyboardType="numbers-and-punctuation" />
            <Text style={styles.fieldLabel}>Driver</Text>
            <View style={styles.chips}>
              <Chip variant="choice" label="Unassigned" selected={driverId === null} onPress={() => setDriverId(null)} />
              {drivers.map((driver) => <Chip key={driver.id} variant="choice" label={driverName(driver)} selected={driverId === driver.id} onPress={() => setDriverId(driver.id)} />)}
            </View>
            <FormInput label="Delivery notes" value={notes} onChangeText={setNotes} placeholder="Instructions for the driver" multiline style={styles.notes} />
            <PrimaryButton label="Save schedule" onPress={() => void saveSchedule()} disabled={!date} loading={busy} />
            <SecondaryButton label="Cancel" tone="neutral" onPress={() => setEditing(false)} />
          </>
        ) : (
          <>
            <Info label="When" value={`${dayLabel(current.scheduled_date)}${time12 ? `, ${time12}` : ""}`} />
            <Info label="Driver" value={driverName(current.profiles)} />
          </>
        )}
      </Card>

      {canManage && isOpen && !editing ? <SecondaryButton label="Cancel delivery" tone="danger" icon={<Ionicons name="close-circle-outline" size={19} color={colors.danger} />} onPress={cancelDelivery} /> : null}

      <DeliverSheet
        target={confirming ? { customer: customerName(customer) ?? "Customer", summary: `${current.orders?.order_number ?? ""} · ${plural(items.length, "item")}` } : null}
        busy={busy}
        onClose={() => setConfirming(false)}
        onConfirm={(receivedBy) => void confirm(receivedBy)}
      />
    </Screen>
  );
}

function QuickAction({ icon, label, onPress, disabled }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.quickItem, pressed && styles.quickPressed, disabled && styles.quickDisabled]}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  flex: { flex: 1 },
  summary: { gap: 6, paddingHorizontal: 2 },
  summaryTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  muted: { ...typography.caption, color: colors.textSecondary },
  customerName: { ...typography.title, letterSpacing: -0.2, color: colors.text },
  summaryLine: { ...typography.body, color: colors.textSecondary },
  quick: { flexDirection: "row", gap: spacing.sm },
  quickItem: { flex: 1, minHeight: 64, alignItems: "center", justifyContent: "center", gap: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, ...shadows.card },
  quickPressed: { backgroundColor: colors.surfacePressed },
  quickDisabled: { opacity: 0.4 },
  quickLabel: { ...typography.captionMedium, color: colors.primary },
  delivered: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.primarySoft, borderRadius: radii.lg, paddingVertical: 14, paddingHorizontal: spacing.lg },
  deliveredText: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.primary },
  section: { gap: spacing.md },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { ...typography.section, color: colors.text },
  link: { fontSize: 13, fontWeight: "700", color: colors.primary },
  fieldLabel: { ...typography.captionMedium, color: colors.textSecondary },
  infoValue: { ...typography.body, lineHeight: 20, color: colors.text },
  item: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, paddingBottom: spacing.md },
  itemDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  itemName: { ...typography.bodyMedium, color: colors.text, flex: 1 },
  itemQty: { ...typography.bodyMedium, fontWeight: "700", color: colors.text },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  notes: { minHeight: 76, textAlignVertical: "top", paddingTop: spacing.md },
});
