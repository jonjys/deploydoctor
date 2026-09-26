-- Additive: v1 public report storage and URLs remain unchanged.
create table public.scan_limits (
  ip_hash text not null,
  day date not null,
  scans integer not null default 0 check (scans between 0 and 3),
  primary key (ip_hash, day)
);
create table public.scan_reservations (
  id uuid primary key,
  ip_hash text not null,
  day date not null
);
create table public.subscriptions (
  id text primary key,
  email text not null,
  plan text not null check (plan in ('week', 'public', 'private')),
  status text not null,
  stripe_customer_id text not null,
  current_period_end timestamptz not null,
  event_created bigint not null default 0
);
create index subscriptions_customer_idx on public.subscriptions (stripe_customer_id, email);
-- Keep private scans outside reports: older deployed app versions may still read reports.
create table public.private_reports (
  id uuid primary key default gen_random_uuid(),
  repo_url text not null,
  results jsonb not null,
  created_at timestamptz not null default now(),
  stripe_customer_id text not null
);
create table public.report_history (
  report_id uuid primary key,
  stripe_customer_id text not null,
  repo_url text not null,
  is_private boolean not null default false,
  created_at timestamptz not null default now()
);
create index report_history_customer_idx on public.report_history (stripe_customer_id, created_at desc);
create table public.repair_orders (
  id text primary key,
  email text not null,
  stripe_customer_id text not null,
  report_id uuid not null,
  check_id text,
  plan text not null check (plan in ('fix-one', 'fix-all')),
  status text not null default 'paid',
  context text,
  patch_text text,
  created_at timestamptz not null default now()
);
create index repair_orders_customer_idx on public.repair_orders (stripe_customer_id);
create table public.stripe_events (id text primary key, created_at timestamptz not null default now());

alter table public.scan_limits enable row level security;
alter table public.scan_reservations enable row level security;
alter table public.subscriptions enable row level security;
alter table public.private_reports enable row level security;
alter table public.report_history enable row level security;
alter table public.repair_orders enable row level security;
alter table public.stripe_events enable row level security;
revoke all on public.scan_limits, public.scan_reservations, public.subscriptions,
  public.private_reports, public.report_history, public.repair_orders, public.stripe_events from anon, authenticated;
grant select, insert, update, delete on public.scan_limits, public.scan_reservations,
  public.subscriptions, public.private_reports, public.report_history, public.repair_orders,
  public.stripe_events to service_role;

create function public.reserve_scan(p_ip_hash text, p_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_day date := (now() at time zone 'UTC')::date; v_count integer;
begin
  insert into public.scan_limits (ip_hash, day, scans) values (p_ip_hash, v_day, 1)
  on conflict (ip_hash, day) do update set scans = public.scan_limits.scans + 1
    where public.scan_limits.scans < 3
  returning scans into v_count;
  if v_count is not null then
    insert into public.scan_reservations values (p_id, p_ip_hash, v_day);
  end if;
  return jsonb_build_object('allowed', v_count is not null, 'remaining', 3 - coalesce(v_count, 3),
    'resetsAt', (v_day + 1)::timestamp at time zone 'UTC');
end $$;

create function public.finish_scan(p_id uuid, p_success boolean)
returns void language plpgsql security invoker set search_path = '' as $$
declare v_res public.scan_reservations;
begin
  delete from public.scan_reservations where id = p_id returning * into v_res;
  if found and not p_success then
    update public.scan_limits set scans = greatest(0, scans - 1)
    where ip_hash = v_res.ip_hash and day = v_res.day;
  end if;
end $$;

-- Deduplication and fulfillment commit together; failed writes remain retryable.
create function public.apply_billing_event(p_event_id text, p_created bigint,
  p_entitlement jsonb default null, p_order jsonb default null)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.stripe_events (id) values (p_event_id) on conflict do nothing;
  if not found then return; end if;
  if p_entitlement is not null then
    insert into public.subscriptions (id, email, plan, status, stripe_customer_id, current_period_end, event_created)
    values (p_entitlement->>'id', lower(p_entitlement->>'email'), p_entitlement->>'plan',
      p_entitlement->>'status', p_entitlement->>'stripe_customer_id',
      (p_entitlement->>'current_period_end')::timestamptz, p_created)
    on conflict (id) do update set email = excluded.email, plan = excluded.plan,
      status = excluded.status, stripe_customer_id = excluded.stripe_customer_id,
      current_period_end = excluded.current_period_end, event_created = excluded.event_created
    where excluded.event_created >= public.subscriptions.event_created
      and public.subscriptions.status <> 'canceled';
  end if;
  if p_order is not null then
    insert into public.repair_orders (id, email, stripe_customer_id, report_id, check_id, plan, context)
    values (p_order->>'id', lower(p_order->>'email'), p_order->>'stripe_customer_id',
      (p_order->>'report_id')::uuid, p_order->>'check_id', p_order->>'plan', p_order->>'context')
    on conflict (id) do nothing;
  end if;
end $$;
revoke all on function public.reserve_scan(text, uuid), public.finish_scan(uuid, boolean),
  public.apply_billing_event(text, bigint, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_scan(text, uuid), public.finish_scan(uuid, boolean),
  public.apply_billing_event(text, bigint, jsonb, jsonb) to service_role;

create function public.save_v2_report(p_report jsonb, p_private boolean, p_customer_id text default null)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_private then
    if p_customer_id is null then raise exception 'Private report requires owner'; end if;
    insert into public.private_reports (id, repo_url, results, created_at, stripe_customer_id)
    values ((p_report->>'id')::uuid, p_report->>'repo_url', p_report->'results',
      (p_report->>'created_at')::timestamptz, p_customer_id);
  else
    insert into public.reports (id, repo_url, results, created_at)
    values ((p_report->>'id')::uuid, p_report->>'repo_url', p_report->'results',
      (p_report->>'created_at')::timestamptz);
  end if;
  if p_customer_id is not null then
    insert into public.report_history (report_id, stripe_customer_id, repo_url, is_private, created_at)
    values ((p_report->>'id')::uuid, p_customer_id, p_report->>'repo_url', p_private,
      (p_report->>'created_at')::timestamptz);
  end if;
end $$;
revoke all on function public.save_v2_report(jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.save_v2_report(jsonb, boolean, text) to service_role;
