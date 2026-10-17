-- Watch this repo: DeployDoctor rescans a public repository once a day and emails the subscriber when something new breaks.
-- A watch starts unconfirmed and the daily job only reads confirmed rows, so nobody gets an alert without clicking the link.
-- token_hash is the SHA-256 of the random confirmation token; the token itself only travels in the email.
-- For an unconfirmed watch, created_at is when the latest confirmation link was sent; the link works for 7 days.
create table if not exists public.repo_watches (
  id uuid primary key default gen_random_uuid(),
  email text not null check (char_length(email) between 3 and 254 and email = lower(email)),
  repo_url text not null check (char_length(repo_url) between 1 and 300),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  confirmed_at timestamptz,
  last_report_id uuid,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);
-- One live watch per address and repository.
create unique index if not exists repo_watches_live_idx
  on public.repo_watches (email, lower(repo_url)) where unsubscribed_at is null;
-- The daily job takes the confirmed watches that have waited longest.
create index if not exists repo_watches_due_idx
  on public.repo_watches (last_checked_at asc nulls first) where confirmed_at is not null and unsubscribed_at is null;

-- Watch requests per visitor per UTC day, keyed by the same salted IP digest the scan allowance uses.
create table if not exists public.watch_request_limits (
  ip_hash text not null,
  day date not null,
  requests integer not null default 0 check (requests between 0 and 3),
  primary key (ip_hash, day)
);

alter table public.repo_watches enable row level security;
alter table public.watch_request_limits enable row level security;
-- Only the server reads and writes them, with the service role.
revoke all on table public.repo_watches, public.watch_request_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.repo_watches, public.watch_request_limits to service_role;

-- Counts the request against the visitor's 3 a day, then stores an unconfirmed watch (at most 5 live ones per address).
-- status: created or pending (send the confirmation email), confirmed (already watching, send nothing),
-- ip_limit or email_limit. Asking again for a pending watch replaces its token, so only the newest link works.
create or replace function public.request_repo_watch(p_ip_hash text, p_email text, p_repo_url text,
  p_token_hash text, p_report_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_day date := (now() at time zone 'UTC')::date; v_count integer; v_watch public.repo_watches; v_id uuid;
begin
  insert into public.watch_request_limits (ip_hash, day, requests) values (p_ip_hash, v_day, 1)
  on conflict (ip_hash, day) do update set requests = public.watch_request_limits.requests + 1
    where public.watch_request_limits.requests < 3
  returning requests into v_count;
  if v_count is null then return jsonb_build_object('status', 'ip_limit'); end if;

  select * into v_watch from public.repo_watches
  where email = lower(p_email) and lower(repo_url) = lower(p_repo_url) and unsubscribed_at is null
  for update;
  if found then
    if v_watch.confirmed_at is not null then return jsonb_build_object('status', 'confirmed'); end if;
    update public.repo_watches set token_hash = p_token_hash, created_at = now(),
      last_report_id = coalesce(p_report_id, last_report_id)
    where id = v_watch.id;
    return jsonb_build_object('status', 'pending', 'id', v_watch.id);
  end if;

  if (select count(*) from public.repo_watches where email = lower(p_email) and unsubscribed_at is null) >= 5 then
    return jsonb_build_object('status', 'email_limit');
  end if;
  insert into public.repo_watches (email, repo_url, token_hash, last_report_id)
  values (lower(p_email), p_repo_url, p_token_hash, p_report_id)
  on conflict do nothing
  returning id into v_id;
  -- A request that raced another one for the same watch sends nothing; the other one sends the link.
  if v_id is null then return jsonb_build_object('status', 'confirmed'); end if;
  return jsonb_build_object('status', 'created', 'id', v_id);
end $$;

-- Hands the daily job up to p_limit confirmed watches, longest waiting first, and marks them checked in the same
-- statement. Two overlapping runs never get the same row, and a watch is not checked twice within 20 hours.
create or replace function public.claim_repo_watches(p_limit integer)
returns setof public.repo_watches language sql security invoker set search_path = '' as $$
  update public.repo_watches set last_checked_at = now()
  where id in (
    select id from public.repo_watches
    where confirmed_at is not null and unsubscribed_at is null
      and (last_checked_at is null or last_checked_at < now() - interval '20 hours')
    order by last_checked_at asc nulls first
    limit least(greatest(p_limit, 0), 40)
    for update skip locked
  )
  returning *;
$$;

revoke all on function public.request_repo_watch(text, text, text, text, uuid), public.claim_repo_watches(integer)
  from public, anon, authenticated;
grant execute on function public.request_repo_watch(text, text, text, text, uuid), public.claim_repo_watches(integer)
  to service_role;
