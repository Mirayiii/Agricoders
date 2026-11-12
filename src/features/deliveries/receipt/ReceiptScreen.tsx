import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import { Button, Card, EmptyState, ErrorState, Icon, LoadingState, useToast } from "@/components";
import { colors, radii, spacing, text } from "@/constants/theme";
import { downloadPdf, printPdf, sharePdf } from "@/services/pdf";
import { useReceipt } from "../deliveriesData";
import { VOID_LABEL, isVoidReceipt, receiptFileName, receiptHtml, receiptNumber } from "../deliveriesLogic";
import { ReceiptPreview } from "./ReceiptPreview";

/** Figma "Delivery Receipt · PDF viewer": preview, Share, Download PDF and Print. */
export function ReceiptScreen({ orderId, orderStatus }: { orderId: string; orderStatus?: string }) {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const receipt = useReceipt(orderId);
  const [busy, setBusy] = useState<"share" | "download" | "print" | null>(null);

  async function run(kind: "share" | "download" | "print") {
    if (!receipt.data) return;
    setBusy(kind);
    try {
      // DE-03: fetch again so the PDF shows the latest saved order (frozen once delivered).
      const latest = (await receipt.refetch()).data ?? receipt.data;
      const html = receiptHtml(latest);
      const name = receiptFileName(latest);
      if (kind === "print") await printPdf(html);
      else if (!(await (kind === "share" ? sharePdf(html, `Share ${name}`) : downloadPdf(html, `Save ${name}`)))) {
        toast({ title: "Sharing isn’t available on this device", tone: "error" });
      }
    } catch (error) {
      toast({ title: "Couldn’t make the PDF", message: error instanceof Error ? error.message : undefined, tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  const data = receipt.data;
  return (
    <View style={styles.page}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} style={styles.round}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.title} accessibilityRole="header">Delivery receipt</Text>
          {data ? <Text style={styles.subtitle}>DR No. {receiptNumber(data)}{data.order_number === data.dr_label ? "" : ` · ${data.order_number}`}{isVoidReceipt(data) ? " · VOID" : ""}</Text> : null}
        </View>
        {data ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Download PDF" onPress={() => void run("download")} style={styles.round}>
            <Icon name="download" size={20} color={colors.text} />
          </Pressable>
        ) : <View style={styles.roundSpacer} />}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {receipt.isPending ? <LoadingState message="Loading receipt..." /> : receipt.error ? (
          <Card><ErrorState description="We couldn’t load the receipt." onRetry={() => void receipt.refetch()} /></Card>
        ) : data ? (
          <>
            <Text style={styles.pageCount}>Page 1 of 1</Text>
            {isVoidReceipt(data) ? (
              <Text style={styles.voidText} accessibilityRole="alert">{VOID_LABEL}. This receipt keeps its DR number and details but is no longer valid.</Text>
            ) : (
              <Text style={styles.subtitle}>{data.finalized_at ? "Final copy, as delivered." : "Updates with the order until it is delivered. The DR number stays the same."}</Text>
            )}
            <View style={styles.sheet}><ReceiptPreview receipt={data} /></View>
          </>
        ) : (
          <Card>
            <EmptyState icon="document-text-outline" title="No receipt yet" description={orderStatus === "cancelled" ? "This order was cancelled before it was confirmed, so it has no receipt." : "The receipt is ready as soon as the order is confirmed. Its DR number is the order number."} />
          </Card>
        )}
      </ScrollView>

      {data ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Button label="Share (Viber / SMS)" icon="share" size="lg" loading={busy === "share"} onPress={() => void run("share")} />
          <View style={styles.row}>
            <Button label="Download PDF" icon="download" type="outline" size="md" loading={busy === "download"} onPress={() => void run("download")} style={styles.flex} />
            <Button label="Print" icon="file-text" type="outline" size="md" loading={busy === "print"} onPress={() => void run("print")} style={styles.flex} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surfaceMuted },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  round: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  roundSpacer: { width: 40 },
  title: { ...text.title, color: colors.text, textAlign: "center" },
  subtitle: { ...text.caption, color: colors.textSecondary, textAlign: "center" },
  content: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  pageCount: { ...text.captionStrong, color: colors.textSecondary, textAlign: "center" },
  voidText: { ...text.captionStrong, color: colors.danger, textAlign: "center" },
  sheet: { borderRadius: 2, overflow: "hidden", borderWidth: 1, borderColor: colors.borderStrong },
  footer: { backgroundColor: colors.surface, paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg },
  row: { flexDirection: "row", gap: spacing.sm },
});
