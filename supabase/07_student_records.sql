create table public.kh2_student_records (
  student_id uuid primary key references public.kh2_people(id) on delete cascade,
  details jsonb not null check (jsonb_typeof(details) = 'object')
);

alter table public.kh2_student_records enable row level security;
revoke all on table public.kh2_student_records from public, anon, authenticated;

create function public.kh2_student_record(p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor public.kh2_people;
  v_student public.kh2_people;
  v_details jsonb;
begin
  select * into v_actor from public.kh2_people where id=(select auth.uid());
  if not found or not (v_actor.role='admin' or v_actor.gate_assigned_at is not null
    or (v_actor.role='gate' and v_actor.gate_revoked_at is null)) then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;

  select * into v_student from public.kh2_people where id=p_student and role='student';
  if not found then raise exception 'KH2_STUDENT_MISSING'; end if;
  select details into v_details from public.kh2_student_records where student_id=p_student;

  if v_actor.role='admin' then
    return jsonb_build_object('class_name',v_student.class_name,'national_id',v_student.username,
      'details',coalesce(v_details,'{}'::jsonb));
  end if;

  return jsonb_build_object('class_name',v_student.class_name,'details',jsonb_strip_nulls(jsonb_build_object(
    'grade',v_details->'grade','track',v_details->'track','enrollment',v_details->'enrollment'
  )));
end;
$$;

create function public.kh2_set_birth_date(p_student uuid,p_birth_date text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.kh2_people where id=(select auth.uid()) and role='admin') then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;
  if not exists(select 1 from public.kh2_people where id=p_student and role='student') then
    raise exception 'KH2_STUDENT_MISSING';
  end if;
  if p_birth_date is null or p_birth_date !~ '^(13|14)[0-9]{2}/(0[1-9]|1[0-2])/(0[1-9]|[12][0-9]|3[01])$'
    or (substring(p_birth_date,6,2) > '06' and right(p_birth_date,2) = '31') then
    raise exception 'KH2_INVALID_BIRTH_DATE';
  end if;

  insert into public.kh2_student_records as records(student_id,details)
  values(p_student,jsonb_build_object('birth_date',p_birth_date))
  on conflict (student_id) do update set details=records.details||excluded.details;
end;
$$;

revoke all on function public.kh2_student_record(uuid),public.kh2_set_birth_date(uuid,text) from public, anon, authenticated;
grant execute on function public.kh2_student_record(uuid),public.kh2_set_birth_date(uuid,text) to authenticated;
