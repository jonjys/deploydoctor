create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  repo_url text not null check (char_length(repo_url) between 1 and 300),
  results jsonb not null check (jsonb_typeof(results) = 'object'),
  created_at timestamptz not null default now()
);

create index if not exists reports_created_at_idx
  on public.reports (created_at desc);

alter table public.reports enable row level security;

-- Reports are only read and written by the server-side service role.
-- Shareability comes from the unguessable /r/:uuid URL, not a public Data API policy.
revoke all on table public.reports from anon, authenticated;
grant select, insert on table public.reports to service_role;
