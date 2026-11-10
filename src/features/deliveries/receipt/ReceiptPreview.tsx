import { useState } from "react";
import { StyleSheet, Text, View, type TextStyle } from "react-native";

import { VOID_LABEL, isVoidReceipt, peso, quantityText, receiptDate, receiptNumber, roundingNote, type Receipt } from "../deliveriesLogic";

// An on-screen copy of the Letter receipt (8.5 × 11 in), drawn at the width
// it is given. The PDF itself comes from receiptHtml; both use the same
// saved receipt contents.
const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

export function ReceiptPreview({ receipt }: { receipt: Receipt }) {
  const [width, setWidth] = useState(0);
  const k = width / PAGE_WIDTH;
  const font = (size: number, weight: TextStyle["fontWeight"] = "400"): TextStyle => ({ fontSize: size * k, lineHeight: size * k * 1.3, fontWeight: weight, color: "#000" });
  const border = Math.max(0.5, 1.5 * k);
  const cell = { borderColor: "#000", borderWidth: border, paddingHorizontal: 6 * k, paddingVertical: 4 * k, justifyContent: "center" as const };
  const columns = [130 * k, undefined, 115 * k, 135 * k];
  const discount = Number(receipt.discount_amount) > 0;
  const note = roundingNote(receipt);
  return (
    <View
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.page, { height: width ? width * (PAGE_HEIGHT / PAGE_WIDTH) : undefined, aspectRatio: width ? undefined : PAGE_WIDTH / PAGE_HEIGHT, padding: 48 * k }]}
      accessible
      accessibilityLabel={`${isVoidReceipt(receipt) ? `${VOID_LABEL}. ` : ""}Delivery receipt ${receiptNumber(receipt)} for ${receipt.customer_name}, ${receipt.lines.length} items, total ${peso(receipt.total)}`}
    >
      {width ? (
        <>
          {isVoidReceipt(receipt) ? (
            <View style={{ borderWidth: 3 * k, borderColor: "#B42318", padding: 6 * k, marginBottom: 12 * k }}>
              <Text style={[font(22, "700"), styles.center, { color: "#B42318", letterSpacing: 1 * k }]}>{VOID_LABEL}</Text>
            </View>
          ) : null}
          <Text style={[font(19, "700"), styles.center]}>{receipt.company_name}</Text>
          <Text style={[font(10), styles.center, { marginBottom: 18 * k, textTransform: "uppercase" }]}>{receipt.company_address} / {receipt.company_phone}</Text>
          <View style={styles.row}>
            <View style={[cell, { width: 125 * k }]}><Text style={font(13)}><Text style={font(13, "700")}>DR NO: </Text>{receiptNumber(receipt)}</Text></View>
            <View style={[cell, styles.flex, { borderLeftWidth: 0 }]}><Text style={font(13)} numberOfLines={1}><Text style={font(11, "700")}>Name: </Text>{receipt.customer_name}</Text></View>
            <View style={[cell, { width: 145 * k, borderLeftWidth: 0 }]}><Text style={font(13)}><Text style={font(13, "700")}>DATE</Text> : {receiptDate(receipt.delivery_date)}</Text></View>
          </View>
          <View style={[cell, { borderTopWidth: 0 }]}><Text style={font(13)} numberOfLines={1}><Text style={font(13, "700")}>ADDRESS: </Text>{receipt.delivery_address ?? ""}</Text></View>
          <Text style={[font(14, "700"), styles.center, { paddingVertical: 4 * k }]}>DELIVERY RECEIPT</Text>
          {[["QTY", "DESCRIPTION", "PRICE", "AMOUNT"], ...receipt.lines.map((line) => [quantityText(line), line.description, peso(line.unit_price), peso(line.amount)])].map((cells, rowIndex) => (
            <View key={rowIndex} style={styles.row}>
              {cells.map((value, col) => (
                <View key={col} style={[cell, columns[col] ? { width: columns[col] } : styles.flex, col > 0 && { borderLeftWidth: 0 }, rowIndex > 0 && { borderTopWidth: 0 }]}>
                  <Text style={[font(13, rowIndex === 0 ? "700" : "400"), col !== 1 && styles.center]} numberOfLines={1}>{value}</Text>
                </View>
              ))}
            </View>
          ))}
          {(discount ? [["SUBTOTAL:", peso(receipt.subtotal)], ["LESS DISCOUNT:", `-${peso(receipt.discount_amount)}`]] : []).concat([["TOTAL SALES:", peso(receipt.total)]]).map(([label, value], index, all) => (
            <View key={label} style={styles.row}>
              <View style={[cell, styles.flex, { borderTopWidth: 0, alignItems: "flex-end" }]}><Text style={font(index === all.length - 1 ? 14 : 13, "700")}>{label}</Text></View>
              <View style={[cell, { width: columns[3], borderTopWidth: 0, borderLeftWidth: 0 }]}><Text style={[font(index === all.length - 1 ? 14 : 13, "700"), styles.center]}>{value}</Text></View>
            </View>
          ))}
          {note ? <Text style={[font(10), { fontStyle: "italic", textAlign: "right", marginTop: 6 * k }]}>{note}</Text> : null}
          <View style={[styles.row, { justifyContent: "space-between", marginTop: 26 * k }]}>
            <View style={{ width: 150 * k }}>
              <Text style={font(9)} numberOfLines={1}>{receipt.issued_by_name}</Text>
              <View style={{ borderTopWidth: Math.max(0.5, k), borderColor: "#000" }} />
              <Text style={[font(9), styles.center]}>Issued By</Text>
            </View>
            <View style={{ width: 150 * k }}>
              <Text style={font(9)}> </Text>
              <View style={{ borderTopWidth: Math.max(0.5, k), borderColor: "#000" }} />
              <Text style={[font(9), styles.center]}>Received By</Text>
            </View>
          </View>
          <Text style={[font(9), { color: "#5B6B62", marginTop: 18 * k }]}>
            {receipt.order_number}{receipt.sales_invoice_number ? ` · SI# ${receipt.sales_invoice_number}` : ""} · Issued {receiptDate(receipt.issued_at)}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { width: "100%", backgroundColor: "#FFFFFF" },
  center: { textAlign: "center" },
  row: { flexDirection: "row" },
  flex: { flex: 1 },
});
