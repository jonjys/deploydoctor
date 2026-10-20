-- Only aggregates and anonymous activity leave the database. Private reports are never read.
create function public.public_scan_insights() returns jsonb
language sql stable security invoker set search_path = '' as $$
with source as materialized (
  select id, lower(repo_url) as repo, results, created_at
  from public.reports
  where created_at >= now() - interval '30 days'
    and results #>> '{scan,partial}' = 'false'
    and jsonb_typeof(results -> 'checks') = 'array'
    and id not in ('4e515536-d2b3-474f-884e-b4498baa878f'::uuid, '000fd3a4-4fa8-4e01-93d7-9dc2b29d6c67'::uuid, 'c90b4327-500c-4a40-8019-a77df7773ef5'::uuid)
  order by created_at desc, id limit 5000
), latest as (
  select distinct on (repo) repo, results from source order by repo, created_at desc, id desc
), checks as (
  select repo, c->>'id' as id, bool_or(c->>'status' = 'red') as red,
    bool_or(c->>'status' = 'yellow') as yellow
  from latest cross join lateral jsonb_array_elements(results -> 'checks') c
  where c->>'id' in ('next-entry','imports','server-libs','env','supabase','prisma','build-config','secrets','dependencies')
    and not coalesce((results #> '{scope,ignored}') ? (c->>'category'), false)
  group by repo, c->>'id'
), ranked as (
  select id, count(*) filter (where red) as red,
    count(*) filter (where yellow and not red) as yellow, count(*) as checked
  from checks group by id
), days as (
  select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*) as count
  from source group by 1
), activity as (
  select date_trunc('hour', created_at) as at from source where created_at >= now() - interval '24 hours'
  order by created_at desc limit 8
)
select jsonb_build_object(
  'generatedAt', now(), 'windowDays', 30, 'scanLimit', 5000,
  'scans', (select count(*) from source), 'repositories', (select count(*) from latest),
  'categories', coalesce((select jsonb_agg(to_jsonb(r) order by red + yellow desc, red desc, id) from ranked r), '[]'::jsonb),
  'days', coalesce((select jsonb_agg(to_jsonb(d) order by day) from days d), '[]'::jsonb),
  'activity', coalesce((select jsonb_agg(to_jsonb(a) order by at desc) from activity a), '[]'::jsonb)
);
$$;
revoke all on function public.public_scan_insights() from public, anon, authenticated;
grant execute on function public.public_scan_insights() to service_role;
