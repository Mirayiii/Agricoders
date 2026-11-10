import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";

import { Card, EmptyState, ErrorState, LoadingState, Screen, StatusBadge } from "@/components";
import { colors, spacing, typography } from "@/constants/theme";
import { savedAtLabel, unwrap } from "@/services/data";
import { supabase } from "@/services/supabase";

type Rejection = { id: string; action: string; kind: string; reason: string; queued_at: string; rejected_at: string; profiles: { full_name: string | null; username: string | null } | null };

const KIND: Record<string, string> = {
  conflict: "Changed since", expired: "Older than 30 days", permission: "No permission", error: "Refused", discarded: "Discarded", signed_out: "Signed out", price_changed: "Prices changed",
};

/** D-OF4: administrators see offline changes the server refused, or that people discarded while online. */
export function SyncProblemsScreen() {
  const query = useQuery({
    queryKey: ["sync-problems"],
    queryFn: () => unwrap<Rejection[]>(
      supabase.from("sync_rejections").select("id, action, kind, reason, queued_at, rejected_at, profiles(full_name, username)").order("rejected_at", { ascending: false }).limit(100).returns<Rejection[]>(),
    ),
  });
  return (
    <Screen title="Offline sync problems" showBackButton contentStyle={styles.content}>
      <Text style={styles.intro}>Offline changes the server refused, or that someone discarded while online. Changes discarded while a phone never reached the server can’t be listed.</Text>
      {query.isPending ? <LoadingState message="Loading..." /> : query.isError ? <Card><ErrorState description="Couldn't load sync problems." onRetry={() => void query.refetch()} /></Card>
        : query.data.length ? query.data.map((row) => (
          <Card key={row.id} style={styles.card}>
            <View style={styles.head}>
              <Text style={styles.action}>{row.action}</Text>
              <StatusBadge label={KIND[row.kind] ?? row.kind} tone={row.kind === "discarded" ? "neutral" : "warning"} />
            </View>
            <Text style={styles.who}>{row.profiles?.full_name ?? row.profiles?.username ?? "Unknown"} · saved {savedAtLabel(Date.parse(row.queued_at))} · refused {savedAtLabel(Date.parse(row.rejected_at))}</Text>
            <Text style={styles.reason}>{row.reason}</Text>
          </Card>
        )) : <Card><EmptyState icon="cloud-done-outline" title="No sync problems" description="Every offline change so far went through." /></Card>}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  intro: { ...typography.caption, lineHeight: 18, color: colors.textSecondary },
  card: { gap: 6 },
  head: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  action: { ...typography.bodyMedium, fontWeight: "600", color: colors.text, flex: 1 },
  who: { ...typography.caption, color: colors.textSecondary },
  reason: { ...typography.caption, lineHeight: 19, color: colors.text },
});
