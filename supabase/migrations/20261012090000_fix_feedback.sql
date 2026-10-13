-- Did DeployDoctor solve it? One answer per visitor per report or diagnosis; a later answer replaces the earlier one.
-- target is a report id or the id the diagnose page gives a diagnosis. voter_hash is the same salted IP digest the
-- daily allowance uses, so no IP address is stored.
create table if not exists public.fix_feedback (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('report', 'diagnosis')),
  target uuid not null,
  solved boolean not null,
  voter_hash text not null check (char_length(voter_hash) between 16 and 128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, target, voter_hash)
);
alter table public.fix_feedback enable row level security;
-- Only the server writes and reads it, with the service role.
revoke all on table public.fix_feedback from public, anon, authenticated;
grant select, insert, update on table public.fix_feedback to service_role;

-- Distinct visitors who said DeployDoctor solved their problem, for the homepage counter. Only the count leaves the database.
create or replace function public.fixes_confirmed()
returns bigint language sql stable security invoker set search_path = '' as $$
  select count(distinct voter_hash) from public.fix_feedback where solved;
$$;
revoke all on function public.fixes_confirmed() from public, anon, authenticated;
grant execute on function public.fixes_confirmed() to service_role;
