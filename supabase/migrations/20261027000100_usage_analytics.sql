-- RootMap usage analytics: aggregate usage counts and an admin-only summary.
-- See docs/data-architecture-phase2.md, section 20.
--
-- Data boundaries:
-- - Behaviour (feature impressions and clicks, active seconds) is added straight into per-day totals:
--   (day, audience, feature, kind) → count and (day, audience) → seconds. Those tables have no user id, family id,
--   email, device id, guest id, batch id or timestamp, so no family's activity can be read back from them.
-- - Active days are kept apart, only to count distinct active people: (user_id, day) for accounts and
--   (sha256 of a random guest id, day) for guests. They hold no behaviour.
-- - Everything lives in `private`, which the API does not expose and no client role has table grants on. Clients
--   reach it only through record_usage() (write, validated, rate limited) and admin_usage_summary() (admins only,
--   small numbers suppressed).

-- Admins. Added and removed only with SQL by the project owner (SQL editor, or a migration); there is no client path.
--   insert into private.admins (user_id) select id from auth.users where email = '<admin email>';
create table private.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

create table private.usage_counts (
  day date not null,
  audience text not null check (audience in ('account', 'guest')),
  feature text not null check (char_length(feature) <= 64),
  kind text not null check (kind in ('impression', 'click')),
  count bigint not null default 0 check (count >= 0),
  primary key (day, audience, feature, kind)
);

create table private.usage_time (
  day date not null,
  audience text not null check (audience in ('account', 'guest')),
  seconds bigint not null default 0 check (seconds >= 0),
  primary key (day, audience)
);

-- One row per active person per day, with that day's totals for rate limiting.
create table private.account_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  batches integer not null default 0,
  events integer not null default 0,
  seconds integer not null default 0,
  primary key (user_id, day)
);
create index account_days_day_idx on private.account_days (day);

create table private.guest_days (
  guest_hash bytea not null check (octet_length(guest_hash) = 32),
  day date not null,
  batches integer not null default 0,
  events integer not null default 0,
  seconds integer not null default 0,
  primary key (guest_hash, day)
);
create index guest_days_day_idx on private.guest_days (day);

-- Batch ids already counted, so a retried upload is not counted twice. Kept 14 days; random, linked to nothing.
create table private.usage_batches (
  batch_id uuid primary key,
  received_on date not null default current_date
);
create index usage_batches_received_on_idx on private.usage_batches (received_on);

-- Server-wide limits on the anonymous path, per server day.
create table private.usage_limits (
  day date primary key,
  new_guests integer not null default 0,
  guest_batches integer not null default 0
);

alter table private.admins enable row level security;
alter table private.usage_counts enable row level security;
alter table private.usage_time enable row level security;
alter table private.account_days enable row level security;
alter table private.guest_days enable row level security;
alter table private.usage_batches enable row level security;
alter table private.usage_limits enable row level security;
revoke all on private.admins, private.usage_counts, private.usage_time, private.account_days, private.guest_days,
  private.usage_batches, private.usage_limits from public, anon, authenticated;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.admins a where a.user_id = (select auth.uid()));
$$;

-- Completed years of age on `on_date`. A child born on 29 February turns one year older on 1 March in other years.
create function private.whole_years(dob date, on_date date) returns integer
language sql immutable set search_path = '' as $$
  select extract(year from age(on_date, dob))::integer;
$$;

-- Writes one day's usage from one device. Accepts exactly:
--   { "v": 1, "batch_id": uuid, "day": "YYYY-MM-DD", "guest_id": uuid (guests only),
--     "events": [{ "feature": <whitelisted>, "kind": "impression" | "click", "count": 1..500 }], "seconds": 0..43200 }
-- Signed in: counted for the account (auth.uid()); a guest_id is refused, so a guest id is never tied to an account.
-- Not signed in: guest_id is required; only its SHA-256 is stored.
-- Errors: 22023 malformed (the client drops the batch), 54000 over a limit (dropped too).
create function public.record_usage(batch jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  -- features: keep in step with FEATURES in src/lib/analytics/catalog.ts (a unit test compares them)
  features constant text[] := array[
    'today.inspiration', 'today.lookingBack', 'discover.activities', 'discover.books', 'discover.collections',
    'activity.detail', 'activity.save', 'activity.addToWeek', 'activity.markTried', 'music.play', 'collection.save',
    'myWeek.saved', 'moments.add'];
  max_batches constant integer := 100;      -- per person per day
  max_events constant integer := 5000;      -- per person per day
  max_seconds constant integer := 43200;    -- per person per day (12 hours)
  max_new_guests constant integer := 10000; -- per server day
  max_guest_batches constant integer := 100000;
  b_id uuid;
  b_day date;
  b_seconds integer;
  g_hash bytea;
  aud text;
  ev jsonb;
  total integer := 0;
  seen text[] := '{}';
  used record;
  is_new boolean;
begin
  if batch is null or jsonb_typeof(batch) <> 'object' or pg_column_size(batch) > 8192 then
    raise exception 'invalid batch' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(batch) k where k not in ('v', 'batch_id', 'day', 'guest_id', 'events', 'seconds')) then
    raise exception 'unexpected field' using errcode = '22023';
  end if;
  if batch -> 'v' is distinct from '1'::jsonb
     or jsonb_typeof(batch -> 'batch_id') is distinct from 'string'
     or (batch ->> 'batch_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or jsonb_typeof(batch -> 'day') is distinct from 'string'
     or (batch ->> 'day') !~ '^\d{4}-\d{2}-\d{2}$'
     or jsonb_typeof(batch -> 'events') is distinct from 'array'
     or jsonb_array_length(batch -> 'events') > array_length(features, 1) * 2
     or jsonb_typeof(batch -> 'seconds') is distinct from 'number'
     or (batch ->> 'seconds') !~ '^\d{1,5}$' then
    raise exception 'invalid batch' using errcode = '22023';
  end if;
  b_id := (batch ->> 'batch_id')::uuid;
  begin
    b_day := (batch ->> 'day')::date;
  exception when others then
    raise exception 'invalid day' using errcode = '22023';
  end;
  -- The device's local date: allow time zones ahead of the server, and a week of offline days.
  if b_day < current_date - 7 or b_day > current_date + 1 then
    raise exception 'day out of range' using errcode = '22023';
  end if;
  b_seconds := (batch ->> 'seconds')::integer;
  if b_seconds > max_seconds then
    raise exception 'seconds out of range' using errcode = '22023';
  end if;

  for ev in select * from jsonb_array_elements(batch -> 'events') loop
    if jsonb_typeof(ev) <> 'object'
       or exists (select 1 from jsonb_object_keys(ev) k where k not in ('feature', 'kind', 'count'))
       or jsonb_typeof(ev -> 'feature') is distinct from 'string' or not ((ev ->> 'feature') = any (features))
       or jsonb_typeof(ev -> 'kind') is distinct from 'string' or (ev ->> 'kind') not in ('impression', 'click')
       or jsonb_typeof(ev -> 'count') is distinct from 'number' or (ev ->> 'count') !~ '^\d{1,3}$'
       or (ev ->> 'count')::integer not between 1 and 500
       or ((ev ->> 'feature') || ':' || (ev ->> 'kind')) = any (seen) then
      raise exception 'invalid event' using errcode = '22023';
    end if;
    seen := seen || ((ev ->> 'feature') || ':' || (ev ->> 'kind'));
    total := total + (ev ->> 'count')::integer;
  end loop;
  if total = 0 and b_seconds = 0 then
    raise exception 'empty batch' using errcode = '22023';
  end if;

  if uid is not null then
    if batch ? 'guest_id' then
      raise exception 'guest_id is not accepted when signed in' using errcode = '22023';
    end if;
    aud := 'account';
  else
    if jsonb_typeof(batch -> 'guest_id') is distinct from 'string'
       or (batch ->> 'guest_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'guest_id required' using errcode = '22023';
    end if;
    aud := 'guest';
    g_hash := extensions.digest('rootmap-guest:' || (batch ->> 'guest_id'), 'sha256');
  end if;

  -- A batch already counted (a retry) succeeds without counting again.
  insert into private.usage_batches (batch_id) values (b_id) on conflict do nothing;
  if not found then
    return;
  end if;
  delete from private.usage_batches where received_on < current_date - 14;

  if aud = 'account' then
    insert into private.account_days as d (user_id, day) values (uid, b_day) on conflict do nothing;
    select * into used from private.account_days where user_id = uid and day = b_day for update;
  else
    insert into private.guest_days (guest_hash, day) values (g_hash, b_day) on conflict do nothing;
    is_new := found and not exists (select 1 from private.guest_days where guest_hash = g_hash and day <> b_day);
    insert into private.usage_limits (day) values (current_date) on conflict do nothing;
    update private.usage_limits
      set guest_batches = guest_batches + 1, new_guests = new_guests + case when is_new then 1 else 0 end
      where day = current_date
      returning new_guests, guest_batches into used;
    if used.new_guests > max_new_guests or used.guest_batches > max_guest_batches then
      raise exception 'rate limited' using errcode = '54000';
    end if;
    select * into used from private.guest_days where guest_hash = g_hash and day = b_day for update;
  end if;

  if used.batches + 1 > max_batches or used.events + total > max_events then
    raise exception 'rate limited' using errcode = '54000';
  end if;
  -- Time beyond the daily cap is dropped rather than refused, so the counts in the same batch still arrive.
  b_seconds := least(b_seconds, greatest(0, max_seconds - used.seconds));

  if aud = 'account' then
    update private.account_days set batches = batches + 1, events = events + total, seconds = seconds + b_seconds
      where user_id = uid and day = b_day;
  else
    update private.guest_days set batches = batches + 1, events = events + total, seconds = seconds + b_seconds
      where guest_hash = g_hash and day = b_day;
  end if;

  insert into private.usage_counts as c (day, audience, feature, kind, count)
    select b_day, aud, e ->> 'feature', e ->> 'kind', (e ->> 'count')::integer
    from jsonb_array_elements(batch -> 'events') e
    on conflict (day, audience, feature, kind) do update set count = c.count + excluded.count;
  if b_seconds > 0 then
    insert into private.usage_time as t (day, audience, seconds) values (b_day, aud, b_seconds)
      on conflict (day, audience) do update set seconds = t.seconds + excluded.seconds;
  end if;
end;
$$;

-- Whether the caller is an admin: only decides whether the app shows the entry. The summary checks again itself.
create function public.am_i_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin();
$$;

-- The analytics summary for the last `p_days` days (7, 30 or 90), admins only. Every number of people or events
-- from 1 to 2 is returned as null (shown as "<3"); 0 stays 0. Days are the devices' local dates; ages are on the
-- server's current date.
create function public.admin_usage_summary(p_days integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  d_to date := current_date;
  d_from date;
  result jsonb;
begin
  if not private.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if p_days is null or p_days not in (7, 30, 90) then
    raise exception 'days must be 7, 30 or 90' using errcode = '22023';
  end if;
  d_from := d_to - (p_days - 1);

  with
  days as (select generate_series(d_from, d_to, interval '1 day')::date as day),
  acct as (select day, count(*)::bigint n from private.account_days where day between d_from and d_to group by day),
  gst as (select day, count(*)::bigint n from private.guest_days where day between d_from and d_to group by day),
  secs as (select day, sum(seconds)::bigint s from private.usage_time where day between d_from and d_to group by day),
  daily as (
    select d.day, coalesce(a.n, 0) accounts, coalesce(g.n, 0) guests, coalesce(s.s, 0) seconds
    from days d left join acct a using (day) left join gst g using (day) left join secs s using (day)
  ),
  ages as (
    select private.whole_years(c.dob, d_to) age, count(*)::bigint n
    from public.children c
    where c.deleted_at is null and c.origin is distinct from 'demo' and c.dob is not null and c.dob <= d_to
      and exists (select 1 from public.family_members m where m.family_id = c.family_id)
    group by 1
  ),
  feats as (
    select feature,
      coalesce(sum(count) filter (where kind = 'impression'), 0)::bigint impressions,
      coalesce(sum(count) filter (where kind = 'click'), 0)::bigint clicks
    from private.usage_counts where day between d_from and d_to group by feature
  )
  select jsonb_build_object(
    'from', d_from,
    'to', d_to,
    'accounts', jsonb_build_object(
      'total', private.k((select count(*) from auth.users u where u.email_confirmed_at is not null and u.deleted_at is null)),
      'weekly', private.k((select count(distinct user_id) from private.account_days where day > d_to - 7 and day <= d_to)),
      'monthly', private.k((select count(distinct user_id) from private.account_days where day > d_to - 30 and day <= d_to))),
    'guests', jsonb_build_object(
      'weekly', private.k((select count(distinct guest_hash) from private.guest_days where day > d_to - 7 and day <= d_to)),
      'monthly', private.k((select count(distinct guest_hash) from private.guest_days where day > d_to - 30 and day <= d_to))),
    'daily', (select jsonb_agg(jsonb_build_object(
        'day', day,
        'accounts', private.k(accounts),
        'guests', private.k(guests),
        -- Time is shown only for days with at least 3 active people, so one family's time is never visible alone.
        'seconds', case when accounts + guests >= 3 then seconds end,
        'people', private.k(accounts + guests)) order by day) from daily),
    'time', (select jsonb_build_object(
        'seconds', case when sum(accounts + guests) >= 3 then sum(seconds) end,
        'personDays', private.k(sum(accounts + guests)::bigint)) from daily),
    'ages', coalesce((select jsonb_agg(jsonb_build_object('age', age, 'children', private.k(n)) order by age) from ages), '[]'),
    'features', coalesce((select jsonb_agg(jsonb_build_object('feature', feature, 'impressions', private.k(impressions), 'clicks', private.k(clicks)) order by feature) from feats), '[]')
  ) into result;
  return result;
end;
$$;

-- A count as returned to admins: 1 and 2 become null ("<3").
create function private.k(n bigint) returns bigint
language sql immutable set search_path = '' as $$
  select case when n between 1 and 2 then null else n end;
$$;

revoke all on function private.is_admin() from public, anon, authenticated;
revoke all on function private.whole_years(date, date) from public, anon, authenticated;
revoke all on function private.k(bigint) from public, anon, authenticated;

-- record_usage() is the only thing the anonymous role can execute: a fixed, validated, rate-limited write.
revoke all on function public.record_usage(jsonb) from public;
grant execute on function public.record_usage(jsonb) to anon, authenticated, service_role;
revoke all on function public.am_i_admin() from public, anon;
grant execute on function public.am_i_admin() to authenticated, service_role;
revoke all on function public.admin_usage_summary(integer) from public, anon;
grant execute on function public.admin_usage_summary(integer) to authenticated, service_role;
