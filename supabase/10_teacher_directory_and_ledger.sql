begin;

create extension if not exists supabase_vault with schema vault;

alter table public.kh2_staff_profiles
  add column details jsonb not null default '{}' check (jsonb_typeof(details)='object');

create table kh2_private.staff_managed_passwords (
  staff_id uuid primary key references public.kh2_staff_profiles(staff_id) on delete cascade,
  secret_id uuid not null unique references vault.secrets(id),
  password_version bytea not null
);
alter table kh2_private.staff_managed_passwords enable row level security;
revoke all on kh2_private.staff_managed_passwords from public,anon,authenticated;

create function kh2_private.set_managed_staff_password(p_staff uuid,p_password text,p_initial_only boolean)
returns void language plpgsql set search_path='' as $$
declare
  v_username text;
  v_issued timestamptz;
  v_old_secret uuid;
  v_hash text;
begin
  if not exists(select 1 from public.kh2_people where id=(select auth.uid()) and role='admin') then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;
  if p_password is null or octet_length(p_password) not between 8 and 72 or p_password ~ '[[:cntrl:]]' then
    raise exception 'KH2_INVALID_STAFF_PASSWORD';
  end if;

  select p.username,s.password_issued_at into v_username,v_issued
    from public.kh2_staff_profiles s join public.kh2_people p on p.id=s.staff_id
    where s.staff_id=p_staff and p.role in ('teacher','deputy') for update of s;
  if not found then raise exception 'KH2_STAFF_MISSING'; end if;

  if v_username ~ '^[0-9]{10}$' and translate(p_password,'۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩','01234567890123456789') ~ '^[0-9]{10}$' then
    p_password := translate(p_password,'۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩','01234567890123456789');
  end if;
  select u.encrypted_password into v_hash from auth.users u
    where u.id=p_staff and u.email=v_username||'@kh2.portal.invalid' for update;
  if not found then raise exception 'KH2_STAFF_MISSING'; end if;

  if p_initial_only and v_issued is not null then
    if v_hash=extensions.crypt(p_password,v_hash) then return; end if;
    raise exception 'KH2_PASSWORD_ALREADY_ISSUED';
  end if;

  v_hash := extensions.crypt(p_password,extensions.gen_salt('bf',10));
  update auth.users set encrypted_password=v_hash,updated_at=now() where id=p_staff;
  update public.kh2_staff_profiles set password_issued_at=now() where staff_id=p_staff;

  select secret_id into v_old_secret from kh2_private.staff_managed_passwords where staff_id=p_staff;
  insert into kh2_private.staff_managed_passwords(staff_id,secret_id,password_version)
  values(p_staff,vault.create_secret(p_password),extensions.digest(v_hash,'sha256'))
  on conflict(staff_id) do update
    set secret_id=excluded.secret_id,password_version=excluded.password_version;
  if v_old_secret is not null then delete from vault.secrets where id=v_old_secret; end if;
end;
$$;

create or replace function public.kh2_issue_staff_password(p_staff uuid,p_password text)
returns void language sql security definer set search_path='' as $$
  select kh2_private.set_managed_staff_password(p_staff,p_password,true);
$$;

create function public.kh2_set_staff_password(p_staff uuid,p_password text)
returns void language sql security definer set search_path='' as $$
  select kh2_private.set_managed_staff_password(p_staff,p_password,false);
$$;

create function public.kh2_staff_password(p_staff uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.kh2_people where id=(select auth.uid()) and role='admin') then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;
  return jsonb_build_object('password',(
    select v.decrypted_secret
    from kh2_private.staff_managed_passwords m
    join public.kh2_people p on p.id=m.staff_id
    join auth.users u on u.id=p.id and u.email=p.username||'@kh2.portal.invalid'
    join vault.decrypted_secrets v on v.id=m.secret_id
    where m.staff_id=p_staff and p.role in ('teacher','deputy')
      and m.password_version=extensions.digest(u.encrypted_password,'sha256')
  ));
end;
$$;

create function public.kh2_import_staff_details(p_rows jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare
  v_count integer;
begin
  if not exists(select 1 from public.kh2_people where id=(select auth.uid()) and role='admin') then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'object' or octet_length(p_rows::text)>524288 then
    raise exception 'KH2_INVALID_LIST';
  end if;
  if exists(
    select 1 from jsonb_each(p_rows) r
    left join public.kh2_people p on p.username=r.key
    left join public.kh2_staff_profiles s on s.staff_id=p.id
    where s.staff_id is null
  ) then raise exception 'KH2_STAFF_IMPORT_UNKNOWN'; end if;
  if exists(select 1 from jsonb_each(p_rows) where jsonb_typeof(value)<>'object') then
    raise exception 'KH2_INVALID_LIST';
  end if;
  if exists(
    select 1 from jsonb_each(p_rows) r cross join lateral jsonb_each(r.value) cell
    where jsonb_typeof(cell.value)<>'string' or char_length(cell.key) not between 1 and 80
      or char_length(cell.value #>> '{}')>500
      or cell.key ~* 'رمز|گذرواژه|password|passwd|secret'
  ) then raise exception 'KH2_INVALID_LIST'; end if;

  update public.kh2_staff_profiles s set details=s.details||r.value
  from public.kh2_people p join jsonb_each(p_rows) r on p.username=r.key
  where p.id=s.staff_id;
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

alter table public.kh2_teacher_assignments add column archived_at timestamptz;

create or replace function public.kh2_staff_directory()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor public.kh2_people;
  v_admin boolean;
begin
  select * into v_actor from public.kh2_people where id=(select auth.uid());
  if not found or v_actor.role not in ('admin','teacher','deputy') then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;
  v_admin:=v_actor.role='admin';
  return jsonb_build_object(
    'staff',coalesce((
      select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'role',p.role,
        'username',p.username,'national_id',s.national_id,'personnel_code',s.personnel_code,
        'deputy',s.deputy,'evaluator',s.evaluator,'details',s.details,
        'password_pending',p.role in ('teacher','deputy') and s.password_issued_at is null) order by p.full_name,p.id)
      from public.kh2_staff_profiles s join public.kh2_people p on p.id=s.staff_id
      where v_admin or p.id=v_actor.id
    ),'[]'::jsonb),
    'assignments',coalesce((
      select jsonb_agg(to_jsonb(a) order by a.archived_at nulls first,a.class_name,a.subject,a.id)
      from public.kh2_teacher_assignments a where v_admin or a.staff_id=v_actor.id
    ),'[]'::jsonb),
    'classes',case when v_admin then coalesce((
      select jsonb_agg(c.class_name order by c.class_name)
      from (select distinct class_name from public.kh2_people where role='student') c
    ),'[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create or replace function public.kh2_set_teacher_assignment(p_staff uuid,p_class text,p_subject text,p_remove uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_class text := btrim(p_class);
  v_subject text := btrim(p_subject);
begin
  if not exists(select 1 from public.kh2_people where id=(select auth.uid()) and role='admin') then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;
  if p_remove is not null then
    update public.kh2_teacher_assignments set archived_at=now()
      where id=p_remove and staff_id=p_staff and archived_at is null;
    return;
  end if;
  if not exists(select 1 from public.kh2_staff_profiles where staff_id=p_staff) then
    raise exception 'KH2_STAFF_MISSING';
  end if;
  if v_class is null or not exists(select 1 from public.kh2_people where class_name=v_class and role='student') then
    raise exception 'KH2_INVALID_CLASS';
  end if;
  if v_subject is null or char_length(v_subject) not between 1 and 100 then
    raise exception 'KH2_INVALID_SUBJECT';
  end if;
  insert into public.kh2_teacher_assignments(staff_id,class_name,subject)
  values(p_staff,v_class,v_subject) on conflict (staff_id,class_name,subject)
  do update set archived_at=null;
end;
$$;

create table kh2_private.ledger_sessions (
  assignment_id uuid not null references public.kh2_teacher_assignments(id) on delete cascade,
  date_on date not null,
  topic text not null check (char_length(topic)<=500),
  revision integer not null check (revision>0),
  primary key(assignment_id,date_on)
);

create table kh2_private.ledger_entries (
  assignment_id uuid not null,
  date_on date not null,
  student_id uuid not null references public.kh2_people(id) on delete cascade,
  attendance text check (attendance in ('present','absent','late','excused')),
  score numeric(4,2) check (score between 0 and 20),
  note text not null check (char_length(note)<=300),
  primary key(assignment_id,date_on,student_id),
  foreign key(assignment_id,date_on) references kh2_private.ledger_sessions(assignment_id,date_on) on delete cascade
);

alter table kh2_private.ledger_sessions enable row level security;
alter table kh2_private.ledger_entries enable row level security;
revoke all on kh2_private.ledger_sessions,kh2_private.ledger_entries from public,anon,authenticated;

create function kh2_private.ledger_roster(p_class text,p_date date,p_assignment uuid)
returns table(id uuid,full_name text)
language sql stable set search_path='' as $$
  select p.id,p.full_name
  from public.kh2_people p
  where p.role='student' and (
    coalesce(
      (select m.previous_class from public.kh2_class_moves m where m.student_id=p.id and m.effective_on>p_date order by m.effective_on limit 1),
      p.class_name
    )=p_class
    or exists(select 1 from kh2_private.ledger_entries e
      where e.assignment_id=p_assignment and e.date_on=p_date and e.student_id=p.id)
  );
$$;

create function public.kh2_teaching_ledger(p_assignment uuid,p_date date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_assignment public.kh2_teacher_assignments;
  v_session kh2_private.ledger_sessions;
begin
  select * into v_assignment from public.kh2_teacher_assignments
    where id=p_assignment and staff_id=(select auth.uid());
  if not found then raise exception 'KH2_FORBIDDEN' using errcode='42501'; end if;
  if p_date is null or p_date<date '1900-01-01' or p_date>(now() at time zone 'Asia/Tehran')::date then
    raise exception 'KH2_INVALID_DATE';
  end if;
  select * into v_session from kh2_private.ledger_sessions where assignment_id=p_assignment and date_on=p_date;
  return jsonb_build_object('topic',coalesce(v_session.topic,''),'revision',coalesce(v_session.revision,0),
    'archived',v_assignment.archived_at is not null,'rows',coalesce((
      select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,
          'attendance',e.attendance,'score',e.score,'note',coalesce(e.note,'')) order by p.full_name,p.id)
      from kh2_private.ledger_roster(v_assignment.class_name,p_date,p_assignment) p
      left join kh2_private.ledger_entries e
      on e.assignment_id=p_assignment and e.date_on=p_date and e.student_id=p.id
      where v_assignment.archived_at is null or e.student_id is not null
    ),'[]'::jsonb));
end;
$$;

create function public.kh2_save_teaching_ledger(p_assignment uuid,p_date date,p_revision integer,p_topic text,p_rows jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare
  v_assignment public.kh2_teacher_assignments;
  v_revision integer;
begin
  select * into v_assignment from public.kh2_teacher_assignments
    where id=p_assignment and staff_id=(select auth.uid()) for share;
  if not found then raise exception 'KH2_FORBIDDEN' using errcode='42501'; end if;
  if v_assignment.archived_at is not null then raise exception 'KH2_ARCHIVED_ASSIGNMENT'; end if;
  if p_date is null or p_date<date '1900-01-01' or p_date>(now() at time zone 'Asia/Tehran')::date then
    raise exception 'KH2_INVALID_DATE';
  end if;
  if p_topic is null or char_length(p_topic)>500 or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'KH2_INVALID_LEDGER';
  end if;
  if jsonb_array_length(p_rows)>500 or octet_length(p_rows::text)>524288 then
    raise exception 'KH2_INVALID_LEDGER';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_assignment::text||':'||p_date::text,0));
  select revision into v_revision from kh2_private.ledger_sessions where assignment_id=p_assignment and date_on=p_date;
  v_revision:=coalesce(v_revision,0);
  if p_revision is distinct from v_revision then raise exception 'KH2_LEDGER_CHANGED'; end if;

  if exists(
    select 1
    from jsonb_to_recordset(p_rows) r(id uuid,attendance text,score numeric,note text)
    left join kh2_private.ledger_roster(v_assignment.class_name,p_date,p_assignment) p on p.id=r.id
    where p.id is null or r.attendance not in ('present','absent','late','excused') or
      (r.score is not null and (r.score not between 0 and 20 or r.score<>round(r.score,2))) or char_length(r.note)>300
  ) or exists(
    select 1 from jsonb_to_recordset(p_rows) r(id uuid) group by r.id having count(*)>1
  ) then raise exception 'KH2_INVALID_LEDGER'; end if;

  v_revision:=v_revision+1;
  insert into kh2_private.ledger_sessions(assignment_id,date_on,topic,revision) values(p_assignment,p_date,btrim(p_topic),v_revision)
  on conflict(assignment_id,date_on) do update set topic=excluded.topic,revision=excluded.revision;
  delete from kh2_private.ledger_entries where assignment_id=p_assignment and date_on=p_date;
  insert into kh2_private.ledger_entries(assignment_id,date_on,student_id,attendance,score,note)
    select p_assignment,p_date,r.id,r.attendance,r.score,coalesce(btrim(r.note),'')
    from jsonb_to_recordset(p_rows) r(id uuid,attendance text,score numeric,note text)
    where r.attendance is not null or r.score is not null or coalesce(btrim(r.note),'')<>'';
  return v_revision;
end;
$$;

revoke all on function kh2_private.set_managed_staff_password(uuid,text,boolean),
  kh2_private.ledger_roster(text,date,uuid) from public,anon,authenticated;
revoke all on function public.kh2_set_staff_password(uuid,text),public.kh2_staff_password(uuid),
  public.kh2_import_staff_details(jsonb),public.kh2_teaching_ledger(uuid,date),
  public.kh2_save_teaching_ledger(uuid,date,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.kh2_set_staff_password(uuid,text),public.kh2_staff_password(uuid),
  public.kh2_import_staff_details(jsonb),public.kh2_teaching_ledger(uuid,date),
  public.kh2_save_teaching_ledger(uuid,date,integer,text,jsonb) to authenticated;

commit;
