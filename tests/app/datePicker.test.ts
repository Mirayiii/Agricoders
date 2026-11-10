import assert from "node:assert/strict";
import { test } from "node:test";

import { monthGrid, relativeDayText } from "@/components/datePickerLogic";
import { addDays, toISODate } from "@/utils/format";

test("the calendar shows six weeks starting on the Sunday before the 1st", () => {
  const days = monthGrid(2026, 7); // August 2026 starts on a Saturday
  assert.equal(days.length, 42);
  assert.equal(toISODate(days[0]), "2026-07-26");
  assert.equal(days[0].getDay(), 0);
  assert.equal(toISODate(days[6]), "2026-08-01");
  assert.equal(toISODate(days[41]), "2026-09-05");
});

test("the date card says how far away the picked day is", () => {
  const today = new Date();
  assert.equal(relativeDayText(null), "Required · tap to open calendar");
  assert.equal(relativeDayText(toISODate(today)), "Today");
  assert.equal(relativeDayText(toISODate(addDays(today, 1))), "Tomorrow");
  assert.equal(relativeDayText(toISODate(addDays(today, 5))), "In 5 days");
});
