begin;

alter table public.kh2_delays
  add column cancelled_at timestamptz,
  drop constraint kh2_delays_student_id_date_on_key;

create unique index kh2_active_delays_student_date
  on public.kh2_delays(student_id,date_on) where cancelled_at is null;
create index kh2_delays_student_history
  on public.kh2_delays(student_id,date_on desc);

create table public.kh2_delay_changes (
  id uuid primary key default gen_random_uuid(),
  original_id uuid not null,
  replacement_id uuid,
  action text not null check (action in ('correct','cancel')),
  before_entry jsonb not null,
  after_entry jsonb,
  reason text not null check (char_length(reason) between 3 and 400),
  changed_by uuid references public.kh2_people(id) on delete set null,
  changed_by_name text not null,
  changed_at timestamptz not null default now(),
  check ((action='correct') = (replacement_id is not null and after_entry is not null)),
  unique (original_id)
);
create unique index kh2_delay_changes_replacement_idx
  on public.kh2_delay_changes(replacement_id) where replacement_id is not null;

alter table public.kh2_delay_changes enable row level security;
revoke all on public.kh2_delay_changes from public, anon, authenticated;

-- Old standalone gate accounts, if present, can be disabled without removing their audit history.
alter table public.kh2_people add column gate_revoked_at timestamptz,
  add constraint kh2_gate_revocation_requires_legacy_gate check (gate_revoked_at is null or role='gate');

create function public.kh2_update_delay(
  p_delay uuid, p_action text, p_reason text, p_student uuid default null, p_date date default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_admin public.kh2_people;
  v_old public.kh2_delays;
  v_new public.kh2_delays;
  v_before jsonb;
  v_after jsonb;
  v_reason text := coalesce(btrim(p_reason),'');
begin
  select * into v_admin from public.kh2_people where id=(select auth.uid()) and role='admin';
  if not found then raise exception 'KH2_FORBIDDEN' using errcode='42501'; end if;
  if p_action is null or p_action not in ('correct','cancel') then
    raise exception 'KH2_INVALID_ACTION';
  end if;
  if char_length(v_reason) not between 3 and 400 then
    raise exception 'KH2_INVALID_CHANGE_REASON';
  end if;
  select * into v_old from public.kh2_delays where id=p_delay for update;
  if not found or v_old.cancelled_at is not null then raise exception 'KH2_DELAY_UNAVAILABLE'; end if;

  select jsonb_build_object('student_id',p.id,'full_name',p.full_name,'class_name',p.class_name,'date_on',v_old.date_on)
  into v_before from public.kh2_people p where p.id=v_old.student_id;

  if p_action='correct' then
    if p_date is null or p_date < date '1900-01-01' or p_date > (now() at time zone 'Asia/Tehran')::date then
      raise exception 'KH2_INVALID_DATE';
    end if;
    select jsonb_build_object('student_id',p.id,'full_name',p.full_name,'class_name',p.class_name,'date_on',p_date)
    into v_after from public.kh2_people p where p.id=p_student and p.role='student';
    if not found then raise exception 'KH2_STUDENT_MISSING'; end if;
    if p_student=v_old.student_id and p_date=v_old.date_on then raise exception 'KH2_UNCHANGED_DELAY'; end if;
  end if;

  update public.kh2_delays set cancelled_at=now() where id=p_delay;
  if p_action='correct' then
    insert into public.kh2_delays(student_id,recorder_id,date_on,note)
    values(p_student,v_admin.id,p_date,case when p_student=v_old.student_id then v_old.note else '' end)
    on conflict (student_id,date_on) where cancelled_at is null do nothing
    returning * into v_new;
    if not found then raise exception 'KH2_DUPLICATE_DELAY'; end if;
  end if;

  insert into public.kh2_delay_changes(original_id,replacement_id,action,before_entry,after_entry,reason,changed_by,changed_by_name)
  values(p_delay,v_new.id,p_action,v_before,v_after,v_reason,v_admin.id,v_admin.full_name);
  return jsonb_build_object('ok',true,'replacement_id',v_new.id);
end;
$$;

create function public.kh2_delay_history(p_delay uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.kh2_people where id=(select auth.uid()) and role='admin') then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(h) order by h.changed_at desc,h.id)
    from public.kh2_delay_changes h where h.original_id=p_delay or h.replacement_id=p_delay
  ),'[]'::jsonb);
end;
$$;

create function public.kh2_revoke_gate(p_person uuid,p_assigned_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.kh2_people where id=(select auth.uid()) and role='admin') then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;
  update public.kh2_people
    set gate_assigned_at=null,
        gate_revoked_at=case when role='gate' then now() else null end
  where id=p_person and (
    (role='student' and gate_assigned_at is not null and gate_assigned_at=p_assigned_at)
    or (role='gate' and gate_revoked_at is null and p_assigned_at is null)
  );
  if not found then raise exception 'KH2_GATE_NOT_ASSIGNED'; end if;
  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.kh2_update_delay(uuid,text,text,uuid,date),
  public.kh2_delay_history(uuid), public.kh2_revoke_gate(uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.kh2_update_delay(uuid,text,text,uuid,date),
  public.kh2_delay_history(uuid), public.kh2_revoke_gate(uuid,timestamptz) to authenticated;

create or replace function public.kh2_photo_access(p_name text, p_write boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.kh2_people actor
    join public.kh2_people pupil on pupil.id::text = split_part(p_name,'/',1) and pupil.role = 'student'
    where actor.id = (select auth.uid())
      and p_name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|png|webp)$'
      and case when p_write then actor.role = 'admin'
        else (actor.role = 'admin' or (actor.role = 'gate' and actor.gate_revoked_at is null) or actor.gate_assigned_at is not null or actor.id = pupil.id) and pupil.photo_path = p_name end
  );
$$;

create or replace function public.kh2_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor public.kh2_people;
  v_gate boolean;
begin
  select * into v_actor from public.kh2_people where id = (select auth.uid());
  if not found then raise exception 'KH2_FORBIDDEN' using errcode = '42501'; end if;
  v_gate := (v_actor.role = 'gate' and v_actor.gate_revoked_at is null) or v_actor.gate_assigned_at is not null;
  return jsonb_build_object(
    'me', to_jsonb(v_actor),
    'students', coalesce((select jsonb_agg(
      case when v_gate and p.id <> v_actor.id then to_jsonb(p) - 'username' else to_jsonb(p) end
      order by p.full_name,p.id) from public.kh2_people p
      where p.role = 'student' and (v_actor.role = 'admin' or v_gate or p.id = v_actor.id)), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(to_jsonb(p) order by p.full_name,p.id) from public.kh2_people p
      where v_actor.role = 'admin' and ((p.role = 'gate' and p.gate_revoked_at is null) or p.gate_assigned_at is not null)), '[]'::jsonb),
    'delays', coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object(
      'recorder_name', coalesce(r.full_name, '—'), 'status',case when d.cancelled_at is not null then 'cancelled' else coalesce(a.status,'active') end,
      'has_history',v_actor.role='admin' and exists(select 1 from public.kh2_delay_changes h where h.original_id=d.id or h.replacement_id=d.id))
      order by d.date_on desc,d.created_at desc) from public.kh2_delays d
      left join public.kh2_people r on r.id = d.recorder_id
      left join public.kh2_appeals a on a.delay_id = d.id
      where v_actor.role = 'admin' or v_gate or d.student_id = v_actor.id), '[]'::jsonb),
    'appeals', coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object(
      'student_id',d.student_id,'date_on',d.date_on,'recorder_id',d.recorder_id,'delay_cancelled',d.cancelled_at is not null,
      'delay_status',case when d.cancelled_at is not null then 'cancelled' else a.status end)
      order by a.created_at desc) from public.kh2_appeals a
      join public.kh2_delays d on d.id = a.delay_id
      where v_actor.role = 'admin' or (v_gate and d.recorder_id = v_actor.id and d.student_id <> v_actor.id)
        or (v_actor.role = 'student' and d.student_id = v_actor.id)), '[]'::jsonb)
  );
end;
$$;

create or replace function public.kh2_act(p_action text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor public.kh2_people;
  v_row jsonb;
  v_student uuid;
  v_id uuid;
  v_username text;
  v_date date;
  v_added int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
  v_message text;
  v_index int := 0;
begin
  select * into v_actor from public.kh2_people where id=(select auth.uid());
  if not found then raise exception 'KH2_FORBIDDEN' using errcode='42501'; end if;

  if p_action in ('import_students','import_grades','add_gate','set_photo') and v_actor.role <> 'admin' then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;
  if p_action in ('register_delay','review_appeal')
    and v_actor.role <> 'admin' and (v_actor.role <> 'gate' or v_actor.gate_revoked_at is not null) and v_actor.gate_assigned_at is null then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;

  case p_action
  when 'import_students', 'import_grades' then
    if jsonb_typeof(p_data) is distinct from 'array' or jsonb_array_length(p_data) not between 1 and 300 then
      raise exception 'KH2_INVALID_LIST';
    end if;
    for v_row in select value from jsonb_array_elements(p_data)
    loop
      v_index := v_index + 1;
      begin
        v_username := btrim(v_row->>'username');
        if p_action = 'import_students' then
          if exists(select 1 from public.kh2_people where username=v_username and role='student') then
            v_skipped := v_skipped + 1;
            continue;
          end if;
          perform kh2_private.add_person(v_username,v_username,v_row->>'full_name','student',v_row->>'class_name');
        else
          select id into v_student from public.kh2_people where username=v_username and role='student';
          if not found then raise exception 'KH2_STUDENT_MISSING'; end if;
          insert into public.kh2_grades(student_id,subject,term,score)
          values(v_student,btrim(v_row->>'subject'),btrim(v_row->>'term'),(v_row->>'score')::numeric)
          on conflict(student_id,subject,term) do update set score=excluded.score,updated_at=now();
        end if;
        v_added := v_added + 1;
      exception when others then
        v_message := case
          when sqlstate = '23505' then 'KH2_DUPLICATE_USERNAME'
          when sqlerrm like 'KH2_%' then sqlerrm
          when p_action='import_grades' then 'KH2_INVALID_GRADE'
          else 'KH2_INVALID_STUDENT'
        end;
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('row',v_index,'username',v_username,'error',v_message));
      end;
    end loop;
    return jsonb_build_object('added',v_added,'skipped',v_skipped,'errors',v_errors);
  when 'add_gate' then
    v_username := btrim(p_data->>'username');
    if v_username is null or v_username !~ '^[0-9]{10}$' then
      raise exception 'KH2_INVALID_NATIONAL_ID';
    end if;
    update public.kh2_people set gate_assigned_at=now()
    where username=v_username and role='student' and gate_assigned_at is null
    returning id into v_id;
    if v_id is null then
      if exists(select 1 from public.kh2_people where username=v_username and role='student') then
        raise exception 'KH2_GATE_ALREADY_ASSIGNED';
      end if;
      raise exception 'KH2_STUDENT_MISSING';
    end if;
    return jsonb_build_object('id',v_id);
  when 'set_photo' then
    v_student := (p_data->>'student_id')::uuid;
    if split_part(p_data->>'path','/',1) is distinct from v_student::text or
      not exists(select 1 from storage.objects where bucket_id='kh2-student-photos' and name=p_data->>'path')
    then raise exception 'KH2_INVALID_PHOTO'; end if;
    update public.kh2_people set photo_path=p_data->>'path' where id=v_student and role='student';
    if not found then raise exception 'KH2_STUDENT_MISSING'; end if;
  when 'register_delay' then
    v_student := (p_data->>'student_id')::uuid;
    v_date := (p_data->>'date_on')::date;
    if v_student = v_actor.id then
      raise exception 'KH2_OWN_DELAY' using errcode='42501';
    end if;
    if not exists(select 1 from public.kh2_people where id=v_student and role='student') then
      raise exception 'KH2_STUDENT_MISSING';
    end if;
    if v_date is null or v_date > (now() at time zone 'Asia/Tehran')::date or v_date < date '1900-01-01' then
      raise exception 'KH2_INVALID_DATE';
    end if;
    insert into public.kh2_delays(student_id,recorder_id,date_on,note)
    values(v_student,v_actor.id,v_date,coalesce(btrim(p_data->>'note'),''))
    on conflict (student_id,date_on) where cancelled_at is null do nothing returning id into v_id;
    if v_id is null then raise exception 'KH2_DUPLICATE_DELAY'; end if;
  when 'send_appeal' then
    v_id := (p_data->>'delay_id')::uuid;
    if v_actor.role <> 'student' then raise exception 'KH2_FORBIDDEN' using errcode='42501'; end if;
    perform 1 from public.kh2_delays where id=v_id and student_id=v_actor.id and cancelled_at is null for update;
    if not found then raise exception 'KH2_FORBIDDEN' using errcode='42501'; end if;
    if p_data->>'reason' is null or char_length(btrim(p_data->>'reason')) not between 5 and 800 then
      raise exception 'KH2_INVALID_REASON';
    end if;
    insert into public.kh2_appeals(delay_id,reason) values(v_id,btrim(p_data->>'reason'))
    on conflict(delay_id) do nothing;
    if not found then raise exception 'KH2_DUPLICATE_APPEAL'; end if;
  when 'review_appeal' then
    v_id := (p_data->>'appeal_id')::uuid;
    if p_data->>'status' is null or p_data->>'status' not in ('approved','rejected')
      or p_data->>'response' is null or char_length(btrim(p_data->>'response')) not between 2 and 800 then
      raise exception 'KH2_INVALID_RESPONSE';
    end if;
    perform 1 from public.kh2_appeals a join public.kh2_delays d on d.id=a.delay_id
    where a.id=v_id and d.cancelled_at is null
      and (v_actor.role='admin' or (d.recorder_id=v_actor.id and d.student_id<>v_actor.id))
    for update of d;
    if not found then raise exception 'KH2_APPEAL_UNAVAILABLE'; end if;
    update public.kh2_appeals a set status=p_data->>'status',response=btrim(p_data->>'response'),
      reviewer_id=v_actor.id,reviewed_at=now()
    from public.kh2_delays d where a.id=v_id and a.delay_id=d.id and a.status='pending'
      and (v_actor.role='admin' or (d.recorder_id=v_actor.id and d.student_id<>v_actor.id));
    if not found then raise exception 'KH2_APPEAL_UNAVAILABLE'; end if;
  else raise exception 'KH2_INVALID_ACTION';
  end case;
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.kh2_register_delays(
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
  if not found or (v_actor.role <> 'admin' and (v_actor.role <> 'gate' or v_actor.gate_revoked_at is not null) and v_actor.gate_assigned_at is null) then
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
  on conflict (student_id,date_on) where cancelled_at is null do nothing;
  get diagnostics v_added = row_count;

  return jsonb_build_object(
    'added',v_added,
    'skipped',cardinality(v_students)*cardinality(v_dates)-v_added
  );
end;
$$;

commit;
