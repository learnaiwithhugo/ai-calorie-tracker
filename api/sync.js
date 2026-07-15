// api/sync.js — Vercel serverless function (Node runtime). Mirrors localStorage into Supabase
// via PostgREST (zero npm deps — global fetch), so the browser never talks to Supabase directly
// and the anon key never reaches the client. Passcode-gated by api/_auth.js, same as gemini.js.
//
// Request:  POST { op: "push", entries?: Row[], water?: Row[], profile?: Row }
//           POST { op: "pull", since?: isoString }
// Response: push -> { ok: true } | pull -> { entries, water, profile, serverTime }
//           If SUPABASE_URL / a key (SUPABASE_SERVICE_ROLE_KEY preferred, SUPABASE_ANON_KEY fallback) are unset -> { errorType: "unconfigured" }
//           (client treats this as "sync off" and goes silent — see js/sync.js).
//
// Tables (supabase/0001_snapcal_schema.sql): snapcal_food_entries, snapcal_water, snapcal_profile.
// Resolution: last-write-wins on updated_at, implemented via PostgREST upsert with
// Prefer: resolution=merge-duplicates (server-side "latest row wins" is actually decided by the
// CLIENT before it pushes — see js/sync.js's LWW merge — this upsert just replaces whatever row
// existed for that id/day/id=1, which is correct because the client only ever pushes records it
// has already determined are newer than what it last pulled).

import { checkAuth } from "./_auth.js";

function supabaseConfigured() {
  return Boolean((process.env.SUPABASE_URL || "").trim() && ((process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim()));
}

function restBase() {
  return (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
}

function restHeaders(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function parseRequestBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim() !== "") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

/** Upserts `rows` into `table`, resolving conflicts on `onConflict` in favor of the pushed row. */
async function upsert(table, rows, onConflict) {
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true };
  try {
    const url = `${restBase()}/rest/v1/${table}?on_conflict=${onConflict}`;
    const res = await fetch(url, {
      method: "POST",
      headers: restHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, message: `Supabase upsert ${table} HTTP ${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: `Supabase upsert ${table} network error: ${err?.message ?? err}` };
  }
}

/** Selects every row in `table` updated at/after `since` (or all rows if `since` is absent). */
async function selectSince(table, since) {
  const params = new URLSearchParams({ select: "*", order: "updated_at.asc" });
  if (since) params.set("updated_at", `gte.${since}`);
  const res = await fetch(`${restBase()}/rest/v1/${table}?${params.toString()}`, { headers: restHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase select ${table} HTTP ${res.status}: ${text}`);
  }
  return await res.json();
}

export default async function handler(req, res) {
  if (!checkAuth(req, res)) return;

  if (req.method !== "POST") {
    res.status(405).json({ errorType: "other", message: "Method not allowed" });
    return;
  }

  if (!supabaseConfigured()) {
    res.status(200).json({ errorType: "unconfigured" });
    return;
  }

  const body = parseRequestBody(req);

  if (body.op === "push") {
    const entryRows = (Array.isArray(body.entries) ? body.entries : []).map((e) => ({
      id: e.id,
      day: e.day,
      logged_at: e.loggedAt,
      name: e.name ?? "",
      calories: e.calories ?? null,
      protein_g: e.proteinG ?? null,
      carbs_g: e.carbsG ?? null,
      fat_g: e.fatG ?? null,
      source: e.source ?? null,
      data: e.data ?? {},
      deleted: Boolean(e.deleted),
      updated_at: e.updatedAt,
    }));
    const waterRows = (Array.isArray(body.water) ? body.water : []).map((w) => ({
      day: w.day,
      glasses: w.glasses,
      updated_at: w.updatedAt,
    }));
    const profileRows = body.profile
      ? [{ id: 1, data: body.profile.data ?? {}, updated_at: body.profile.updatedAt }]
      : [];

    const [entriesResult, waterResult, profileResult] = await Promise.all([
      upsert("snapcal_food_entries", entryRows, "id"),
      upsert("snapcal_water", waterRows, "day"),
      upsert("snapcal_profile", profileRows, "id"),
    ]);

    const failures = [entriesResult, waterResult, profileResult].filter((r) => !r.ok);
    if (failures.length > 0) {
      res.status(200).json({ errorType: "other", message: failures.map((f) => f.message).join("; ") });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  if (body.op === "pull") {
    const since = typeof body.since === "string" && body.since.trim() !== "" ? body.since.trim() : undefined;
    const serverTime = new Date().toISOString();
    let entries, water, profile;
    try {
      [entries, water, profile] = await Promise.all([
        selectSince("snapcal_food_entries", since),
        selectSince("snapcal_water", since),
        selectSince("snapcal_profile", since),
      ]);
    } catch (err) {
      res.status(200).json({ errorType: "other", message: err?.message ?? String(err) });
      return;
    }

    res.status(200).json({
      entries: entries.map((r) => ({
        id: r.id,
        day: r.day,
        loggedAt: r.logged_at,
        name: r.name,
        calories: r.calories,
        proteinG: r.protein_g,
        carbsG: r.carbs_g,
        fatG: r.fat_g,
        source: r.source,
        data: r.data,
        deleted: r.deleted,
        updatedAt: r.updated_at,
      })),
      water: water.map((r) => ({ day: r.day, glasses: r.glasses, updatedAt: r.updated_at })),
      profile: profile[0] ? { data: profile[0].data, updatedAt: profile[0].updated_at } : null,
      serverTime,
    });
    return;
  }

  res.status(200).json({ errorType: "other", message: "Unknown op" });
}
