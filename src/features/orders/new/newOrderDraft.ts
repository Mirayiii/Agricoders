/**
 * Prototype: closing New order keeps what was entered, and the next New order
 * opens where it was left. Saving the order clears it. The draft lives in
 * memory only, so it is gone after the app restarts or the user signs out.
 * Order again keeps no draft (as in the prototype).
 */
export type NewOrderDraft = {
  step: 1 | 2 | 3;
  customerId: string | null;
  lines: unknown[];
  date: string | null;
  time: unknown;
  sourceId: string | null;
  notes: string;
  salesInvoice: string;
  needsChecking: boolean;
  checkingNote: string;
  discount: unknown;
};

let draft: NewOrderDraft | null = null;

export function readNewOrderDraft(): NewOrderDraft | null {
  return draft;
}

/** Keeps the draft, or clears it when nothing has been entered yet. */
export function keepNewOrderDraft(next: NewOrderDraft) {
  const empty = !next.customerId && next.lines.length === 0 && !next.date && !next.notes.trim() && !next.salesInvoice.trim() && !next.needsChecking && !next.discount;
  draft = empty ? null : next;
}

export function clearNewOrderDraft() {
  draft = null;
}
