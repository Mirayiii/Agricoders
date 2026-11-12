import assert from "node:assert/strict";
import { test } from "node:test";

import { CUSTOMER_PAGE_SIZE, PAGE_SIZE, clampPage, pageCount, pageItems, pageSlice } from "@/utils/pagination";

const labels = (current: number, pages: number) =>
  pageItems(current, pages).map((item) => (item.kind === "gap" ? "…" : item.current ? `[${item.page}]` : String(item.page))).join(" ");

test("prototype page sizes: 15 for lists, 10 for customers", () => {
  assert.equal(PAGE_SIZE, 15);
  assert.equal(CUSTOMER_PAGE_SIZE, 10);
});

test("pageCount never drops below one page", () => {
  assert.equal(pageCount(0, 15), 1);
  assert.equal(pageCount(15, 15), 1);
  assert.equal(pageCount(16, 15), 2);
  assert.equal(pageCount(31, 10), 4);
});

test("clampPage keeps the page inside the list after it shrinks", () => {
  assert.equal(clampPage(5, 20, 15), 2);
  assert.equal(clampPage(0, 20, 15), 1);
  assert.equal(clampPage(Number.NaN, 20, 15), 1);
  assert.equal(clampPage(2.7, 40, 15), 2);
});

test("pageSlice returns the right 15 rows", () => {
  const rows = Array.from({ length: 32 }, (_, index) => index + 1);
  assert.deepEqual(pageSlice(rows, 1, 15), rows.slice(0, 15));
  assert.deepEqual(pageSlice(rows, 3, 15), [31, 32]);
  assert.deepEqual(pageSlice(rows, 9, 15), [31, 32]);
  assert.deepEqual(pageSlice([], 1, 15), []);
});

test("pageItems follows the prototype bar", () => {
  assert.equal(labels(1, 1), "");
  assert.equal(labels(2, 5), "1 [2] 3 4 5");
  assert.equal(labels(1, 9), "[1] 2 3 4 … 9");
  assert.equal(labels(3, 9), "1 2 [3] 4 … 9");
  assert.equal(labels(5, 9), "1 … 4 [5] 6 … 9");
  assert.equal(labels(8, 9), "1 … 6 7 [8] 9");
  assert.equal(labels(9, 9), "1 … 6 7 8 [9]");
});
