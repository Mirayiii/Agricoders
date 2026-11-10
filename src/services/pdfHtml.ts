// PDF page HTML, kept free of native modules so it can be tested.

/** Escapes text before it goes into PDF HTML. Use for every value from the database. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Page wrapper with the MEAH fonts and colours, so every document looks the same. */
export function pdfPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { margin: 18mm 14mm; }
  body { font-family: Inter, -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #14241B; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 4px; } .muted { color: #5B6B62; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid #E2EBE4; }
  th { font-size: 11px; color: #5B6B62; text-transform: uppercase; letter-spacing: .3px; }
  .num { text-align: right; }
</style></head><body>${body}</body></html>`;
}
