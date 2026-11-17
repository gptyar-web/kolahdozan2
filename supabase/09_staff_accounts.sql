begin;

alter table public.kh2_people
  drop constraint kh2_people_role_check,
  add constraint kh2_people_role_check check (role in ('admin','gate','student','teacher','deputy'));

create table public.kh2_staff_profiles (
  staff_id uuid primary key references public.kh2_people(id) on delete cascade,
  national_id text check (national_id ~ '^[0-9]{10}$'),
  personnel_code text check (personnel_code ~ '^[0-9]{1,20}$'),
  deputy boolean not null default false,
  evaluator boolean not null default false,
  password_issued_at timestamptz
);
create table public.kh2_teacher_assignments (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.kh2_staff_profiles(staff_id) on delete cascade,
  class_name text not null check (char_length(btrim(class_name)) between 1 and 80),
  subject text not null check (char_length(btrim(subject)) between 1 and 100),
  unique (staff_id,class_name,subject)
);

alter table public.kh2_staff_profiles enable row level security;
alter table public.kh2_teacher_assignments enable row level security;
revoke all on public.kh2_staff_profiles, public.kh2_teacher_assignments from public, anon, authenticated;

create or replace function kh2_private.add_person(p_username text, p_password text, p_name text, p_role text, p_class text default '')
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
    or p_role is null or p_role not in ('admin','gate','student','teacher','deputy') then
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

create function kh2_private.import_staff(p_rows jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_row record;
  v_person public.kh2_people;
  v_role text;
  v_id uuid;
  v_created integer := 0;
  v_linked integer := 0;
begin
  for v_row in
    select * from jsonb_to_recordset(p_rows) as entry(
      username text,full_name text,national_id text,personnel_code text,deputy boolean,evaluator boolean)
    order by username
  loop
    v_role := case when v_row.deputy then 'deputy' else 'teacher' end;
    perform pg_advisory_xact_lock(hashtext('kh2_staff:'||v_row.username)::bigint);
    select * into v_person from public.kh2_people where username=v_row.username for update;
    if not found then
      v_id := kh2_private.add_person(v_row.username,encode(extensions.gen_random_bytes(24),'hex'),
        v_row.full_name,v_role);
      v_created := v_created+1;
    elsif v_person.full_name<>v_row.full_name or v_person.role not in ('admin','deputy','teacher') then
      raise exception 'KH2_STAFF_CONFLICT';
    else
      v_id := v_person.id;
      v_linked := v_linked+1;
    end if;

    insert into public.kh2_staff_profiles(staff_id,national_id,personnel_code,deputy,evaluator)
    values(v_id,v_row.national_id,v_row.personnel_code,v_row.deputy,v_row.evaluator)
    on conflict (staff_id) do update
      set national_id=excluded.national_id,personnel_code=excluded.personnel_code,
          deputy=excluded.deputy,evaluator=excluded.evaluator;
  end loop;
  return jsonb_build_object('created',v_created,'linked',v_linked);
end;
$$;

create function public.kh2_staff_directory()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor public.kh2_people;
  v_admin boolean;
begin
  select * into v_actor from public.kh2_people where id=(select auth.uid());
  if not found or v_actor.role not in ('admin','teacher','deputy') then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;
  v_admin := v_actor.role='admin';

  return jsonb_build_object(
    'staff',coalesce((
      select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'role',p.role,
        'username',p.username,'national_id',s.national_id,'personnel_code',s.personnel_code,
        'deputy',s.deputy,'evaluator',s.evaluator,
        'password_pending',p.role in ('teacher','deputy') and s.password_issued_at is null) order by p.full_name,p.id)
      from public.kh2_staff_profiles s join public.kh2_people p on p.id=s.staff_id
      where v_admin or p.id=v_actor.id
    ),'[]'::jsonb),
    'assignments',coalesce((
      select jsonb_agg(to_jsonb(a) order by a.class_name,a.subject,a.id)
      from public.kh2_teacher_assignments a where v_admin or a.staff_id=v_actor.id
    ),'[]'::jsonb),
    'classes',case when v_admin then coalesce((
      select jsonb_agg(c.class_name order by c.class_name)
      from (select distinct class_name from public.kh2_people where role='student') c
    ),'[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create function public.kh2_issue_staff_password(p_staff uuid,p_password text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_previous timestamptz;
  v_username text;
begin
  if not exists(select 1 from public.kh2_people where id=(select auth.uid()) and role='admin') then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;
  if p_password is null or p_password !~ '^[a-f0-9]{32}$' then
    raise exception 'KH2_INVALID_ACCOUNT';
  end if;
  select s.password_issued_at,p.username into v_previous,v_username
  from public.kh2_staff_profiles s join public.kh2_people p on p.id=s.staff_id
  where s.staff_id=p_staff and p.role in ('teacher','deputy') for update of s;
  if not found then raise exception 'KH2_STAFF_MISSING'; end if;

  if v_previous is not null then
    if exists(
      select 1 from auth.users u where u.id=p_staff and u.email=v_username||'@kh2.portal.invalid'
        and u.encrypted_password=extensions.crypt(p_password,u.encrypted_password)
    ) then return; end if;
    raise exception 'KH2_PASSWORD_ALREADY_ISSUED';
  end if;

  update auth.users u set encrypted_password=extensions.crypt(p_password,extensions.gen_salt('bf',10)),updated_at=now()
  where u.id=p_staff and u.email=v_username||'@kh2.portal.invalid';
  if not found then raise exception 'KH2_STAFF_MISSING'; end if;
  update public.kh2_staff_profiles set password_issued_at=now() where staff_id=p_staff;
end;
$$;

create function public.kh2_set_teacher_assignment(p_staff uuid,p_class text,p_subject text,p_remove uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_class text := btrim(p_class);
  v_subject text := btrim(p_subject);
begin
  if not exists(select 1 from public.kh2_people where id=(select auth.uid()) and role='admin') then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;
  if p_remove is not null then
    delete from public.kh2_teacher_assignments where id=p_remove and staff_id=p_staff;
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
  values(p_staff,v_class,v_subject) on conflict (staff_id,class_name,subject) do nothing;
end;
$$;

revoke all on function kh2_private.import_staff(jsonb) from public, anon, authenticated;
revoke all on function public.kh2_staff_directory(),public.kh2_issue_staff_password(uuid,text),
  public.kh2_set_teacher_assignment(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.kh2_staff_directory(),public.kh2_issue_staff_password(uuid,text),
  public.kh2_set_teacher_assignment(uuid,text,text,uuid) to authenticated;

commit;
