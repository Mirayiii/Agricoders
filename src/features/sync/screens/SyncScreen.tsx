import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { BottomSheet, Button, Card, EmptyState, Screen, StatusBadge } from "@/components";
import { colors, radii, spacing, typography } from "@/constants/theme";
import { savedAtLabel } from "@/services/data";
import { canRemove, syncNow, useIsOnline, useOutbox, type OutboxAction } from "@/services/offline";
import { outboxStore } from "@/services/offline/outboxStore";
import { acceptPrices, remove } from "@/services/offline/outboxLogic";
import { formatMoney } from "@/utils/format";

const STATUS: Record<OutboxAction["status"], { label: string; tone: "neutral" | "info" | "success" | "warning" }> = {
  pending: { label: "Waiting to sync", tone: "neutral" },
  syncing: { label: "Syncing", tone: "info" },
  synced: { label: "Synced", tone: "success" },
  rejected: { label: "Needs review", tone: "warning" },
};

/** Changes made offline: what is waiting, being sent, refused (with the reason) or sent. */
export function SyncScreen() {
  const { items, durable, counts } = useOutbox();
  const online = useIsOnline();
  const [syncing, setSyncing] = useState(false);
  const [removing, setRemoving] = useState<OutboxAction | null>(null);
  const order: OutboxAction["status"][] = ["rejected", "syncing", "pending", "synced"];
  const sorted = [...items].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.queuedAt.localeCompare(a.queuedAt));

  return (
    <Screen title="Offline changes" showBackButton contentStyle={styles.content}>
      <Card style={styles.summary}>
        <Text style={styles.summaryTitle}>{online ? "You’re online" : "You’re offline"}</Text>
        <Text style={styles.caption}>
          {counts.pending + counts.syncing ? `${counts.pending + counts.syncing} waiting to sync. ` : "Nothing waiting to sync. "}
          {counts.rejected ? `${counts.rejected} need${counts.rejected === 1 ? "s" : ""} your review. ` : ""}
          {durable ? "Saved on this phone until they’re sent." : "Kept only until the app closes (“Keep me signed in” is off)."}
        </Text>
        {counts.pending ? (
          <Button label={online ? "Sync now" : "Sync now (you’re offline)"} size="md" disabled={!online} loading={syncing}
            onPress={() => { setSyncing(true); void syncNow().finally(() => setSyncing(false)); }} />
        ) : null}
      </Card>

      {sorted.length ? sorted.map((item) => <ChangeCard key={item.id} item={item} onRemove={() => setRemoving(item)} />) : (
        <Card><EmptyState icon="cloud-done-outline" title="No offline changes" description="Changes you make while offline show here until they’re sent." /></Card>
      )}

      <BottomSheet visible={removing !== null} onClose={() => setRemoving(null)}>
        {removing ? <RemoveConfirm item={removing} onClose={() => setRemoving(null)} /> : null}
      </BottomSheet>
    </Screen>
  );
}

function ChangeCard({ item, onRemove }: { item: OutboxAction; onRemove: () => void }) {
  const status = STATUS[item.status];
  const rejection = item.rejection;
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.label}>{item.label}</Text>
        <StatusBadge label={status.label} tone={status.tone} />
      </View>
      <Text style={styles.caption}>
        Saved {savedAtLabel(Date.parse(item.queuedAt))}
        {item.status === "synced" && item.syncedAt ? ` · Sent ${savedAtLabel(Date.parse(item.syncedAt))}` : ""}
        {item.status === "pending" && item.attempts ? ` · Tried ${item.attempts} time${item.attempts === 1 ? "" : "s"}` : ""}
      </Text>
      {rejection ? (
        <View style={styles.reason}>
          <Text style={styles.reasonText}>{rejection.reason}</Text>
          {rejection.priceChanges?.length ? (
            <View style={styles.prices}>
              {rejection.priceChanges.map((row) => (
                <Text key={`${row.product_id}:${row.unit}`} style={styles.priceRow}>
                  {row.product_name ?? "Item"} ({row.unit}): {formatMoney(row.seen_price)} → {formatMoney(row.current_price)}
                </Text>
              ))}
            </View>
          ) : null}
          {rejection.kind !== "price_changed" ? (
            <Text style={styles.small}>{rejection.reported ? "Administrators can see this." : "Will be shared with administrators when you’re online."}</Text>
          ) : null}
        </View>
      ) : null}
      {rejection?.kind === "price_changed" ? (
        <Button label="Send at current prices" size="md" onPress={() => void outboxStore.change((list) => acceptPrices(list, item.id)).then(() => syncNow())} />
      ) : null}
      {canRemove(item) && item.status !== "synced" ? (
        <Button label={item.status === "pending" ? "Cancel this change" : "Dismiss"} type="secondary" size="md" onPress={onRemove} />
      ) : null}
    </Card>
  );
}

function RemoveConfirm({ item, onClose }: { item: OutboxAction; onClose: () => void }) {
  const pending = item.status === "pending";
  return (
    <>
      <Text style={styles.sheetTitle} accessibilityRole="header">{pending ? "Cancel this change?" : "Dismiss this change?"}</Text>
      <Text style={styles.body}>
        {pending ? `“${item.label}” hasn’t been sent and will be removed from this phone. Nothing changes on the server.` : `“${item.label}” was not applied. Dismissing removes it from this list; nothing changes on the server.`}
      </Text>
      <Button label={pending ? "Cancel change" : "Dismiss"} type="danger" size="lg" onPress={() => void outboxStore.change((list) => remove(list, item.id)).then(onClose)} />
      <Button label="Keep it" type="secondary" size="lg" onPress={onClose} />
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  summary: { gap: spacing.sm },
  summaryTitle: { ...typography.bodyMedium, fontWeight: "700", color: colors.text },
  card: { gap: spacing.sm },
  head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  label: { ...typography.bodyMedium, fontWeight: "600", color: colors.text, flex: 1 },
  caption: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
  reason: { gap: 6, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.warningSoft },
  reasonText: { ...typography.caption, lineHeight: 19, color: colors.text },
  prices: { gap: 2 },
  priceRow: { ...typography.caption, fontWeight: "600", color: colors.text },
  small: { fontSize: 12, color: colors.textSecondary },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
  body: { ...typography.body, lineHeight: 22, color: colors.textSecondary },
});
