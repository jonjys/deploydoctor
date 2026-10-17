-- The free daily allowance becomes a parameter, so the app sets it per kind (src/lib/limits.ts): one website scan and
-- one AI diagnosis per visitor, three GitHub Action scans per repository. This only adds a function: reserve_scan keeps
-- its fixed allowance of 3 for any caller still using it, and finish_scan is unchanged. scan_limits already caps a day
-- at 3 scans, which covers every allowance the app uses, so p_limit is held to 1 through 3.
create function public.reserve_scan_limited(p_ip_hash text, p_id uuid, p_limit integer)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_day date := (now() at time zone 'UTC')::date; v_count integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 3 then
    raise exception 'p_limit must be between 1 and 3' using errcode = '22023';
  end if;
  insert into public.scan_limits (ip_hash, day, scans) values (p_ip_hash, v_day, 1)
  on conflict (ip_hash, day) do update set scans = public.scan_limits.scans + 1
    where public.scan_limits.scans < p_limit
  returning scans into v_count;
  if v_count is not null then
    insert into public.scan_reservations values (p_id, p_ip_hash, v_day);
  end if;
  return jsonb_build_object('allowed', v_count is not null, 'remaining', p_limit - coalesce(v_count, p_limit),
    'resetsAt', (v_day + 1)::timestamp at time zone 'UTC');
end $$;
revoke all on function public.reserve_scan_limited(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.reserve_scan_limited(text, uuid, integer) to service_role;

notify pgrst, 'reload schema';
