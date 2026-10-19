-- Only analyzed PUBLIC snapshots are cached; private-token requests never read or write this cache.
create table public.public_scan_cache (
  key text primary key, results jsonb not null, expires_at timestamptz not null
);
create index public_scan_cache_expiry_idx on public.public_scan_cache(expires_at);
alter table public.public_scan_cache enable row level security;
revoke all on public.public_scan_cache from public, anon, authenticated;
grant select, insert, update, delete on public.public_scan_cache to service_role;

-- Server-only budgets and expiring concurrency leases. Keys are HMACs, never IPs, emails or tokens.
create table public.work_budget_buckets (
  key text not null, window_start bigint not null, used integer not null default 0,
  expires_at timestamptz not null, primary key (key, window_start)
);
create index work_budget_expiry_idx on public.work_budget_buckets(expires_at);
create table public.work_budget_leases (
  id uuid primary key default gen_random_uuid(), key text not null, expires_at timestamptz not null
);
create index work_budget_lease_key_idx on public.work_budget_leases(key, expires_at);
create index work_budget_lease_expiry_idx on public.work_budget_leases(expires_at);
alter table public.work_budget_buckets enable row level security;
alter table public.work_budget_leases enable row level security;
revoke all on public.work_budget_buckets, public.work_budget_leases from public, anon, authenticated;
grant select, insert, update, delete on public.work_budget_buckets, public.work_budget_leases to service_role;

create function public.acquire_work_budget(p_rules jsonb, p_concurrency_key text default null,
  p_concurrency_limit integer default 1, p_lease_seconds integer default 90)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r jsonb; v_now timestamptz := clock_timestamp(); v_epoch bigint; v_start bigint;
  v_used integer; v_seconds integer; v_limit integer; v_retry integer; v_lease uuid;
begin
  if jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) > 10
    or p_concurrency_limit < 1 or p_concurrency_limit > 100 or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'Invalid work budget';
  end if;
  -- Short, transaction-scoped lock serializes the check and reserve, including first use of a new bucket.
  perform pg_advisory_xact_lock(hashtextextended('deploydoctor-work-budget-v1', 0));
  v_now := clock_timestamp();
  v_epoch := floor(extract(epoch from v_now));
  delete from public.public_scan_cache where expires_at <= v_now;
  delete from public.work_budget_buckets where expires_at <= v_now;
  delete from public.work_budget_leases where expires_at <= v_now;
  if p_concurrency_key is not null then
    if (select count(*) from public.work_budget_leases where key = p_concurrency_key) >= p_concurrency_limit then
      select greatest(1, ceil(extract(epoch from min(expires_at) - v_now)))::integer into v_retry
        from public.work_budget_leases where key = p_concurrency_key;
      return jsonb_build_object('allowed', false, 'retryAfter', v_retry);
    end if;
  end if;
  for r in select value from jsonb_array_elements(p_rules) loop
    v_seconds := (r->>'seconds')::integer; v_limit := (r->>'limit')::integer;
    if v_seconds < 1 or v_seconds > 86400 or v_limit < 1 or length(r->>'key') <> 64 then raise exception 'Invalid rule'; end if;
    v_start := (v_epoch / v_seconds) * v_seconds;
    select used into v_used from public.work_budget_buckets where key = r->>'key' and window_start = v_start;
    if coalesce(v_used, 0) >= v_limit then
      return jsonb_build_object('allowed', false, 'retryAfter', greatest(1, v_start + v_seconds - v_epoch));
    end if;
  end loop;
  for r in select value from jsonb_array_elements(p_rules) loop
    v_seconds := (r->>'seconds')::integer; v_start := (v_epoch / v_seconds) * v_seconds;
    insert into public.work_budget_buckets(key, window_start, used, expires_at)
      values(r->>'key', v_start, 1, to_timestamp(v_start + v_seconds))
      on conflict(key, window_start) do update set used = public.work_budget_buckets.used + 1;
  end loop;
  if p_concurrency_key is not null then
    insert into public.work_budget_leases(key, expires_at) values(p_concurrency_key, v_now + make_interval(secs => p_lease_seconds)) returning id into v_lease;
  end if;
  return jsonb_build_object('allowed', true, 'lease', v_lease);
end $$;
create function public.release_work_budget(p_id uuid) returns void language sql security invoker set search_path = '' as $$
  delete from public.work_budget_leases where id = p_id;
$$;
revoke all on function public.acquire_work_budget(jsonb,text,integer,integer), public.release_work_budget(uuid) from public, anon, authenticated;
grant execute on function public.acquire_work_budget(jsonb,text,integer,integer), public.release_work_budget(uuid) to service_role;

