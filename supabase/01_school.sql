begin;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists kh2_private;
revoke all on schema kh2_private from public, anon, authenticated;

create table public.kh2_people (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique,
  full_name text not null check (char_length(full_name) between 2 and 120),
  class_name text not null default '',
  role text not null check (role in ('admin','gate','student')),
  photo_path text,
  created_at timestamptz not null default now(),
  check (role <> 'student' or (username ~ '^[0-9]{10}$' and class_name <> ''))
);

create table public.kh2_delays (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.kh2_people(id) on delete cascade,
  recorder_id uuid references public.kh2_people(id) on delete set null,
  date_on date not null check (date_on >= date '1900-01-01'),
  note text not null default '' check (char_length(note) <= 400),
  created_at timestamptz not null default now(),
  unique (student_id, date_on)
);

create table public.kh2_appeals (
  id uuid primary key default gen_random_uuid(),
  delay_id uuid not null unique references public.kh2_delays(id) on delete cascade,
  reason text not null check (char_length(reason) between 5 and 800),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  response text not null default '' check (char_length(response) <= 800),
  reviewer_id uuid references public.kh2_people(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table public.kh2_grades (
  student_id uuid not null references public.kh2_people(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 100),
  term text not null check (char_length(term) between 1 and 100),
  score numeric(4,2) not null check (score between 0 and 20),
  updated_at timestamptz not null default now(),
  primary key(student_id, subject, term)
);

alter table public.kh2_people enable row level security;
alter table public.kh2_delays enable row level security;
alter table public.kh2_appeals enable row level security;
alter table public.kh2_grades enable row level security;
revoke all on public.kh2_people, public.kh2_delays, public.kh2_appeals, public.kh2_grades from public, anon, authenticated;

create index kh2_delays_date_idx on public.kh2_delays(date_on desc);
create index kh2_delays_recorder_idx on public.kh2_delays(recorder_id);
create index kh2_appeals_reviewer_idx on public.kh2_appeals(reviewer_id);

create function kh2_private.add_person(p_username text, p_password text, p_name text, p_role text, p_class text default '')
returns uuid language plpgsql set search_path = '' as $$
declare
  v_email text;
  v_id uuid := gen_random_uuid();
begin
  p_username := lower(btrim(p_username));
  p_name := btrim(p_name);
  p_class := btrim(p_class);
  if p_username is null or p_username !~ '^[a-z0-9][a-z0-9._-]{2,47}$'
    or p_name is null or char_length(p_name) not between 2 and 120
    or p_password is null or octet_length(p_password) not between 8 and 72
    or p_role not in ('admin','gate','student') then
    raise exception 'KH2_INVALID_ACCOUNT';
  end if;
  if p_role = 'student' and (p_username !~ '^[0-9]{10}$' or p_password <> p_username or coalesce(p_class, '') = '' or char_length(p_class) > 80) then
    raise exception 'KH2_INVALID_STUDENT';
  end if;
  v_email := p_username || '@kh2.portal.invalid';
  insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    confirmation_token,recovery_token,email_change,email_change_token_new,email_change_token_current,
    reauthentication_token,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values ('00000000-0000-0000-0000-000000000000',v_id,'authenticated','authenticated',v_email,
    extensions.crypt(p_password,extensions.gen_salt('bf',10)),now(),'','','','','','',
    '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());
  insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
  values (v_id::text,v_id,jsonb_build_object('sub',v_id::text,'email',v_email,'email_verified',true),'email',now(),now());
  insert into public.kh2_people(id,username,full_name,role,class_name) values(v_id,p_username,p_name,p_role,p_class);
  return v_id;
end;
$$;

create function public.kh2_photo_access(p_name text, p_write boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.kh2_people actor
    join public.kh2_people pupil on pupil.id::text = split_part(p_name,'/',1) and pupil.role = 'student'
    where actor.id = (select auth.uid())
      and p_name ~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.(jpg|png|webp)$'
      and case when p_write then actor.role = 'admin'
        else (actor.role in ('admin','gate') or actor.id = pupil.id) and pupil.photo_path = p_name end
  );
$$;
revoke all on function public.kh2_photo_access(text,boolean) from public, anon, authenticated;
grant execute on function public.kh2_photo_access(text,boolean) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('kh2-student-photos','kh2-student-photos',false,3145728,array['image/jpeg','image/png','image/webp']);

create policy kh2_photos_read on storage.objects for select to authenticated
using (bucket_id='kh2-student-photos' and public.kh2_photo_access(name,false));
create policy kh2_photos_insert on storage.objects for insert to authenticated
with check (bucket_id='kh2-student-photos' and public.kh2_photo_access(name,true));

create function public.kh2_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor public.kh2_people;
begin
  select * into v_actor from public.kh2_people where id = (select auth.uid());
  if not found then raise exception 'KH2_FORBIDDEN' using errcode = '42501'; end if;
  return jsonb_build_object(
    'me', to_jsonb(v_actor),
    'students', coalesce((select jsonb_agg(
      case when v_actor.role = 'gate' then to_jsonb(p) - 'username' else to_jsonb(p) end
      order by p.full_name,p.id) from public.kh2_people p
      where p.role = 'student' and (v_actor.role <> 'student' or p.id = v_actor.id)), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(to_jsonb(p) order by p.full_name) from public.kh2_people p
      where v_actor.role = 'admin' and p.role = 'gate'), '[]'::jsonb),
    'delays', coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object(
      'recorder_name', coalesce(r.full_name, '—'), 'status',coalesce(a.status,'active'))
      order by d.date_on desc,d.created_at desc) from public.kh2_delays d
      left join public.kh2_people r on r.id = d.recorder_id
      left join public.kh2_appeals a on a.delay_id = d.id
      where v_actor.role <> 'student' or d.student_id = v_actor.id), '[]'::jsonb),
    'appeals', coalesce((select jsonb_agg(to_jsonb(a) || jsonb_build_object(
      'student_id',d.student_id,'date_on',d.date_on,'recorder_id',d.recorder_id)
      order by a.created_at desc) from public.kh2_appeals a
      join public.kh2_delays d on d.id = a.delay_id
      where v_actor.role = 'admin' or (v_actor.role = 'gate' and d.recorder_id = v_actor.id)
        or (v_actor.role = 'student' and d.student_id = v_actor.id)), '[]'::jsonb)
  );
end;
$$;

create function public.kh2_grades_for(p_student uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_grades jsonb;
begin
  if not exists (select 1 from public.kh2_people where id=(select auth.uid()) and role='admin') then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(g) order by g.term,g.subject),'[]'::jsonb) into v_grades
  from public.kh2_grades g where g.student_id=p_student;
  return v_grades;
end;
$$;

create function public.kh2_act(p_action text, p_data jsonb)
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
  if p_action in ('register_delay','review_appeal') and v_actor.role not in ('admin','gate') then
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
    v_id := kh2_private.add_person(p_data->>'username',p_data->>'password',p_data->>'full_name','gate');
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
    if not exists(select 1 from public.kh2_people where id=v_student and role='student') then
      raise exception 'KH2_STUDENT_MISSING';
    end if;
    if v_date is null or v_date > (now() at time zone 'Asia/Tehran')::date or v_date < date '1900-01-01' then
      raise exception 'KH2_INVALID_DATE';
    end if;
    insert into public.kh2_delays(student_id,recorder_id,date_on,note)
    values(v_student,v_actor.id,v_date,coalesce(btrim(p_data->>'note'),''))
    on conflict (student_id,date_on) do nothing returning id into v_id;
    if v_id is null then raise exception 'KH2_DUPLICATE_DELAY'; end if;
  when 'send_appeal' then
    v_id := (p_data->>'delay_id')::uuid;
    if v_actor.role <> 'student' or not exists(select 1 from public.kh2_delays where id=v_id and student_id=v_actor.id)
    then raise exception 'KH2_FORBIDDEN' using errcode='42501'; end if;
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
    update public.kh2_appeals a set status=p_data->>'status',response=btrim(p_data->>'response'),
      reviewer_id=v_actor.id,reviewed_at=now()
    from public.kh2_delays d where a.id=v_id and a.delay_id=d.id and a.status='pending'
      and (v_actor.role='admin' or d.recorder_id=v_actor.id);
    if not found then raise exception 'KH2_APPEAL_UNAVAILABLE'; end if;
  else raise exception 'KH2_INVALID_ACTION';
  end case;
  return jsonb_build_object('ok',true);
end;
$$;

revoke all on function public.kh2_overview(), public.kh2_grades_for(uuid), public.kh2_act(text,jsonb) from public, anon, authenticated;
grant execute on function public.kh2_overview(), public.kh2_grades_for(uuid), public.kh2_act(text,jsonb) to authenticated;

commit;
