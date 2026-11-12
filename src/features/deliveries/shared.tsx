import { useCallback, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { BottomSheet, FormInput, PrimaryButton } from "@/components";
import { colors, radii, spacing, typography } from "@/constants/theme";
import { useRequestIds } from "@/services/data";
import { NotQueuedError, useOffline, useQueuedChange } from "@/services/offline";
import type { StatusTone } from "@/types/ui";

export type DeliveryStatus = "scheduled" | "for_delivery" | "completed" | "cancelled";

export const DELIVERY_STATUS_META: Record<DeliveryStatus, { label: string; tone: StatusTone }> = {
  scheduled: { label: "To deliver", tone: "success" },
  for_delivery: { label: "Out for delivery", tone: "info" },
  completed: { label: "Delivered", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },
};

export type DeliverOutcome =
  | { status: "done"; drLabel: string | null }
  | { status: "queued" }
  | { status: "not_saved" }
  | { status: "error"; error: Error };

type DeliverTarget = { id: string; scheduled_date: string; orders?: { order_number?: string; updated_at?: string; packing_version?: number } | null };

/**
 * Marks a stop delivered: one server call marks the stop delivered, completes
 * the order and issues the receipt (complete_delivery, Phase 6). It goes
 * through offline_complete_delivery so it can be queued offline (Phase 10);
 * the same request id is kept until it's done, so a retry is applied once.
 * What the driver saw (the day and the order's last change) is sent along, so
 * a stop that was reassigned, rescheduled or changed meanwhile is refused for
 * review instead of being overwritten. The order's packing version goes too:
 * the server refuses "delivered" for an order whose items changed since this
 * screen loaded, or that is being repacked.
 */
export function useMarkDelivered() {
  const offline = useOffline();
  const ids = useRequestIds();
  const client = useQueryClient();
  return useCallback(async (delivery: DeliverTarget, receivedBy: string, orderUpdatedAt?: string, orderPackingVersion?: number): Promise<DeliverOutcome> => {
    const name = receivedBy.trim();
    const seenUpdatedAt = orderUpdatedAt ?? delivery.orders?.updated_at;
    const packingVersion = orderPackingVersion ?? delivery.orders?.packing_version;
    const key = `complete:${delivery.id}:${name}:${packingVersion ?? ""}`;
    try {
      const outcome = await offline.run<{ dr_label?: string | null }>({
        id: ids.idFor(key),
        rpc: "offline_complete_delivery",
        args: { p_delivery_id: delivery.id, p_received_by: name || null },
        seen: { scheduled_date: delivery.scheduled_date, ...(seenUpdatedAt ? { order_updated_at: seenUpdatedAt } : {}), ...(packingVersion != null ? { packing_version: packingVersion } : {}) },
        label: `Mark delivered · ${delivery.orders?.order_number ?? "delivery"}`,
        targetId: delivery.id,
      });
      ids.done(key);
      if (outcome.queued) return { status: "queued" };
      await Promise.all([client.invalidateQueries({ queryKey: ["deliveries"] }), client.invalidateQueries({ queryKey: ["orders"] })]);
      return { status: "done", drLabel: outcome.result?.dr_label ?? null };
    } catch (error) {
      if (error instanceof NotQueuedError) return { status: "not_saved" };
      ids.done(key);
      return { status: "error", error: error instanceof Error ? error : new Error(String(error)) };
    }
  }, [offline, ids, client]);
}

/** Shown on a stop while its "delivered" is waiting to sync or needs review. */
export function QueuedDeliveryNote({ deliveryId }: { deliveryId: string }) {
  const queued = useQueuedChange(deliveryId);
  if (!queued || queued.status === "synced") return null;
  const review = queued.status === "rejected";
  return (
    <Pressable accessibilityRole="button" accessibilityHint="Opens offline changes" onPress={() => router.push("/sync")} style={[styles.queued, review && styles.queuedReview]}>
      <Ionicons name={review ? "alert-circle" : queued.status === "syncing" ? "sync" : "cloud-upload-outline"} size={16} color={review ? colors.warning : colors.info} />
      <Text style={[styles.queuedText, review && styles.queuedTextReview]}>
        {review ? `Delivered wasn’t saved: ${queued.rejection?.reason ?? "needs review"}` : queued.status === "syncing" ? "Sending “delivered”…" : "Marked delivered offline · waiting to sync"}
      </Text>
    </Pressable>
  );
}

/** True while a "delivered" for this stop is waiting or sending, so it isn't offered twice. */
export function useDeliveryQueued(deliveryId: string) {
  const queued = useQueuedChange(deliveryId);
  return queued?.status === "pending" || queued?.status === "syncing";
}

type DeliverSheetProps = {
  target: { customer: string; summary: string } | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (receivedBy: string) => void;
};

export function DeliverSheet({ target, busy, onClose, onConfirm }: DeliverSheetProps) {
  return (
    <BottomSheet visible={target !== null} onClose={onClose}>
      {target ? <DeliverSheetBody key={target.summary} target={target} busy={busy} onConfirm={onConfirm} /> : null}
    </BottomSheet>
  );
}

function DeliverSheetBody({ target, busy, onConfirm }: { target: { customer: string; summary: string }; busy: boolean; onConfirm: (receivedBy: string) => void }) {
  const [receivedBy, setReceivedBy] = useState("");
  return (
    <>
      <Text style={styles.title}>Confirm delivery</Text>
      <View style={styles.stop}>
        <Ionicons name="location" size={18} color={colors.primary} style={styles.stopIcon} />
        <View style={styles.flex}>
          <Text style={styles.customer}>{target.customer}</Text>
          <Text style={styles.summary}>{target.summary}</Text>
        </View>
      </View>
      <FormInput label="Received by (optional)" value={receivedBy} onChangeText={setReceivedBy} placeholder="Name of the person who received it" autoCapitalize="words" />
      <PrimaryButton label="Delivered" size="lg" icon={<Ionicons name="checkmark-done" size={20} color={colors.surface} />} onPress={() => onConfirm(receivedBy)} loading={busy} />
    </>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 18, fontWeight: "700", color: colors.text },
  stop: { flexDirection: "row", gap: 10, backgroundColor: colors.background, borderRadius: radii.md, padding: spacing.md },
  stopIcon: { marginTop: 1 },
  flex: { flex: 1 },
  customer: { ...typography.bodyMedium, color: colors.text },
  summary: { ...typography.caption, color: colors.textSecondary },
  queued: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.infoSoft, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: 10 },
  queuedReview: { backgroundColor: colors.warningSoft },
  queuedText: { ...typography.caption, color: colors.info, flex: 1 },
  queuedTextReview: { color: colors.warning },
});
