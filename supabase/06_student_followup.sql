begin;

create table public.kh2_followup_settings (
  singleton boolean primary key default true check (singleton),
  period text not null check (period in ('week','month')),
  threshold integer not null check (threshold between 1 and 31)
);
insert into public.kh2_followup_settings(period,threshold) values ('month',3);

create table public.kh2_class_moves (
  student_id uuid not null references public.kh2_people(id) on delete cascade,
  effective_on date not null check (effective_on>=date '1900-01-01'),
  previous_class text not null check (char_length(previous_class) between 1 and 80),
  new_class text not null check (char_length(new_class) between 1 and 80),
  changed_by uuid references public.kh2_people(id) on delete set null,
  changed_at timestamptz not null default now(),
  primary key(student_id,effective_on),
  check(previous_class<>new_class)
);

create table public.kh2_inbox_items (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.kh2_people(id) on delete cascade,
  delay_id uuid not null references public.kh2_delays(id) on delete cascade,
  kind text not null check (kind in ('delay_added','appeal_added','appeal_approved','appeal_rejected')),
  date_on date not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique(recipient_id,kind,delay_id)
);
create index kh2_inbox_recent_idx on public.kh2_inbox_items(recipient_id,created_at desc,id desc);
create index kh2_inbox_unread_idx on public.kh2_inbox_items(recipient_id) where read_at is null;
create index kh2_inbox_delay_idx on public.kh2_inbox_items(delay_id);

alter table public.kh2_followup_settings enable row level security;
alter table public.kh2_class_moves enable row level security;
alter table public.kh2_inbox_items enable row level security;
revoke all on public.kh2_followup_settings, public.kh2_class_moves, public.kh2_inbox_items from public, anon, authenticated;

create function kh2_private.record_inbox_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_delay public.kh2_delays;
  v_kind text;
begin
  if tg_table_name='kh2_delays' then
    insert into public.kh2_inbox_items(recipient_id,delay_id,kind,date_on)
    values(new.student_id,new.id,'delay_added',new.date_on)
    on conflict (recipient_id,kind,delay_id) do nothing;
    return new;
  end if;

  select * into strict v_delay from public.kh2_delays where id=new.delay_id;
  if tg_op='INSERT' then
    insert into public.kh2_inbox_items(recipient_id,delay_id,kind,date_on)
    select p.id,v_delay.id,'appeal_added',v_delay.date_on
    from public.kh2_people p
    where (p.id=v_delay.recorder_id and p.id<>v_delay.student_id and (
      (p.role='gate' and p.gate_revoked_at is null) or p.gate_assigned_at is not null
    )) or (p.role='admin' and not exists (
      select 1 from public.kh2_people reviewer
      where reviewer.id=v_delay.recorder_id and reviewer.id<>v_delay.student_id and (
        (reviewer.role='gate' and reviewer.gate_revoked_at is null) or reviewer.gate_assigned_at is not null
      )
    ))
    on conflict (recipient_id,kind,delay_id) do nothing;
  elsif old.status is distinct from new.status and new.status in ('approved','rejected') then
    v_kind := case new.status when 'approved' then 'appeal_approved' else 'appeal_rejected' end;
    insert into public.kh2_inbox_items(recipient_id,delay_id,kind,date_on)
    values(v_delay.student_id,v_delay.id,v_kind,v_delay.date_on)
    on conflict (recipient_id,kind,delay_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function kh2_private.record_inbox_item() from public, anon, authenticated;

create trigger kh2_notify_delay after insert on public.kh2_delays
for each row execute function kh2_private.record_inbox_item();
create trigger kh2_notify_appeal after insert or update of status on public.kh2_appeals
for each row execute function kh2_private.record_inbox_item();

create function public.kh2_followup()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor public.kh2_people;
  v_staff boolean;
begin
  select * into v_actor from public.kh2_people where id=(select auth.uid());
  if not found then raise exception 'KH2_FORBIDDEN' using errcode='42501'; end if;
  v_staff := v_actor.role='admin' or v_actor.gate_assigned_at is not null or
    (v_actor.role='gate' and v_actor.gate_revoked_at is null);

  return jsonb_build_object(
    'overview',public.kh2_overview(),
    'settings',case when v_actor.role='admin' then
      (select jsonb_build_object('period',period,'threshold',threshold) from public.kh2_followup_settings where singleton)
    end,
    'class_moves',coalesce((
      select jsonb_agg(jsonb_build_object('student_id',m.student_id,'effective_on',m.effective_on,
        'previous_class',m.previous_class,'new_class',m.new_class) order by m.student_id,m.effective_on)
      from public.kh2_class_moves m where v_staff or m.student_id=v_actor.id
    ),'[]'::jsonb)
  );
end;
$$;

create function public.kh2_inbox(p_mark_read boolean default false,p_item uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor public.kh2_people;
  v_can_review boolean;
begin
  select * into v_actor from public.kh2_people where id=(select auth.uid());
  if not found then raise exception 'KH2_FORBIDDEN' using errcode='42501'; end if;
  v_can_review := v_actor.role='admin' or v_actor.gate_assigned_at is not null
    or (v_actor.role='gate' and v_actor.gate_revoked_at is null);

  if p_mark_read or p_item is not null then
    update public.kh2_inbox_items set read_at=now()
    where recipient_id=v_actor.id and read_at is null and (kind<>'appeal_added' or v_can_review)
      and (p_mark_read or id=p_item);
  end if;
  return jsonb_build_object(
    'unread',(select count(*) from public.kh2_inbox_items
      where recipient_id=v_actor.id and read_at is null and (kind<>'appeal_added' or v_can_review)),
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc,i.id desc)
      from (select id,delay_id,kind,date_on,created_at,read_at from public.kh2_inbox_items
        where recipient_id=v_actor.id and (kind<>'appeal_added' or v_can_review)
        order by created_at desc,id desc limit 50) i),'[]'::jsonb)
  );
end;
$$;

create function public.kh2_save_followup(p_period text,p_threshold integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.kh2_people where id=(select auth.uid()) and role='admin') then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;
  if p_period is null or p_period not in ('week','month') or p_threshold is null or p_threshold not between 1 and 31 then
    raise exception 'KH2_INVALID_FOLLOWUP';
  end if;
  update public.kh2_followup_settings set period=p_period,threshold=p_threshold where singleton;
end;
$$;

create function public.kh2_move_student(p_student uuid,p_class text,p_effective date,p_expected_class text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_student public.kh2_people;
  v_class text := coalesce(btrim(p_class),'');
begin
  if not exists(select 1 from public.kh2_people where id=v_actor and role='admin') then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;
  if char_length(v_class) not between 1 and 80 then raise exception 'KH2_INVALID_CLASS'; end if;
  if p_effective is null or p_effective < date '1900-01-01' or p_effective > (now() at time zone 'Asia/Tehran')::date then
    raise exception 'KH2_INVALID_DATE';
  end if;
  select * into v_student from public.kh2_people where id=p_student and role='student' for update;
  if not found then raise exception 'KH2_STUDENT_MISSING'; end if;
  if v_student.class_name is distinct from p_expected_class then raise exception 'KH2_CLASS_CHANGED'; end if;
  if v_student.class_name=v_class then raise exception 'KH2_UNCHANGED_CLASS'; end if;
  if exists(select 1 from public.kh2_class_moves where student_id=p_student and effective_on>=p_effective) then
    raise exception 'KH2_CLASS_MOVE_ORDER';
  end if;
  insert into public.kh2_class_moves(student_id,effective_on,previous_class,new_class,changed_by)
  values(p_student,p_effective,v_student.class_name,v_class,v_actor);
  update public.kh2_people set class_name=v_class where id=p_student;
end;
$$;

revoke all on function public.kh2_followup(), public.kh2_inbox(boolean,uuid), public.kh2_save_followup(text,integer),
  public.kh2_move_student(uuid,text,date,text) from public, anon, authenticated;
grant execute on function public.kh2_followup(), public.kh2_inbox(boolean,uuid), public.kh2_save_followup(text,integer),
  public.kh2_move_student(uuid,text,date,text) to authenticated;

commit;
