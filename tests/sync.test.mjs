// sync.test.mjs — LWW merge logic (store.js applyRemote*) and push payload shaping (sync.js),
// with a mock localStorage/fetch. Run with: node --test web/tests/

import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  constructor() {
    this._data = new Map();
  }
  getItem(key) {
    return this._data.has(key) ? this._data.get(key) : null;
  }
  setItem(key, value) {
    this._data.set(key, String(value));
  }
  removeItem(key) {
    this._data.delete(key);
  }
  clear() {
    this._data.clear();
  }
}

globalThis.localStorage = new MemoryStorage();
if (!globalThis.crypto) globalThis.crypto = {};
if (typeof globalThis.crypto.randomUUID !== "function") {
  let n = 0;
  globalThis.crypto.randomUUID = () => `test-uuid-${++n}`;
}
// sync.js's apiFetch path is not exercised directly by these tests, but importing it requires
// a global fetch to exist.
if (typeof globalThis.fetch !== "function") {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ errorType: "unconfigured" }) });
}

const store = await import("../js/store.js");
const sync = await import("../js/sync.js");

// ---------------------------------------------------------------------------
// applyRemoteFoodEntry — last-write-wins merge
// ---------------------------------------------------------------------------

test("applyRemoteFoodEntry — remote newer than local overwrites", () => {
  globalThis.localStorage.clear();
  const entry = store.addFoodEntry({ name: "Local", calories: 100, timestamp: Date.now() });
  const localUpdatedAt = store.getFoodEntry(entry.id).updatedAt;

  store.applyRemoteFoodEntry({
    id: entry.id,
    deleted: false,
    updatedAt: localUpdatedAt + 1000,
    data: { ...entry, name: "Remote wins", calories: 250 },
  });

  const after = store.getFoodEntry(entry.id);
  assert.equal(after.name, "Remote wins");
  assert.equal(after.calories, 250);
});

test("applyRemoteFoodEntry — local newer than remote is kept (never lose a newer local record)", () => {
  globalThis.localStorage.clear();
  const entry = store.addFoodEntry({ name: "Local newer", calories: 100, timestamp: Date.now() });
  const localUpdatedAt = store.getFoodEntry(entry.id).updatedAt;

  store.applyRemoteFoodEntry({
    id: entry.id,
    deleted: false,
    updatedAt: localUpdatedAt - 1000,
    data: { ...entry, name: "Stale remote", calories: 999 },
  });

  const after = store.getFoodEntry(entry.id);
  assert.equal(after.name, "Local newer");
  assert.equal(after.calories, 100);
});

test("applyRemoteFoodEntry — a tie (equal updatedAt) keeps the local copy", () => {
  globalThis.localStorage.clear();
  const entry = store.addFoodEntry({ name: "Local tie", calories: 100, timestamp: Date.now() });
  const localUpdatedAt = store.getFoodEntry(entry.id).updatedAt;

  store.applyRemoteFoodEntry({
    id: entry.id,
    deleted: false,
    updatedAt: localUpdatedAt,
    data: { ...entry, name: "Remote tie", calories: 999 },
  });

  assert.equal(store.getFoodEntry(entry.id).name, "Local tie");
});

test("applyRemoteFoodEntry — inserts a brand-new remote record not present locally", () => {
  globalThis.localStorage.clear();
  store.applyRemoteFoodEntry({
    id: "remote-only-id",
    deleted: false,
    updatedAt: Date.now(),
    data: { id: "remote-only-id", name: "From another device", calories: 400, timestamp: Date.now() },
  });
  const found = store.getFoodEntry("remote-only-id");
  assert.ok(found);
  assert.equal(found.name, "From another device");
});

test("applyRemoteFoodEntry — deleted:true tombstone removes a local record when newer", () => {
  globalThis.localStorage.clear();
  const entry = store.addFoodEntry({ name: "Deleted remotely", calories: 100, timestamp: Date.now() });
  const localUpdatedAt = store.getFoodEntry(entry.id).updatedAt;

  store.applyRemoteFoodEntry({ id: entry.id, deleted: true, updatedAt: localUpdatedAt + 1000 });

  assert.equal(store.getFoodEntry(entry.id), null);
});

test("applyRemoteFoodEntry — deleted:true tombstone does NOT remove a local record newer than it", () => {
  globalThis.localStorage.clear();
  const entry = store.addFoodEntry({ name: "Survives", calories: 100, timestamp: Date.now() });
  const localUpdatedAt = store.getFoodEntry(entry.id).updatedAt;

  store.applyRemoteFoodEntry({ id: entry.id, deleted: true, updatedAt: localUpdatedAt - 1000 });

  assert.ok(store.getFoodEntry(entry.id));
});

test("deleteFoodEntry — vanishes from allFoodEntries but leaves a tombstone marker for sync", () => {
  globalThis.localStorage.clear();
  const entry = store.addFoodEntry({ name: "Delete me", calories: 100, timestamp: Date.now() });
  const changed = store.deleteFoodEntry(entry.id);

  assert.equal(changed, true);
  assert.equal(store.getFoodEntry(entry.id), null);
  assert.equal(store.allFoodEntries().length, 0);

  const tombstones = store.allDeletedTombstones();
  assert.equal(tombstones.length, 1);
  assert.equal(tombstones[0].id, entry.id);
});

test("clearDeletedTombstones — drops confirmed-pushed tombstones", () => {
  globalThis.localStorage.clear();
  const entry = store.addFoodEntry({ name: "Delete me", calories: 100, timestamp: Date.now() });
  store.deleteFoodEntry(entry.id);
  assert.equal(store.allDeletedTombstones().length, 1);

  store.clearDeletedTombstones([entry.id]);
  assert.equal(store.allDeletedTombstones().length, 0);
});

test("applyRemoteWater / applyRemoteProfile — last-write-wins by updatedAt", () => {
  globalThis.localStorage.clear();
  const day = new Date(2026, 5, 1).getTime();
  store.incrementWater(day); // local glasses=1
  const localWaterUpdatedAt = store.getWaterEntryForDay(day).updatedAt;
  const dayIso = "2026-06-01"; // matches new Date(2026,5,1) as a device-local calendar date

  store.applyRemoteWater(dayIso, 9, localWaterUpdatedAt - 1000);
  assert.equal(store.getWaterEntryForDay(day).glasses, 1, "stale remote water ignored");

  store.applyRemoteWater(dayIso, 9, localWaterUpdatedAt + 1000);
  assert.equal(store.getWaterEntryForDay(day).glasses, 9, "newer remote water applied");

  store.setProfile({ weightKg: 70 });
  const profileUpdatedAt = store.getProfile().updatedAt;
  store.applyRemoteProfile({ weightKg: 999 }, profileUpdatedAt - 1000);
  assert.equal(store.getProfile().weightKg, 70, "stale remote profile ignored");

  store.applyRemoteProfile({ weightKg: 55 }, profileUpdatedAt + 1000);
  assert.equal(store.getProfile().weightKg, 55, "newer remote profile applied");
});

// ---------------------------------------------------------------------------
// sync.js — buildPushPayload shaping
// ---------------------------------------------------------------------------

test("buildPushPayload — shapes a dirty entry for the server and matches the sync API contract", () => {
  globalThis.localStorage.clear();
  const before = Date.now();
  const entry = store.addFoodEntry({
    name: "Breakfast",
    calories: 300,
    proteinG: 20,
    carbsG: 30,
    fatG: 10,
    timestamp: Date.now(),
    source: "manual",
  });

  const payload = sync.buildPushPayload(before - 1);
  assert.equal(payload.entries.length, 1);

  const row = payload.entries[0];
  assert.equal(row.id, entry.id);
  assert.equal(row.name, "Breakfast");
  assert.equal(row.calories, 300);
  assert.equal(row.proteinG, 20);
  assert.equal(row.carbsG, 30);
  assert.equal(row.fatG, 10);
  assert.equal(row.source, "manual");
  assert.equal(row.deleted, false);
  assert.match(row.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(row.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(row.data.id, entry.id, "full FoodEntry object is embedded as data");
});

test("buildPushPayload — a future cutoff excludes everything (nothing dirty)", () => {
  globalThis.localStorage.clear();
  store.addFoodEntry({ name: "Snack", calories: 50, timestamp: Date.now() });
  const payload = sync.buildPushPayload(Date.now() + 100000);
  assert.equal(payload.entries.length, 0);
  assert.equal(payload.water.length, 0);
  assert.equal(payload.profile, null);
});

test("buildPushPayload — deletions are shaped as deleted:true tombstone rows", () => {
  globalThis.localStorage.clear();
  const before = Date.now();
  const entry = store.addFoodEntry({ name: "Snack", calories: 50, timestamp: Date.now() });
  store.deleteFoodEntry(entry.id);

  const payload = sync.buildPushPayload(before - 1);
  const tombstoneRow = payload.entries.find((e) => e.id === entry.id);
  assert.ok(tombstoneRow);
  assert.equal(tombstoneRow.deleted, true);
  assert.deepEqual(payload.tombstoneIds, [entry.id]);
});

test("buildPushPayload — includes dirty water and profile rows shaped for the server", () => {
  globalThis.localStorage.clear();
  const before = Date.now();
  store.incrementWater(new Date(2026, 5, 1));
  store.setProfile({ weightKg: 80 });

  const payload = sync.buildPushPayload(before - 1);
  assert.equal(payload.water.length, 1);
  assert.match(payload.water[0].day, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(payload.water[0].glasses, 1);

  assert.ok(payload.profile);
  assert.equal(payload.profile.data.weightKg, 80);
  assert.match(payload.profile.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

// ---------------------------------------------------------------------------
// sync.js — status surface
// ---------------------------------------------------------------------------

test("getSyncStatus — defaults to state 'off' before initSync/syncNow ever run", () => {
  const status = sync.getSyncStatus();
  assert.equal(status.state, "off");
  assert.equal(status.lastSyncAt, null);
});
