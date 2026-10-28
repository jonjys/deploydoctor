-- Server-only, single-app configuration. User GitHub credentials are not stored in the database.
create table public.github_app_settings (
  id text primary key check (id = 'primary'),
  ciphertext text not null check (length(ciphertext) between 40 and 3500),
  created_at timestamptz not null default now()
);
alter table public.github_app_settings enable row level security;
revoke all on public.github_app_settings from public, anon, authenticated;
grant select, insert on public.github_app_settings to service_role;
