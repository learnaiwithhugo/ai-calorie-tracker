// store.js — localStorage data layer for FoodEntry / WaterEntry / UserProfile / SavedFood.
// Mirrors the SwiftData persistence semantics described in SPEC-LOGIC.md §1, §13.
// Uses `globalThis.localStorage` so it can be exercised under Node with a mock (see tests).

import { startOfDay, addDays, computeStreak, resolveUserGoals, normalizeEntrySource, normalizeSex, normalizeActivityLevel, localDateString } from "./nutrition.js";

export const STORAGE_KEYS = Object.freeze({
  foodEntries: "snapcal.foodEntries",
  waterEntries: "snapcal.waterEntries",
  userProfile: "snapcal.userProfile",
  savedFoods: "snapcal.savedFoods",
  notifyBannerDismissed: "snapcal.notifyBannerDismissed",
  deletedEntryTombstones: "snapcal.deletedEntryTombstones",
});

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function ls() {
  if (typeof globalThis.localStorage === "undefined") {
    throw new Error("store.js requires a localStorage implementation on globalThis");
  }
  return globalThis.localStorage;
}

function readJSON(key, fallback) {
  const raw = ls().getItem(key);
  if (raw == null) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  ls().setItem(key, JSON.stringify(value));
}

function generateId() {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Fallback id generator (non-cryptographic) for environments without crypto.randomUUID.
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Pub/sub
// ---------------------------------------------------------------------------

const listeners = new Set();

/** Subscribe to any store mutation. Returns an unsubscribe function. */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error("store.js: subscriber threw", err);
    }
  }
}

// ---------------------------------------------------------------------------
// FoodEntry
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} FoodEntry
 * @property {string} id
 * @property {string} name
 * @property {number} calories
 * @property {number} proteinG
 * @property {number} carbsG
 * @property {number} fatG
 * @property {number} timestamp - ms since epoch
 * @property {string|null} photoDataUrl - JPEG as a data: URL, or null
 * @property {"manual"|"barcode"|"photo"|"text"} source
 * @property {boolean|null} isPending
 * @property {boolean|null} analysisFailed
 * @property {Array|null} analysisItems - AnalyzedFoodItem[] once analysis completes
 * @property {string|null} analysisFailureReason
 * @property {"meal"|"label"|"text"|null} analysisMode
 * @property {string|null} analysisDescription
 * @property {number} updatedAt - ms since epoch, bumped on create/update; used for sync LWW merge
 */

function allFoodEntriesRaw() {
  return readJSON(STORAGE_KEYS.foodEntries, []);
}

function saveFoodEntries(entries) {
  writeJSON(STORAGE_KEYS.foodEntries, entries);
  notify();
}

/** Default field values, mirrors FoodEntry init defaults in Models.swift. */
export function makeFoodEntry(fields) {
  const now = Date.now();
  return {
    id: fields.id ?? generateId(),
    name: fields.name ?? "",
    calories: fields.calories ?? 0,
    proteinG: fields.proteinG ?? 0,
    carbsG: fields.carbsG ?? 0,
    fatG: fields.fatG ?? 0,
    timestamp: fields.timestamp ?? now,
    photoDataUrl: fields.photoDataUrl ?? null,
    source: normalizeEntrySource(fields.source ?? "manual"),
    isPending: fields.isPending ?? null,
    analysisFailed: fields.analysisFailed ?? null,
    analysisItems: fields.analysisItems ?? null,
    analysisFailureReason: fields.analysisFailureReason ?? null,
    analysisMode: fields.analysisMode ?? null,
    analysisDescription: fields.analysisDescription ?? null,
    updatedAt: fields.updatedAt ?? now,
  };
}

/** All food entries (no ordering guarantee). */
export function allFoodEntries() {
  return allFoodEntriesRaw();
}

export function getFoodEntry(id) {
  return allFoodEntriesRaw().find((e) => e.id === id) ?? null;
}

/** Insert a fully-formed entry (or field subset — defaults are applied). Returns the stored entry. */
export function addFoodEntry(fields) {
  const entry = makeFoodEntry(fields);
  const entries = allFoodEntriesRaw();
  entries.push(entry);
  saveFoodEntries(entries);
  return entry;
}

/** Shallow-merge patch into an existing entry by id. Returns the updated entry, or null if not found. */
export function updateFoodEntry(id, patch) {
  const entries = allFoodEntriesRaw();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  entries[idx] = { ...entries[idx], ...patch, updatedAt: patch.updatedAt ?? Date.now() };
  saveFoodEntries(entries);
  return entries[idx];
}

/**
 * Deletes an entry. UX is unchanged (the entry vanishes from allFoodEntries/entriesForDay etc.
 * exactly as before) but a lightweight tombstone {id, day, deletedAt} is recorded separately so
 * sync.js can propagate the deletion — see allDeletedTombstones()/clearDeletedTombstones().
 */
export function deleteFoodEntry(id) {
  const entries = allFoodEntriesRaw();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  const [removed] = entries.splice(idx, 1);
  saveFoodEntries(entries);

  const tombstones = allDeletedTombstonesRaw();
  tombstones.push({ id, day: localDateString(removed.timestamp), deletedAt: Date.now() });
  saveDeletedTombstones(tombstones);
  return true;
}

// ---------------------------------------------------------------------------
// Sync support — tombstones (deletions) + LWW merge of remote records.
// Never called from UI code; see js/sync.js.
// ---------------------------------------------------------------------------

function allDeletedTombstonesRaw() {
  return readJSON(STORAGE_KEYS.deletedEntryTombstones, []);
}

function saveDeletedTombstones(list) {
  writeJSON(STORAGE_KEYS.deletedEntryTombstones, list);
}

/** Pending deletions not yet confirmed pushed to the sync server. */
export function allDeletedTombstones() {
  return allDeletedTombstonesRaw();
}

/** Drops tombstones once sync.js has confirmed they were pushed successfully. */
export function clearDeletedTombstones(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return;
  const set = new Set(ids);
  const remaining = allDeletedTombstonesRaw().filter((t) => !set.has(t.id));
  saveDeletedTombstones(remaining);
}

/**
 * Merges one remote FoodEntry record (from a sync pull) into local storage using last-write-wins
 * on updatedAt (ms epoch). `remote.data` is the full FoodEntry object as originally pushed;
 * `remote.deleted` is a tombstone flag. A tie (equal updatedAt) keeps the local copy.
 */
export function applyRemoteFoodEntry(remote) {
  const entries = allFoodEntriesRaw();
  const idx = entries.findIndex((e) => e.id === remote.id);
  const remoteUpdatedAt = remote.updatedAt ?? 0;
  const localUpdatedAt = idx !== -1 ? entries[idx].updatedAt ?? 0 : -1;

  if (remote.deleted) {
    if (idx !== -1 && localUpdatedAt <= remoteUpdatedAt) {
      entries.splice(idx, 1);
      saveFoodEntries(entries);
    }
    return;
  }

  if (localUpdatedAt >= remoteUpdatedAt) return; // local is newer or tied — keep local

  const merged = makeFoodEntry({ ...(remote.data ?? {}), id: remote.id, updatedAt: remoteUpdatedAt });
  if (idx === -1) entries.push(merged);
  else entries[idx] = merged;
  saveFoodEntries(entries);
}

/** Entries whose calendar day (device-local) matches `date`. No midnight cron — recomputed live. */
export function entriesForDay(date = new Date()) {
  const start = startOfDay(date);
  const end = addDays(start, 1);
  return allFoodEntriesRaw().filter((e) => e.timestamp >= start && e.timestamp < end);
}

/** Sum of calories/macros for a given day. */
export function totalsForDay(date = new Date()) {
  return entriesForDay(date).reduce(
    (acc, e) => ({
      calories: acc.calories + e.calories,
      proteinG: acc.proteinG + e.proteinG,
      carbsG: acc.carbsG + e.carbsG,
      fatG: acc.fatG + e.fatG,
    }),
    { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
  );
}

/** Set of start-of-day timestamps that have at least one logged entry (streak + week-strip dots). */
export function loggedDaySet() {
  return new Set(allFoodEntriesRaw().map((e) => startOfDay(e.timestamp)));
}

/** Current streak in days, as of `today`. */
export function streak(today = new Date()) {
  return computeStreak(loggedDaySet(), today);
}

/** allEntries sorted timestamp-descending, capped to the first `limit` (default 10). */
export function recentlyUploaded(limit = 10) {
  return [...allFoodEntriesRaw()].sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}

/**
 * History grouped by calendar day, newest bucket first, newest entry first within a bucket.
 * @returns {Array<{dayStart:number, total:{calories:number,proteinG:number,carbsG:number,fatG:number}, entries:FoodEntry[]}>}
 */
export function historyGroupedByDay() {
  const byDay = new Map();
  for (const entry of allFoodEntriesRaw()) {
    const day = startOfDay(entry.timestamp);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(entry);
  }
  const buckets = [...byDay.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([dayStart, entries]) => {
      const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
      const total = sorted.reduce(
        (acc, e) => ({
          calories: acc.calories + e.calories,
          proteinG: acc.proteinG + e.proteinG,
          carbsG: acc.carbsG + e.carbsG,
          fatG: acc.fatG + e.fatG,
        }),
        { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 }
      );
      return { dayStart, total, entries: sorted };
    });
  return buckets;
}

/**
 * Monday-start week strip (7 columns Mon->Sun) for the week containing `referenceDate`.
 * daysSinceMonday = (swiftWeekday + 5) % 7, swiftWeekday = JS getDay() + 1 (1=Sunday), matching
 * Calendar.component(.weekday) semantics from the spec so Monday is always column 0.
 * @returns {Array<{dayStart:number, hasLog:boolean}>}
 */
export function weekStrip(referenceDate = new Date()) {
  const startToday = startOfDay(referenceDate);
  const jsDay = new Date(startToday).getDay(); // 0=Sunday..6=Saturday
  const swiftWeekday = jsDay + 1; // 1=Sunday..7=Saturday
  const daysSinceMonday = (swiftWeekday + 5) % 7;
  const monday = addDays(startToday, -daysSinceMonday);
  const logged = loggedDaySet();
  return Array.from({ length: 7 }, (_, i) => {
    const dayStart = addDays(monday, i);
    return { dayStart, hasLog: logged.has(dayStart) };
  });
}

// ---------------------------------------------------------------------------
// WaterEntry — one row per calendar day, created lazily on first "+" tap
// ---------------------------------------------------------------------------

function allWaterEntriesRaw() {
  return readJSON(STORAGE_KEYS.waterEntries, []);
}

function saveWaterEntries(entries) {
  writeJSON(STORAGE_KEYS.waterEntries, entries);
  notify();
}

/** All stored WaterEntry rows (no ordering guarantee). */
export function allWaterEntries() {
  return allWaterEntriesRaw();
}

/** Returns the stored WaterEntry for `date`, or a transient {date, glasses:0} if none exists yet. */
export function getWaterEntryForDay(date = new Date()) {
  const day = startOfDay(date);
  const found = allWaterEntriesRaw().find((w) => w.date === day);
  return found ?? { date: day, glasses: 0 };
}

/** Increments glasses for `date`, creating the row lazily if it doesn't exist yet. */
export function incrementWater(date = new Date()) {
  const day = startOfDay(date);
  const entries = allWaterEntriesRaw();
  const idx = entries.findIndex((w) => w.date === day);
  if (idx === -1) {
    entries.push({ date: day, glasses: 1, updatedAt: Date.now() });
  } else {
    entries[idx] = { ...entries[idx], glasses: entries[idx].glasses + 1, updatedAt: Date.now() };
  }
  saveWaterEntries(entries);
  return getWaterEntryForDay(day);
}

/** Decrements glasses for `date`, clamped >=0. No-op (never creates a row) if none exists yet. */
export function decrementWater(date = new Date()) {
  const day = startOfDay(date);
  const entries = allWaterEntriesRaw();
  const idx = entries.findIndex((w) => w.date === day);
  if (idx === -1) return { date: day, glasses: 0 };
  const nextGlasses = Math.max(0, entries[idx].glasses - 1);
  entries[idx] = { ...entries[idx], glasses: nextGlasses, updatedAt: Date.now() };
  saveWaterEntries(entries);
  return entries[idx];
}

/** Sync-only: merges a remote water row (LWW on updatedAt, ms epoch). `day` is "YYYY-MM-DD". */
export function applyRemoteWater(day, glasses, updatedAt) {
  const [y, m, d] = String(day).split("-").map(Number);
  const dayStart = startOfDay(new Date(y, m - 1, d));
  const entries = allWaterEntriesRaw();
  const idx = entries.findIndex((w) => w.date === dayStart);
  const localUpdatedAt = idx !== -1 ? entries[idx].updatedAt ?? 0 : -1;
  if (localUpdatedAt >= (updatedAt ?? 0)) return;
  const merged = { date: dayStart, glasses, updatedAt };
  if (idx === -1) entries.push(merged);
  else entries[idx] = merged;
  saveWaterEntries(entries);
}

// ---------------------------------------------------------------------------
// UserProfile — singleton row
// ---------------------------------------------------------------------------

const DEFAULT_PROFILE = Object.freeze({
  weightKg: 0,
  heightCm: 0,
  age: 0,
  sex: "male",
  activityLevel: "sedentary",
  targetDeltaKcal: 0,
  customTargetKcal: null,
  customProteinG: null,
  customCarbsG: null,
  customFatG: null,
});

export function getProfile() {
  const stored = readJSON(STORAGE_KEYS.userProfile, null);
  if (!stored) return { ...DEFAULT_PROFILE };
  return {
    ...DEFAULT_PROFILE,
    ...stored,
    sex: normalizeSex(stored.sex),
    activityLevel: normalizeActivityLevel(stored.activityLevel),
  };
}

/** Shallow-merges `patch` into the singleton profile and persists it. */
export function setProfile(patch) {
  const next = { ...getProfile(), ...patch, updatedAt: Date.now() };
  writeJSON(STORAGE_KEYS.userProfile, next);
  notify();
  return next;
}

/** TDEE/goals helper — custom-first resolution per NutritionMath.resolveUserGoals. */
export function computeGoals() {
  return resolveUserGoals(getProfile());
}

/** Sync-only: merges a remote profile row (LWW on updatedAt, ms epoch). */
export function applyRemoteProfile(data, updatedAt) {
  const stored = readJSON(STORAGE_KEYS.userProfile, null);
  const localUpdatedAt = stored?.updatedAt ?? -1;
  if (localUpdatedAt >= (updatedAt ?? 0)) return;
  writeJSON(STORAGE_KEYS.userProfile, { ...data, updatedAt });
  notify();
}

// ---------------------------------------------------------------------------
// Saved foods (quick re-log)
// ---------------------------------------------------------------------------

function allSavedFoodsRaw() {
  return readJSON(STORAGE_KEYS.savedFoods, []);
}

function saveSavedFoods(list) {
  writeJSON(STORAGE_KEYS.savedFoods, list);
  notify();
}

export function allSavedFoods() {
  return allSavedFoodsRaw();
}

/** Saves a food for quick re-logging later. `source` is copied but analysisItems is NEVER copied. */
export function addSavedFood({ name, calories, proteinG = 0, carbsG = 0, fatG = 0, source = "manual" }) {
  const saved = {
    id: generateId(),
    name,
    calories,
    proteinG,
    carbsG,
    fatG,
    source: normalizeEntrySource(source),
    createdAt: Date.now(),
  };
  const list = allSavedFoodsRaw();
  list.push(saved);
  saveSavedFoods(list);
  return saved;
}

export function deleteSavedFood(id) {
  const list = allSavedFoodsRaw();
  const next = list.filter((f) => f.id !== id);
  const changed = next.length !== list.length;
  if (changed) saveSavedFoods(next);
  return changed;
}

/**
 * Logs a saved food as a brand-new FoodEntry. `source` is copied from the saved food, but
 * `analysisItems` is intentionally left null so this never opens the AI results screen
 * (detection is on analysisItems presence, not on `source === "photo"` — see spec §6 state 3).
 */
export function logSavedFood(id, { timestamp = Date.now() } = {}) {
  const saved = allSavedFoodsRaw().find((f) => f.id === id);
  if (!saved) return null;
  return addFoodEntry({
    name: saved.name,
    calories: saved.calories,
    proteinG: saved.proteinG,
    carbsG: saved.carbsG,
    fatG: saved.fatG,
    source: saved.source,
    timestamp,
    analysisItems: null,
  });
}

// ---------------------------------------------------------------------------
// Misc persisted flags
// ---------------------------------------------------------------------------

export function isNotifyBannerDismissed() {
  return readJSON(STORAGE_KEYS.notifyBannerDismissed, false) === true;
}

export function setNotifyBannerDismissed(value = true) {
  writeJSON(STORAGE_KEYS.notifyBannerDismissed, value === true);
  notify();
}
