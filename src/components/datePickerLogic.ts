import { daysFromToday } from "@/utils/format";

/** Six weeks of days, starting on the Sunday on or before the 1st of the month. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

/** The line under the date: Today, Tomorrow, In 5 days, or what to do. */
export function relativeDayText(value: string | null): string {
  if (!value) return "Required · tap to open calendar";
  const offset = daysFromToday(value);
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  if (offset < 0) return `${-offset} day${offset === -1 ? "" : "s"} ago`;
  return `In ${offset} days`;
}
