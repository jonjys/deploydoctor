-- Server-mediated submissions; no visitor can read private feedback or approve a review.
create table public.community_reviews (
  id uuid primary key default gen_random_uuid(),
  voter_hash text not null check (length(voter_hash) = 64),
  kind text not null check (kind in ('review', 'idea')),
  name text not null check (length(btrim(name)) between 1 and 60),
  body text not null check (length(btrim(body)) between 10 and 1500),
  rating smallint,
  consent boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  created_at timestamptz not null default now(),
  unique (voter_hash, kind),
  check ((kind = 'review' and rating between 1 and 5 and rating is not null and consent)
    or (kind = 'idea' and rating is null and not consent)),
  check (status <> 'published' or (kind = 'review' and consent))
);
alter table public.community_reviews enable row level security;
revoke all on public.community_reviews from public, anon, authenticated;
grant select, insert, update, delete on public.community_reviews to service_role;
create index community_reviews_published on public.community_reviews (created_at desc) where status = 'published';

create function public.community_review_summary() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'count', (select count(*) from public.community_reviews where status = 'published' and consent and kind = 'review'),
    'average', (select round(avg(rating), 1) from public.community_reviews where status = 'published' and consent and kind = 'review'),
    'reviews', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc, r.id) from
      (select id, name, body, rating, created_at from public.community_reviews
       where status = 'published' and consent and kind = 'review' order by created_at desc, id limit 6) r), '[]'::jsonb)
  );
$$;
revoke all on function public.community_review_summary() from public, anon, authenticated;
grant execute on function public.community_review_summary() to service_role;
