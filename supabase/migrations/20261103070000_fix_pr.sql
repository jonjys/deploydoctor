-- Launch promo counter and fix orders. Browser roles cannot read or write them.
-- The Rescue Wall is rendered by the server, which already uses the service role.

create table public.fix_promo (
  id text primary key check (id = 'launch'),
  claimed integer not null default 0,
  cap integer not null default 50,
  constraint fix_promo_cap check (cap = 50),
  constraint fix_promo_claimed check (claimed >= 0 and claimed <= cap)
);

insert into public.fix_promo (id, claimed, cap) values ('launch', 0, 50);

create table public.fix_promo_claims (
  quote_hash text primary key check (quote_hash ~ '^[a-f0-9]{64}$'),
  claimed_at timestamptz not null default now()
);

create table public.fix_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  repo_url text not null check (repo_url ~ '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  commit_sha text not null check (commit_sha ~ '^[a-f0-9]{40}$'),
  status text not null check (status in ('paid', 'opened', 'passed', 'failed', 'refunded')),
  promo boolean not null default false,
  amount_minor integer not null check (amount_minor in (0, 500)),
  stripe_session_id text unique,
  payment_intent_id text,
  pr_url text,
  head_sha text,
  error_summary text,
  live_url text,
  consent boolean not null default false,
  refund_id text
);

alter table public.fix_promo enable row level security;
alter table public.fix_promo_claims enable row level security;
alter table public.fix_orders enable row level security;
revoke all on public.fix_promo, public.fix_promo_claims, public.fix_orders from public, anon, authenticated;
grant select, update on public.fix_promo to service_role;
grant select, insert on public.fix_promo_claims to service_role;
grant select, insert, update on public.fix_orders to service_role;

create function public.claim_fix_promo(p_quote_hash text)
returns table (granted boolean, claimed integer, cap integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed integer;
  v_cap integer;
begin
  if p_quote_hash is null or p_quote_hash !~ '^[a-f0-9]{64}$' then
    return query select false, 0, 50;
    return;
  end if;
  if exists (select 1 from public.fix_promo_claims where quote_hash = p_quote_hash) then
    select fix_promo.claimed, fix_promo.cap into v_claimed, v_cap from public.fix_promo where id = 'launch';
    return query select true, coalesce(v_claimed, 0), coalesce(v_cap, 50);
    return;
  end if;
  update public.fix_promo
     set claimed = fix_promo.claimed + 1
   where id = 'launch' and fix_promo.claimed < fix_promo.cap
   returning fix_promo.claimed, fix_promo.cap into v_claimed, v_cap;
  if not found then
    select fix_promo.claimed, fix_promo.cap into v_claimed, v_cap from public.fix_promo where id = 'launch';
    return query select false, coalesce(v_claimed, 50), coalesce(v_cap, 50);
    return;
  end if;
  insert into public.fix_promo_claims (quote_hash) values (p_quote_hash);
  return query select true, v_claimed, v_cap;
end;
$$;

create function public.fix_promo_remaining()
returns table (remaining integer, claimed integer, cap integer)
language sql
stable
security definer
set search_path = public
as $$
  select cap - claimed, claimed, cap from public.fix_promo where id = 'launch';
$$;

revoke all on function public.claim_fix_promo(text) from public, anon, authenticated;
revoke all on function public.fix_promo_remaining() from public, anon, authenticated;
grant execute on function public.claim_fix_promo(text) to service_role;
grant execute on function public.fix_promo_remaining() to service_role;
