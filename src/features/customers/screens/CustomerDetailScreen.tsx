import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";

import { Avatar, BottomSheet, Button, Card, EmptyState, ErrorState, Icon, InlineAlert, LoadingState, Screen, StaleNotice, StatusBadge, useToast, type IconName } from "@/components";
import { PERMISSIONS } from "@/constants/permissions";
import { colors, radii, shadows, spacing, text } from "@/constants/theme";
import { usePermission } from "@/features/auth";
import { OfflineReadOnly } from "@/features/sync/OfflineReadOnly";
import { useIsOnline } from "@/services/offline";
import { ORDER_STATUS_META } from "@/features/orders/status";
import { DataError } from "@/services/data";
import { dayLabel, formatMoney } from "@/utils/format";
import { callPhone, openDirections } from "@/utils/links";
import { CustomerFormSheet } from "../CustomerFormSheet";
import { useCustomerHistory, useCustomerProfile, useSetCustomerArchived } from "../customersData";
import { customerName, historySummary, type CustomerProfile } from "../customersLogic";

function problemText(error: unknown): string {
  if (error instanceof DataError && error.code) return error.message;
  if (error instanceof Error && /fetch|network/i.test(error.message)) return "Couldn’t reach the server. Nothing was saved twice: try again.";
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

/** Figma "Customer detail". */
export function CustomerDetailScreen({ customerId = "" }: { customerId?: string }) {
  const toast = useToast();
  const canOrder = usePermission(PERMISSIONS.manageOrders);
  // The Customer statement row opens the statement, which is administrator-only.
  const canBill = usePermission(PERMISSIONS.viewReports);
  // Requirement CU-01: only the administrator archives (and restores) customers.
  const canArchive = usePermission(PERMISSIONS.archiveCustomers);
  const profile = useCustomerProfile(customerId);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const archive = useSetCustomerArchived();
  const online = useIsOnline();

  if (profile.isPending) return <Screen title="Customer" showBackButton><LoadingState message="Loading customer..." /></Screen>;
  if (!profile.data) {
    return (
      <Screen title="Customer" showBackButton>
        {profile.error instanceof DataError && profile.error.message === "Customer not found"
          ? <Card><EmptyState icon="alert-circle-outline" title="Customer unavailable" description="This customer could not be found." /></Card>
          : <ErrorState description="This customer couldn’t be loaded." onRetry={() => void profile.refetch()} />}
      </Screen>
    );
  }

  const data = profile.data;
  const customer = data.customer;
  const archived = customer.status === "archived";
  const name = customerName(customer) ?? customer.business_name;

  function setArchived(next: boolean) {
    archive.mutate({ customerId: customer.id, archived: next }, {
      onSuccess: () => {
        setConfirming(false);
        toast(next ? `${name} archived. Their orders are kept.` : `${name} restored`);
      },
    });
  }

  return (
    <Screen title={name} showBackButton contentStyle={styles.content} refreshing={profile.isRefetching} onRefresh={() => void profile.refetch()}>
      <StaleNotice query={profile} />
      <View style={styles.hero}>
        <Avatar name={name} size={56} />
        <View style={styles.flex}>
          <Text style={styles.heroName}>{name}</Text>
          <View style={styles.heroMeta}>
            <Text style={styles.muted}>{customer.customer_code}</Text>
            <StatusBadge label={archived ? "Archived" : "Active"} tone={archived ? "neutral" : "success"} />
          </View>
        </View>
      </View>

      <OfflineReadOnly what="customers" />
      <View style={styles.quick}>
        <QuickAction icon="phone" label="Call" disabled={!customer.phone} onPress={() => void callPhone(customer.phone ?? "")} />
        <QuickAction icon="navigation" label="Directions" disabled={!customer.delivery_address} onPress={() => void openDirections(customer.delivery_address ?? "")} />
        {canOrder ? (
          <QuickAction icon="plus-circle" label="New order" primary disabled={archived}
            onPress={() => router.push({ pathname: "/orders/new", params: { customerId: customer.id } })} />
        ) : null}
      </View>
      {archived ? (
        <View style={styles.archivedNote} accessibilityRole="text">
          <Icon name="archive" size={16} color={colors.textSecondary} />
          <Text style={styles.archivedText}>Archived customers can’t be picked for new orders. Their orders, deliveries and receipts are kept. Restore them to order again.</Text>
        </View>
      ) : null}

      <Card style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionTitle}>Contact</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Edit customer" accessibilityHint={online ? undefined : "Requires a connection"} accessibilityState={{ disabled: !online }} disabled={!online} hitSlop={8} onPress={() => setEditing(true)} style={[styles.edit, !online && styles.disabled]}>
            <Icon name="edit" size={16} color={online ? colors.primary : colors.textMuted} />
            <Text style={[styles.editText, !online && styles.disabledText]}>{online ? "Edit" : "Edit · Requires a connection"}</Text>
          </Pressable>
        </View>
        <Info label="Business name" value={customer.business_name} />
        <Info label="Brand name" value={customer.brand_name} />
        <Info label="Business type" value={customer.business_type ?? null} />
        <Info label="TIN#" value={customer.tin} />
        <Info label="Contact person" value={customer.contact_person} />
        <Info label="Phone" value={customer.phone} />
        <Info label="Email" value={customer.email} />
        <Info label="Delivery address" value={customer.delivery_address} />
        <Info label="Preferred delivery window" value={customer.preferred_delivery_window ?? null} />
        {customer.notes ? <Info label="Notes" value={customer.notes} /> : null}
      </Card>

      {canBill ? (
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Opens the statement of this customer's orders for a period"
          onPress={() => router.push({ pathname: "/reports/customer/[id]", params: { id: customer.id, period: "month" } })}
          style={({ pressed }) => [styles.billing, pressed && styles.archivePressed]}
        >
          <View style={styles.billingIcon}><Icon name="file-text" size={20} color={colors.primary} /></View>
          <View style={styles.flex}>
            <Text style={styles.billingTitle}>Customer statement</Text>
            <Text style={styles.muted}>Statement of orders for a period</Text>
          </View>
          <Icon name="chevron-right" size={20} color={colors.textMuted} />
        </Pressable>
      ) : null}

      <UsualProducts products={data.usual_products} />
      <OrderHistory customerId={customer.id} profile={data} />

      {canArchive ? <Pressable
        accessibilityRole="button"
        accessibilityHint={online ? undefined : "Requires a connection"}
        accessibilityState={{ disabled: !online }}
        disabled={!online}
        onPress={() => { archive.reset(); setConfirming(true); }}
        style={({ pressed }) => [styles.archiveButton, pressed && styles.archivePressed, !online && styles.disabled]}
      >
        <Icon name={archived ? "refresh" : "archive"} size={20} color={archived ? colors.primary : colors.danger} />
        <Text style={[styles.archiveLabel, { color: archived ? colors.primary : colors.danger }]}>{archived ? "Restore customer" : "Archive customer"}</Text>
      </Pressable> : null}

      <CustomerFormSheet
        visible={editing}
        customer={customer}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          toast("Customer saved");
        }}
      />
      <BottomSheet visible={confirming} onClose={() => setConfirming(false)}>
        <Text style={styles.sheetTitle} accessibilityRole="header">{archived ? `Restore ${name}?` : `Archive ${name}?`}</Text>
        <Text style={styles.sheetBody}>
          {archived
            ? "They will be back in the Active list and can be picked for new orders again."
            : "They move to Archived and can’t be picked for new orders. Nothing is deleted: their orders, deliveries and receipts are kept, and you can restore them at any time."}
        </Text>
        {archive.isError ? <InlineAlert title={archived ? "Not restored" : "Not archived"} message={problemText(archive.error)} /> : null}
        <Button label={archived ? "Restore customer" : "Archive customer"} type={archived ? "primary" : "destructive"} size="lg" loading={archive.isPending} onPress={() => setArchived(!archived)} />
        <Button label="Cancel" type="muted" size="lg" onPress={() => setConfirming(false)} />
      </BottomSheet>
    </Screen>
  );
}

function UsualProducts({ products }: { products: CustomerProfile["usual_products"] }) {
  return (
    <Card style={styles.section}>
      <Text style={styles.sectionTitle}>Usual products</Text>
      {products.length ? (
        <View style={styles.pills}>
          {products.map((product) => (
            <View key={product.product_id} style={styles.pill} accessibilityLabel={product.preferred ? `${product.product_name}, preferred` : `${product.product_name}, ordered ${product.times_ordered} times`}>
              <Text style={styles.pillText}>{product.product_name}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>Products this customer orders most will appear here.</Text>
      )}
    </Card>
  );
}

function OrderHistory({ customerId, profile }: { customerId: string; profile: CustomerProfile }) {
  const [open, setOpen] = useState(false);
  const history = useCustomerHistory(open ? customerId : "");
  const rows = history.data?.pages.flat() ?? [];
  return (
    <Card style={styles.historyCard}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Order history, ${historySummary(profile.order_count, profile.last_order_date)}`}
        disabled={!profile.order_count}
        onPress={() => setOpen((value) => !value)}
        style={styles.historyHead}
      >
        <View style={styles.historyIcon}><Icon name="clipboard" size={18} color={colors.primary} /></View>
        <View style={styles.flex}>
          <Text style={styles.sectionTitle}>Order history</Text>
          <Text style={styles.muted}>{historySummary(profile.order_count, profile.last_order_date)}</Text>
        </View>
        {profile.order_count ? <Icon name={open ? "chevron-down" : "chevron-right"} size={18} color={colors.textMuted} /> : null}
      </Pressable>
      {open ? (
        history.isPending ? <LoadingState message="Loading orders..." /> : history.isError && !rows.length ? (
          <ErrorState description="Orders couldn’t be loaded." onRetry={() => void history.refetch()} />
        ) : (
          <>
            {rows.map((order) => {
              const meta = ORDER_STATUS_META[order.status];
              return (
                <Pressable key={order.order_id} accessibilityRole="button" onPress={() => router.push({ pathname: "/orders/[id]", params: { id: order.order_id } })}
                  style={({ pressed }) => [styles.historyRow, pressed && styles.pressed]}>
                  <View style={styles.flex}>
                    <Text style={styles.historyNumber}>{order.order_number} · {dayLabel(order.requested_delivery_date)}</Text>
                    <Text style={styles.historyTotal}>{formatMoney(Number(order.total))}</Text>
                  </View>
                  <StatusBadge label={meta.label} tone={meta.tone} />
                  <Icon name="chevron-right" size={18} color={colors.textMuted} />
                </Pressable>
              );
            })}
            {history.hasNextPage ? <Button label="Load more orders" type="outline" onPress={() => void history.fetchNextPage()} loading={history.isFetchingNextPage} style={styles.loadMore} /> : null}
          </>
        )
      ) : null}
    </Card>
  );
}

function QuickAction({ icon, label, onPress, disabled, primary }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.quickItem, primary && styles.quickPrimary, pressed && (primary ? styles.quickPrimaryPressed : styles.quickPressed), disabled && styles.quickDisabled]}>
      <Icon name={icon} size={22} color={primary ? colors.onBrand : colors.primary} />
      <Text style={[styles.quickLabel, primary && styles.quickLabelPrimary]}>{label}</Text>
    </Pressable>
  );
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.info}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, !value && styles.infoMissing]}>{value ?? "Not recorded"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  billing: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, ...shadows.card },
  billingIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  billingTitle: { ...text.bodyStrong, color: colors.text },
  content: { paddingTop: spacing.lg, gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.7 },
  hero: { flexDirection: "row", alignItems: "center", gap: 14 },
  heroName: { ...text.title, color: colors.text },
  heroMeta: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
  muted: { ...text.caption, color: colors.textSecondary },
  quick: { flexDirection: "row", gap: spacing.sm },
  quickItem: { flex: 1, minHeight: 64, alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, ...shadows.card },
  quickPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  quickPressed: { backgroundColor: colors.surfacePressed },
  quickPrimaryPressed: { backgroundColor: colors.primaryPressed },
  quickDisabled: { opacity: 0.4 },
  quickLabel: { ...text.captionStrong, color: colors.primary },
  quickLabelPrimary: { color: colors.onBrand },
  archivedNote: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: colors.surfaceMuted, borderRadius: radii.md, padding: spacing.md },
  archivedText: { ...text.caption, color: colors.textSecondary, flex: 1 },
  section: { gap: spacing.md },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { ...text.heading, color: colors.text },
  edit: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32 },
  editText: { ...text.captionStrong, color: colors.primary },
  disabled: { opacity: 0.5 },
  disabledText: { color: colors.textMuted },
  info: { gap: 2 },
  infoLabel: { ...text.captionStrong, color: colors.textSecondary },
  infoValue: { ...text.body, color: colors.text },
  infoMissing: { color: colors.textMuted },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  pill: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primaryMuted },
  pillText: { ...text.captionStrong, color: colors.primary },
  empty: { ...text.caption, color: colors.textMuted },
  historyCard: { gap: spacing.sm },
  historyHead: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44 },
  historyIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  historyRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  historyNumber: { ...text.captionStrong, color: colors.primary },
  historyTotal: { ...text.bodyStrong, color: colors.text },
  loadMore: { marginTop: spacing.sm },
  archiveButton: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, ...shadows.card },
  archivePressed: { backgroundColor: colors.surfacePressed },
  archiveLabel: { ...text.button },
  sheetTitle: { ...text.title, color: colors.text },
  sheetBody: { ...text.body, color: colors.textSecondary },
});
