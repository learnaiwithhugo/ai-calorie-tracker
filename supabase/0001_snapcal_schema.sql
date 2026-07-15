-- SnapCal Web — initial schema. Run once in the target Supabase project
-- (SQL Editor → paste → Run). Purely additive: creates three new snapcal_*
-- tables and touches nothing else.
--
-- Access model: the browser never talks to Supabase directly. Only the
-- passcode-gated Vercel function /api/sync does, using this project's
-- SERVICE ROLE key kept server-side (bypasses RLS). RLS is enabled with NO
-- policies, so the anon key cannot touch these tables at all.

create table public.snapcal_food_entries (
  id uuid primary key,
  day date not null,
  logged_at timestamptz not null,
  name text not null,
  calories numeric,
  protein_g numeric,
  carbs_g numeric,
  fat_g numeric,
  source text check (source in ('manual','barcode','photo','text')),
  data jsonb not null default '{}'::jsonb, -- full FoodEntry object (items, photo thumb)
  deleted boolean not null default false,  -- tombstone; app filters these out
  updated_at timestamptz not null default now()
);
create index snapcal_food_entries_day_idx on public.snapcal_food_entries (day);

create table public.snapcal_water (
  day date primary key,
  glasses integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.snapcal_profile (
  id integer primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.snapcal_food_entries enable row level security;
alter table public.snapcal_water enable row level security;
alter table public.snapcal_profile enable row level security;
-- No policies on purpose: service-role access only.

comment on table public.snapcal_food_entries is 'SnapCal web app meal log. data = full client FoodEntry JSON (items, photo thumb). Written only by the SnapCal Vercel /api/sync function. deleted=true rows are tombstones.';
comment on table public.snapcal_water is 'SnapCal daily water glasses count, one row per day.';
comment on table public.snapcal_profile is 'SnapCal single-row user profile/goals JSON (id always 1).';
