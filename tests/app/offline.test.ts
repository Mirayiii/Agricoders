import assert from "node:assert/strict";
import { test } from "node:test";

import {
  acceptPrices,
  canRemove,
  classifyError,
  countsFor,
  enqueue,
  expireOld,
  latestFor,
  nextToSend,
  payloadFor,
  pruneSynced,
  recoverAfterRestart,
  remove,
  unsynced,
  type NewAction,
  type OutboxAction,
} from "@/services/offline/outboxLogic";
import { drainOutbox, type SyncDeps } from "@/services/offline/syncLoop";
import { withQueuedTicks, type PackOrder } from "@/features/purchasing/purchasingLogic";
import { priceLines, seenPrices, type CatalogItem } from "@/features/orders/new/newOrderLogic";

// Phase 10 (offline): the outbox rules and the sending loop, with a pretend
// server that remembers request ids the way begin_client_request does.

const DAY = 86_400_000;
const T0 = new Date("2026-11-04T08:00:00+08:00");
const at = (ms: number) => new Date(T0.getTime() + ms);

const DRIVER = "u-driver";
const OFFICE = "u-office";

function action(id: string, userId = DRIVER, extra: Partial<NewAction> = {}): NewAction {
  return {
    id,
    userId,
    rpc: "offline_complete_delivery",
    args: { p_delivery_id: `d-${id}`, p_received_by: null },
    seen: { scheduled_date: "2026-11-04" },
    label: `Mark delivered · ${id}`,
    targetId: `d-${id}`,
    ...extra,
  };
}

function queue(...items: { a: NewAction; when?: Date }[]): OutboxAction[] {
  return items.reduce<OutboxAction[]>((list, { a, when }) => enqueue(list, a, when ?? T0), []);
}

type Reply = { data: unknown; error: { message?: string; code?: string; details?: string | null; status?: number } | null };

/** A pretend server: each request id is applied once; a repeat returns the first result. */
function fakeServer(rules: { refuse?: (rpc: string, payload: Record<string, unknown>) => Reply["error"] } = {}) {
  const done = new Map<string, unknown>();
  const applied: string[] = [];
  return {
    applied,
    done,
    send: async (rpc: string, payload: Record<string, unknown>): Promise<Reply> => {
      const id = String(payload.p_client_request_id);
      if (done.has(id)) return { data: { ...(done.get(id) as object), replayed: true }, error: null };
      const refused = rules.refuse?.(rpc, payload);
      if (refused) return { data: null, error: refused };
      const result = { ok: id };
      done.set(id, result);
      applied.push(id);
      return { data: result, error: null };
    },
  };
}

/** The outbox in memory, with the same change() shape as the app's store. */
function memoryOutbox(items: OutboxAction[], user: string | null = DRIVER) {
  const state = { items, user, online: true };
  const deps = (send: SyncDeps["send"], userId = DRIVER): SyncDeps => ({
    userId,
    items: () => state.items,
    currentUser: () => state.user,
    online: () => state.online,
    change: async (fn) => { state.items = fn(state.items); },
    send,
    now: () => T0,
  });
  return { state, deps };
}

// ---------------------------------------------------------------------------
// Queue rules
// ---------------------------------------------------------------------------

test("queueing the same change twice keeps one copy (same request id)", () => {
  const list = enqueue(enqueue([], action("a"), T0), action("a"), at(1000));
  assert.equal(list.length, 1);
  assert.equal(list[0].status, "pending");
  assert.equal(list[0].queuedAt, T0.toISOString());
});

test("restart recovery: a change cut off mid-send goes back to waiting", () => {
  const list = recoverAfterRestart([{ ...queue({ a: action("a") })[0], status: "syncing", attempts: 1 }]);
  assert.equal(list[0].status, "pending");
});

test("changes older than 30 days are refused locally and never sent (D-OF3)", () => {
  const list = expireOld(queue({ a: action("old"), when: at(-31 * DAY) }, { a: action("new"), when: at(-29 * DAY) }), T0);
  assert.equal(list[0].status, "rejected");
  assert.equal(list[0].rejection?.kind, "expired");
  assert.match(list[0].rejection?.reason ?? "", /more than 30 days ago/);
  assert.equal(list[1].status, "pending");
  assert.equal(nextToSend(list, DRIVER)?.id, "new");
});

test("synced changes stay listed for a day, then go", () => {
  const list: OutboxAction[] = [
    { ...queue({ a: action("a") })[0], status: "synced", syncedAt: at(-25 * 60 * 60 * 1000).toISOString() },
    { ...queue({ a: action("b") })[0], status: "synced", syncedAt: at(-60 * 60 * 1000).toISOString() },
  ];
  assert.deepEqual(pruneSynced(list, T0).map((item) => item.id), ["b"]);
});

test("account isolation: one person's changes are never counted, shown or sent for another", () => {
  const list = queue({ a: action("mine") }, { a: action("theirs", OFFICE) });
  assert.deepEqual(unsynced(list, DRIVER).map((item) => item.id), ["mine"]);
  assert.deepEqual(countsFor(list, OFFICE), { pending: 1, syncing: 0, rejected: 0, synced: 0 });
  assert.equal(nextToSend(list, OFFICE)?.id, "theirs");
  assert.equal(latestFor(list, OFFICE, "d-mine"), undefined);
});

test("cancellation: waiting or refused changes can be removed, not one being sent", () => {
  const [item] = queue({ a: action("a") });
  assert.equal(canRemove(item), true);
  assert.equal(remove([item], "a").length, 0);
  const sending = { ...item, status: "syncing" as const };
  assert.equal(canRemove(sending), false);
  assert.equal(remove([sending], "a").length, 1);
  assert.equal(canRemove({ ...item, status: "rejected" }), true);
});

// ---------------------------------------------------------------------------
// Errors are told apart
// ---------------------------------------------------------------------------

test("network failures, ended sessions and permission refusals are told apart", () => {
  assert.equal(classifyError({ message: "TypeError: Network request failed", status: 0 }).type, "network");
  assert.equal(classifyError({ message: "Failed to fetch" }).type, "network");
  assert.equal(classifyError({ message: "JWT expired", code: "PGRST301", status: 401 }).type, "signed_out");
  assert.equal(classifyError({ message: "Invalid token", status: 401 }).type, "signed_out");
  const permission = classifyError({ message: "Your account can no longer confirm deliveries", code: "42501", status: 403 });
  assert.equal(permission.type === "rejected" && permission.rejection.kind, "permission");
  const conflict = classifyError({ message: "This stop was reassigned to Carlo Diaz.", code: "OFCON", status: 400 });
  assert.equal(conflict.type === "rejected" && conflict.rejection.kind, "conflict");
  assert.equal(conflict.type === "rejected" && conflict.rejection.reason, "This stop was reassigned to Carlo Diaz.");
  const expired = classifyError({ message: "Saved offline more than 30 days ago", code: "OFEXP", status: 400 });
  assert.equal(expired.type === "rejected" && expired.rejection.kind, "expired");
});

// ---------------------------------------------------------------------------
// The sending loop
// ---------------------------------------------------------------------------

test("sync sends oldest first and marks each one synced", async () => {
  const box = memoryOutbox(queue({ a: action("second"), when: at(2000) }, { a: action("first"), when: at(1000) }));
  const server = fakeServer();
  const result = await drainOutbox(box.deps(server.send));
  assert.deepEqual(server.applied, ["first", "second"]);
  assert.equal(result.sent, 2);
  assert.ok(box.state.items.every((item) => item.status === "synced"));
});

test("interrupted sync: no answer stops sending and keeps the change and the ones after it", async () => {
  const box = memoryOutbox(queue({ a: action("a"), when: at(1) }, { a: action("b"), when: at(2) }));
  const result = await drainOutbox(box.deps(async () => { throw new TypeError("Network request failed"); }));
  assert.equal(result.noAnswer, true);
  assert.deepEqual(box.state.items.map((item) => item.status), ["pending", "pending"]);
  assert.equal(box.state.items[0].attempts, 1);
});

test("duplicate replay: a change that reached the server before the answer was lost is not applied twice", async () => {
  const server = fakeServer();
  // First try: the server applies it, then the phone loses the answer and restarts mid-send.
  await server.send("offline_complete_delivery", payloadFor(queue({ a: action("a") })[0]));
  const box = memoryOutbox(recoverAfterRestart([{ ...queue({ a: action("a") })[0], status: "syncing", attempts: 1 }]));
  const result = await drainOutbox(box.deps(server.send));
  assert.equal(result.sent, 1);
  assert.deepEqual(server.applied, ["a"], "applied once");
  assert.equal((box.state.items[0].result as { replayed?: boolean }).replayed, true);
});

test("reassignment: a refused change is kept for review with the reason, and later changes still go", async () => {
  const server = fakeServer({ refuse: (_rpc, payload) => (payload.p_delivery_id === "d-moved" ? { message: "This stop was reassigned to Carlo Diaz after you marked it delivered.", code: "OFCON", status: 400 } : null) });
  const box = memoryOutbox(queue({ a: action("moved"), when: at(1) }, { a: action("ok"), when: at(2) }));
  const result = await drainOutbox(box.deps(server.send));
  assert.equal(result.rejected, 1);
  assert.equal(result.sent, 1);
  const moved = box.state.items.find((item) => item.id === "moved");
  assert.equal(moved?.status, "rejected");
  assert.equal(moved?.rejection?.kind, "conflict");
  assert.match(moved?.rejection?.reason ?? "", /reassigned to Carlo Diaz/);
  assert.equal(moved?.rejection?.reported, false, "reported to administrators once the app can reach the server");
});

test("deactivation: queued changes are refused as a permission error, not retried", async () => {
  const server = fakeServer({ refuse: () => ({ message: "Your account can no longer confirm deliveries", code: "42501", status: 403 }) });
  const box = memoryOutbox(queue({ a: action("a"), when: at(1) }, { a: action("b"), when: at(2) }));
  const result = await drainOutbox(box.deps(server.send));
  assert.equal(result.permission, true);
  assert.deepEqual(box.state.items.map((item) => [item.status, item.rejection?.kind]), [["rejected", "permission"], ["rejected", "permission"]]);
  assert.equal(server.applied.length, 0);
});

test("an ended session stops sending and keeps the change waiting for the next sign-in", async () => {
  const box = memoryOutbox(queue({ a: action("a") }));
  const result = await drainOutbox(box.deps(async () => ({ data: null, error: { message: "JWT expired", code: "PGRST301", status: 401 } })));
  assert.equal(result.signedOut, true);
  assert.equal(box.state.items[0].status, "pending");
});

test("account switching: sending stops as soon as another account is signed in", async () => {
  const box = memoryOutbox(queue({ a: action("a"), when: at(1) }, { a: action("b"), when: at(2) }));
  const server = fakeServer();
  const result = await drainOutbox(box.deps(async (rpc, payload) => {
    box.state.user = OFFICE; // signed out and someone else signed in while this was sending
    return server.send(rpc, payload);
  }));
  assert.equal(result.sent, 1);
  assert.equal(box.state.items.find((item) => item.id === "b")?.status, "pending", "left for the driver's next sign-in");
});

test("nothing is sent while offline", async () => {
  const box = memoryOutbox(queue({ a: action("a") }));
  box.state.online = false;
  const server = fakeServer();
  await drainOutbox(box.deps(server.send));
  assert.equal(server.applied.length, 0);
});

// ---------------------------------------------------------------------------
// New orders: price review (D-OF1)
// ---------------------------------------------------------------------------

test("a queued new order whose prices changed waits for review, then is sent with the same id at today's prices", async () => {
  const order = action("order-1", OFFICE, {
    rpc: "offline_create_order",
    args: { p_order: { customer_id: "c1" }, p_items: [], p_source_order_id: null },
    seen: { prices: [{ product_id: "tom", unit: "kg", price: 80 }] },
    label: "New order · Casa Verde",
    targetId: "order-1",
  });
  const details = JSON.stringify([{ product_id: "tom", product_name: "Tomatoes", unit: "kg", seen_price: 80, current_price: "85.00" }]);
  const server = fakeServer({ refuse: (_rpc, payload) => ((payload.p_offline as { accept_current_prices?: boolean }).accept_current_prices ? null : { message: "Prices changed since this order was entered", code: "OFPRC", details, status: 400 }) });
  const box = memoryOutbox(queue({ a: order }), OFFICE);

  await drainOutbox(box.deps(server.send, OFFICE));
  const held = box.state.items[0];
  assert.equal(held.status, "rejected");
  assert.equal(held.rejection?.kind, "price_changed");
  assert.deepEqual(held.rejection?.priceChanges, [{ product_id: "tom", product_name: "Tomatoes", unit: "kg", seen_price: 80, current_price: 85 }]);
  assert.deepEqual((payloadFor(held).p_offline as { seen_prices: unknown }).seen_prices, [{ product_id: "tom", unit: "kg", price: 80 }]);

  box.state.items = acceptPrices(box.state.items, "order-1");
  assert.equal(box.state.items[0].status, "pending");
  assert.equal((payloadFor(box.state.items[0]).p_offline as { accept_current_prices?: boolean }).accept_current_prices, true);
  await drainOutbox(box.deps(server.send, OFFICE));
  assert.equal(box.state.items[0].status, "synced");
  assert.deepEqual(server.applied, ["order-1"]);
});

test("seen prices: the price on screen per product and unit; typed administrator prices are left out", () => {
  const catalog: CatalogItem[] = [
    { id: "tom", name: "Tomatoes", units: [{ key: "base", skuId: null, unit: "kg", price: 80, stock: 10, stockStatus: null }] },
    { id: "car", name: "Carrots", units: [{ key: "base", skuId: null, unit: "kg", price: 60, stock: 10, stockStatus: null }] },
  ];
  const lines = priceLines([
    { productId: "tom", unitKey: "base", quantityText: "2" },
    { productId: "car", unitKey: "base", quantityText: "1", priceText: "55", priceReason: "Regular" },
  ], catalog);
  assert.deepEqual(seenPrices(lines), [{ product_id: "tom", unit: "kg", price: 80 }]);
});

// ---------------------------------------------------------------------------
// Purchasing: ticks saved offline stay visible
// ---------------------------------------------------------------------------

test("packing ticks saved offline show on the board until they sync; the last one on a line wins", () => {
  const board: PackOrder[] = [{
    id: "o1", order_number: "ORD-1", requested_delivery_date: "2026-11-04", status: "for_preparation", customers: null,
    order_items: [
      { id: "l1", quantity: 2, unit_of_measurement: "kg", notes: null, preparation_status: "in_progress", products: null },
      { id: "l2", quantity: 1, unit_of_measurement: "kg", notes: null, preparation_status: "in_progress", products: null },
    ],
  }];
  const tick = (id: string, line: string, packed: boolean, status: OutboxAction["status"] = "pending") =>
    ({ rpc: "offline_set_item_packed", status, args: { p_item_id: line, p_packed: packed }, id });
  const shown = withQueuedTicks(board, [tick("t1", "l1", true), tick("t2", "l2", true), tick("t3", "l2", false), tick("t4", "l1", false, "rejected")]);
  assert.deepEqual(shown[0].order_items.map((line) => line.preparation_status), ["completed", "in_progress"]);
});

test("ticks and delivered send the packing version the screen was loaded with", () => {
  const withVersion = queue({ a: action("v", DRIVER, { seen: { scheduled_date: "2026-11-04", packing_version: 3 } }) })[0];
  assert.equal((payloadFor(withVersion).p_offline as { packing_version?: number }).packing_version, 3);
  // Without one the server refuses with an "update the app" message; nothing is filled in here.
  const without = queue({ a: action("w") })[0];
  assert.equal("packing_version" in (payloadFor(without).p_offline as object), false);
});
