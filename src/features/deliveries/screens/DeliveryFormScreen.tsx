import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { Card, Chip, DateStrip, EmptyState, FormInput, LoadingState, PrimaryButton, Screen, useToast } from "@/components";
import { colors, radii, spacing, typography } from "@/constants/theme";
import { supabase } from "@/services/supabase";
import { dayLabel, daysFromToday, toISODate } from "@/utils/format";
import { customerName } from "@/utils/customer";

type ReadyOrder = { id: string; order_number: string; requested_delivery_date: string; notes: string | null; customers: { business_name: string; brand_name?: string | null; delivery_address: string | null } | null; deliveries: { id: string }[] | null };
type Driver = { id: string; full_name: string | null; email: string };

// A requested date in the past is not a useful default; start from today instead.
function defaultDate(order: ReadyOrder) {
  return daysFromToday(order.requested_delivery_date) < 0 ? toISODate(new Date()) : order.requested_delivery_date;
}

export function DeliveryFormScreen({ initialOrderId }: { initialOrderId?: string }) {
  const toast = useToast();
  const [orders, setOrders] = useState<ReadyOrder[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selected, setSelected] = useState<ReadyOrder | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState("");
  const [notes, setNotes] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      supabase.from("orders").select("id,order_number,requested_delivery_date,notes,customers(business_name,brand_name,delivery_address),deliveries(id)").eq("status", "for_delivery").order("requested_delivery_date"),
      supabase.from("profiles").select("id,full_name,email").eq("role", "delivery_staff").eq("status", "active").order("full_name"),
    ]).then(([orderResult, driverResult]) => {
      if (!active) return;
      const ready = ((orderResult.data ?? []) as unknown as ReadyOrder[]).filter((order) => !order.deliveries?.length);
      setOrders(ready);
      setDrivers((driverResult.data ?? []) as Driver[]);
      const initial = ready.find((order) => order.id === initialOrderId);
      if (initial) {
        setSelected(initial);
        setDate(defaultDate(initial));
        setNotes(initial.notes ?? "");
      }
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [initialOrderId]);

  function choose(order: ReadyOrder) {
    setSelected(order);
    setDate(defaultDate(order));
    setNotes(order.notes ?? "");
  }

  async function save() {
    if (!selected || !date) return;
    setSaving(true);
    const { data, error } = await supabase.rpc("create_delivery", { p_order_id: selected.id, p_scheduled_date: date, p_scheduled_time: time.trim() || null, p_assigned_driver_id: driverId, p_notes: notes.trim() || null });
    setSaving(false);
    if (error) {
      Alert.alert("Unable to schedule delivery", error.message);
      return;
    }
    toast(`${selected.order_number} scheduled for ${dayLabel(date).toLowerCase()}`);
    router.replace({ pathname: "/deliveries/[id]", params: { id: data as string } });
  }

  return (
    <Screen
      title="Schedule delivery"
      showBackButton
      keyboardAware
      footer={selected ? <PrimaryButton label="Schedule delivery" size="lg" onPress={() => void save()} disabled={!date} loading={saving} style={styles.flex} /> : undefined}
      contentStyle={styles.content}
    >
      {!loaded ? <LoadingState message="Loading packed orders..." /> : !selected ? (
        <>
          <Text style={styles.question}>Which order is going out?</Text>
          {orders.length ? orders.map((order) => (
            <Pressable key={order.id} accessibilityRole="button" onPress={() => choose(order)} style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}>
              <View style={styles.flex}>
                <Text style={styles.optionMeta}>{order.order_number} · Requested {dayLabel(order.requested_delivery_date)}</Text>
                <Text style={styles.optionTitle}>{customerName(order.customers) ?? "Customer"}</Text>
                <Text style={styles.optionMeta} numberOfLines={1}>{order.customers?.delivery_address ?? "No address recorded"}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          )) : <Card><EmptyState icon="car-outline" title="Nothing to schedule" description="Orders appear here once packing is complete." /></Card>}
        </>
      ) : (
        <>
          <View style={styles.selected}>
            <View style={styles.flex}>
              <Text style={styles.optionMeta}>{selected.order_number}</Text>
              <Text style={styles.optionTitle}>{customerName(selected.customers) ?? "Customer"}</Text>
              <Text style={styles.optionMeta}>{selected.customers?.delivery_address ?? "No address recorded"}</Text>
            </View>
            {!initialOrderId ? (
              <Pressable accessibilityRole="button" onPress={() => setSelected(null)} hitSlop={8}>
                <Text style={styles.link}>Change</Text>
              </Pressable>
            ) : null}
          </View>
          <DateStrip label="Delivery date" value={date} onChange={setDate} />
          <FormInput label="Time (optional)" value={time} onChangeText={setTime} placeholder="e.g. 10:30 or 14:00" keyboardType="numbers-and-punctuation" />
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Driver</Text>
            <View style={styles.chips}>
              <Chip variant="choice" label="Unassigned" selected={driverId === null} onPress={() => setDriverId(null)} />
              {drivers.map((driver) => <Chip key={driver.id} variant="choice" label={driver.full_name ?? driver.email} selected={driverId === driver.id} onPress={() => setDriverId(driver.id)} />)}
            </View>
          </View>
          <FormInput label="Notes for the driver (optional)" value={notes} onChangeText={setNotes} placeholder="e.g. Use the back entrance" multiline style={styles.notes} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.xl, gap: 14 },
  flex: { flex: 1 },
  question: { ...typography.headline, color: colors.text },
  option: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingVertical: spacing.md, paddingHorizontal: 14 },
  optionPressed: { backgroundColor: colors.surfacePressed },
  optionTitle: { ...typography.bodyMedium, color: colors.text },
  optionMeta: { ...typography.caption, color: colors.textSecondary },
  selected: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, backgroundColor: colors.primarySoft, borderRadius: radii.md, padding: 14 },
  link: { fontSize: 13, fontWeight: "700", color: colors.primary },
  field: { gap: spacing.sm },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  notes: { minHeight: 76, textAlignVertical: "top", paddingTop: spacing.md },
});
