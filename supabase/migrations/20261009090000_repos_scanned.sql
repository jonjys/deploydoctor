-- Number of distinct repositories DeployDoctor has scanned, public and private, for the homepage counter.
-- Only the count leaves the database; private repository names are never returned.
create or replace function public.repos_scanned()
returns bigint language sql stable security invoker set search_path = '' as $$
  select count(distinct lower(repo_url)) from (
    select repo_url from public.reports
    union all
    select repo_url from public.private_reports
  ) scanned;
$$;
revoke all on function public.repos_scanned() from public, anon, authenticated;
grant execute on function public.repos_scanned() to service_role;
