import { useState } from "react";
import { useIsOnline } from "@/services/offline";
import { ReportsOffline } from "../ReportsOffline";
import { StyleSheet, Text, View } from "react-native";

import { Button, Card, ErrorState, Icon, InlineAlert, LoadingState, Screen, StaleNotice, StatusBadge, useToast } from "@/components";
import { BUSINESS_NAME } from "@/constants/app";
import { colors, radii, spacing, text } from "@/constants/theme";
import { ORDER_STATUS_META } from "@/features/orders/status";
import { sharePdf } from "@/services/pdf";
import { formatMoney } from "@/utils/format";
import { BarChart, PeriodPicker, SectionHead, StatBox, StatGrid, usePeriod } from "../reportParts";
import { shareCsv, useCustomerStatement } from "../reportsData";
import {
  chartBars, costNote, drLabel, formatPercentOrDash, profitLine, statementCsv, statementHtml, volumeText,
  type Period, type Range, type StatementOrder,
} from "../reportsLogic";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longDate = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;

/**
 * Figma "Reports · Customer analytics", which is also the customer statement
 * (the Customer statement row on customer detail): totals, daily sales and every order in the period,
 * itemized, with Share PDF and CSV. Administrators only.
 */
export function CustomerAnalyticsScreen({ customerId = "", initialPeriod = "week", initialBack = 0, initialRange = null }: { customerId?: string; initialPeriod?: Period; initialBack?: number; initialRange?: Range | null }) {
  const toast = useToast();
  const period = usePeriod(initialPeriod, initialBack, initialRange);
  const statement = useCustomerStatement(customerId, period.range);
  const online = useIsOnline();
  const [mode, setMode] = useState<"period" | "trend">("period");
  const [measure, setMeasure] = useState<"sales" | "volume">("sales");
  const [sharing, setSharing] = useState<"pdf" | "csv" | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const data = statement.data;

  async function share(kind: "pdf" | "csv") {
    if (!data) return;
    setSharing(kind);
    setShareError(null);
    try {
      const file = `Statement ${data.customer.name} ${data.start} to ${data.end}`;
      if (kind === "pdf") {
        const printed = new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" });
        if (!(await sharePdf(statementHtml(data, BUSINESS_NAME, printed), file))) setShareError("Sharing isn’t available on this device.");
      } else {
        await shareCsv(statementCsv(data), `${file}.csv`);
        toast("Statement CSV ready");
      }
    } catch (error) {
      setShareError(error instanceof Error ? error.message : "The statement couldn’t be shared. Try again.");
    } finally {
      setSharing(null);
    }
  }

  return (
    <Screen title="Customer Analytics" showBackButton contentStyle={styles.content} refreshing={statement.isRefetching} onRefresh={() => void statement.refetch()}>
      <StaleNotice query={statement} />
      {data ? (
        <Card style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.name} numberOfLines={2}>{data.customer.name}</Text>
            <View style={styles.codePill}><Text style={styles.codeText}>{data.customer.code}</Text></View>
          </View>
          <Text style={styles.caption}>{[data.customer.contact_person, data.customer.phone].filter(Boolean).join(" · ") || "No contact recorded"}</Text>
          {data.customer.tin ? <Text style={styles.caption}>TIN# {data.customer.tin}</Text> : null}
        </Card>
      ) : null}
      <PeriodPicker state={period} />
      {!online ? <ReportsOffline updatedAt={statement.dataUpdatedAt} /> : statement.isPending ? <LoadingState message="Loading statement..." /> : !data ? (
        <ErrorState description="This statement couldn’t be loaded." onRetry={() => void statement.refetch()} />
      ) : (
        <>
          <StatGrid>
            <StatBox label="Total sales" value={formatMoney(Number(data.totals.sales))} sub={`${data.totals.orders} order${data.totals.orders === 1 ? "" : "s"}`} icon="trending-up" />
            <StatBox label="Total cost" value={formatMoney(Number(data.totals.cost))} sub="Capital cost" icon="tag" tone="danger" />
            <StatBox label="Total volume" value={volumeText(data.totals.volume, 1)} sub="Delivered weight" icon="package" />
            <StatBox label="Margin" value={formatPercentOrDash(data.totals.margin_percent)} sub={profitLine(data.totals, formatMoney)} icon="bar-chart" tone="brand" />
          </StatGrid>
          {costNote(data.totals) ? <Text style={styles.caption}>{costNote(data.totals)}</Text> : null}
          <BarChart
            title={measure === "sales" ? "Daily sales" : "Daily volume (kg)"}
            subtitle={`${period.noun} · ${measure === "sales" ? formatMoney(Number(data.totals.sales)) : volumeText(data.totals.volume)}`}
            total={measure === "sales" ? formatMoney(Number(data.totals.sales)) : volumeText(data.totals.volume, 1)}
            bars={chartBars(period.period, data.daily, measure, mode)}
            suffix={measure === "volume" ? "kg" : ""}
            mode={mode} onMode={setMode} measure={measure} onMeasure={setMeasure}
          />
          <View style={styles.actions}>
            <View style={styles.flex}><Button label="Share PDF" icon="share" size="lg" loading={sharing === "pdf"} disabled={sharing !== null} onPress={() => void share("pdf")} /></View>
            <View style={styles.flex}><Button label="Export CSV" icon="download" type="brandOutline" size="lg" loading={sharing === "csv"} disabled={sharing !== null} onPress={() => void share("csv")} /></View>
          </View>
          {shareError ? <InlineAlert title="Not shared" message={shareError} /> : null}
          <SectionHead title="Orders breakdown" right={`${data.orders.length} order${data.orders.length === 1 ? "" : "s"}`} />
          {data.orders.length ? data.orders.map((order) => <OrderCard key={order.order_id} order={order} />) : (
            <Card><Text style={styles.caption}>No orders in this period. Cancelled orders aren’t listed.</Text></Card>
          )}
        </>
      )}
    </Screen>
  );
}

function OrderCard({ order }: { order: StatementOrder }) {
  const meta = ORDER_STATUS_META[order.status];
  const dr = drLabel(order.dr_number);
  return (
    <Card style={styles.order}>
      <View style={styles.orderHead}>
        <Icon name="file-text" size={18} color={colors.primary} />
        <Text style={styles.orderDate}>{longDate(order.delivery_date)} <Text style={styles.caption}>({dr ?? order.order_number})</Text></Text>
        <StatusBadge label={meta.label} tone={meta.tone} />
      </View>
      {order.lines.map((line, index) => (
        <View key={index} style={styles.line}>
          <Text style={styles.lineText}>{line.product_name} ({Number(line.quantity)} {line.unit} @ {formatMoney(Number(line.unit_price))})</Text>
          <Text style={styles.lineAmount}>{formatMoney(Number(line.amount))}</Text>
        </View>
      ))}
      {Number(order.discount) ? (
        <View style={styles.line}><Text style={styles.lineText}>Discount</Text><Text style={styles.lineAmount}>−{formatMoney(Number(order.discount))}</Text></View>
      ) : null}
      <View style={styles.orderFoot}>
        <Text style={styles.caption} numberOfLines={1}>{order.received_by ? `Received by ${order.received_by}` : order.order_number}</Text>
        <Text style={styles.orderTotal}>Order total: {formatMoney(Number(order.total))}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  flex: { flex: 1 },
  caption: { ...text.caption, color: colors.textSecondary },
  header: { gap: 4 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { ...text.heading, color: colors.text, flex: 1 },
  codePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: colors.primarySoft },
  codeText: { ...text.overline, color: colors.primary },
  actions: { flexDirection: "row", gap: spacing.sm },
  order: { gap: spacing.sm },
  orderHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  orderDate: { ...text.bodyStrong, color: colors.text, flex: 1 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  lineText: { ...text.caption, color: colors.text, flex: 1 },
  lineAmount: { ...text.captionStrong, color: colors.text },
  orderFoot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, borderRadius: radii.sm },
  orderTotal: { ...text.bodyStrong, color: colors.primary },
});
