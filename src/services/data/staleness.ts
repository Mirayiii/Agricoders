// When a refresh fails, screens keep the last data they had. They must say so
// rather than present it as current.

type QueryLike = {
  data: unknown;
  isRefetchError?: boolean;
  isError?: boolean;
  dataUpdatedAt: number;
  errorUpdatedAt?: number;
};

export type Freshness = { stale: false } | { stale: true; savedAt: number };

export function freshnessOf(query: QueryLike): Freshness {
  if (query.data === undefined) return { stale: false };
  const failedAfterData = query.isRefetchError ?? (Boolean(query.isError) && (query.errorUpdatedAt ?? 0) >= query.dataUpdatedAt);
  return failedAfterData ? { stale: true, savedAt: query.dataUpdatedAt } : { stale: false };
}

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "8:05 AM" today, otherwise "3 Nov, 8:05 AM". Local time. */
export function savedAtLabel(savedAt: number, now = Date.now()): string {
  const date = new Date(savedAt);
  const today = new Date(now);
  const hours = date.getHours();
  const time = `${hours % 12 || 12}:${pad(date.getMinutes())} ${hours >= 12 ? "PM" : "AM"}`;
  const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  return sameDay ? time : `${date.getDate()} ${MONTHS[date.getMonth()]}, ${time}`;
}

export function staleMessage(savedAt: number, now = Date.now()): string {
  return `Couldn’t refresh. Showing what was loaded at ${savedAtLabel(savedAt, now)}.`;
}
