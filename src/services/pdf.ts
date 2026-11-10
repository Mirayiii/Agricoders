import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

export { escapeHtml, pdfPage } from "./pdfHtml";

/**
 * Turns HTML into a PDF and opens the share sheet (plan task 0.7). On web,
 * where files can't be shared, it opens the browser's print dialog instead.
 * Returns false if sharing isn't available on this device.
 */
export async function sharePdf(html: string, dialogTitle: string): Promise<boolean> {
  if (Platform.OS === "web") {
    printHtmlOnWeb(html);
    return true;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf", dialogTitle });
  return true;
}

/**
 * expo-print on web ignores the html and prints the app screen, so the
 * document is printed from a hidden frame instead.
 */
/**
 * Download PDF (Figma receipt viewer). Native: makes the PDF and opens the
 * share sheet, where "Save to Files" (iOS) or a files app (Android) keeps it.
 * Web: the print dialog, where "Save as PDF" downloads it; the page title is
 * the suggested file name. Returns false if the device can't share files.
 */
export async function downloadPdf(html: string, dialogTitle: string): Promise<boolean> {
  return sharePdf(html, dialogTitle);
}

/** Print: the system print dialog on every platform. */
export async function printPdf(html: string): Promise<void> {
  if (Platform.OS === "web") {
    printHtmlOnWeb(html);
    return;
  }
  await Print.printAsync({ html });
}

function printHtmlOnWeb(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);
  const doc = frame.contentWindow?.document;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    throw new Error("Printing isn’t available in this browser");
  }
  doc.open();
  doc.write(html);
  doc.close();
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 60_000);
}
