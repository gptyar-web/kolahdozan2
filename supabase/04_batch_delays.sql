begin;

create function public.kh2_register_delays(
  p_student_ids uuid[],
  p_dates date[],
  p_note text default ''
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor public.kh2_people;
  v_students uuid[];
  v_dates date[];
  v_note text := coalesce(btrim(p_note),'');
  v_added int;
begin
  select * into v_actor from public.kh2_people where id = (select auth.uid());
  if not found or (v_actor.role not in ('admin','gate') and v_actor.gate_assigned_at is null) then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;

  if coalesce(cardinality(p_student_ids),0) = 0 or coalesce(cardinality(p_dates),0) = 0 then
    raise exception 'KH2_INVALID_DELAY_BATCH';
  end if;
  if exists (
    select 1 from unnest(p_dates) as d(day)
    where day is null or day < date '1900-01-01' or day > (now() at time zone 'Asia/Tehran')::date
  ) then
    raise exception 'KH2_INVALID_DATE';
  end if;
  if char_length(v_note) > 400 then
    raise exception 'KH2_INVALID_DELAY_NOTE';
  end if;
  if v_actor.id = any(p_student_ids) then
    raise exception 'KH2_OWN_DELAY' using errcode='42501';
  end if;
  if exists (
    select 1 from unnest(p_student_ids) as s(id)
    where not exists (select 1 from public.kh2_people p where p.id=s.id and p.role='student')
  ) then
    raise exception 'KH2_STUDENT_MISSING';
  end if;

  v_students := array(select distinct id from unnest(p_student_ids) as s(id));
  v_dates := array(select distinct day from unnest(p_dates) as d(day));
  if cardinality(v_students) > 1 and cardinality(v_dates) > 1 then
    raise exception 'KH2_INVALID_DELAY_BATCH';
  end if;

  insert into public.kh2_delays(student_id,recorder_id,date_on,note)
  select s.id,v_actor.id,d.day,v_note
  from unnest(v_students) as s(id)
  cross join unnest(v_dates) as d(day)
  order by s.id,d.day
  on conflict (student_id,date_on) do nothing;
  get diagnostics v_added = row_count;

  return jsonb_build_object(
    'added',v_added,
    'skipped',cardinality(v_students)*cardinality(v_dates)-v_added
  );
end;
$$;

revoke all on function public.kh2_register_delays(uuid[],date[],text) from public, anon, authenticated;
grant execute on function public.kh2_register_delays(uuid[],date[],text) to authenticated;

commit;
