begin;

alter table public.kh2_delays
  add column excuse_reason text check (char_length(btrim(excuse_reason)) between 1 and 400);

alter table public.kh2_delay_changes
  drop constraint kh2_delay_changes_action_check,
  drop constraint kh2_delay_changes_check,
  drop constraint kh2_delay_changes_original_id_key,
  add constraint kh2_delay_changes_action_check check (action in ('correct','cancel','excuse')),
  add constraint kh2_delay_changes_entries_check check (
    (action='correct' and replacement_id is not null and after_entry is not null)
    or (action='cancel' and replacement_id is null and after_entry is null)
    or (action='excuse' and replacement_id is null and after_entry is not null)
  );
create index kh2_delay_changes_original_idx on public.kh2_delay_changes(original_id);
create unique index kh2_delay_changes_final_original_idx
  on public.kh2_delay_changes(original_id) where action in ('correct','cancel');

alter table public.kh2_inbox_items
  alter column delay_id drop not null,
  add column requested_by uuid references public.kh2_people(id) on delete set null,
  drop constraint kh2_inbox_items_kind_check,
  add constraint kh2_inbox_items_kind_check check (
    kind in ('delay_added','appeal_added','appeal_approved','appeal_rejected','parent_requested')
  ),
  add constraint kh2_inbox_items_target_check check (
    (kind='parent_requested' and delay_id is null)
    or (kind<>'parent_requested' and delay_id is not null and requested_by is null)
  );

create function public.kh2_request_parent(p_student uuid,p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor public.kh2_people;
begin
  select * into v_actor from public.kh2_people where id=(select auth.uid());
  if not found or not (v_actor.role='admin' or v_actor.gate_assigned_at is not null
      or (v_actor.role='gate' and v_actor.gate_revoked_at is null)) then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;
  if p_student=v_actor.id then raise exception 'KH2_FORBIDDEN' using errcode='42501'; end if;
  if not exists(select 1 from public.kh2_people where id=p_student and role='student') then
    raise exception 'KH2_STUDENT_MISSING';
  end if;

  insert into public.kh2_inbox_items(id,recipient_id,kind,date_on,requested_by)
  values(p_request_id,p_student,'parent_requested',(now() at time zone 'Asia/Tehran')::date,v_actor.id)
  on conflict (id) do nothing;
  if not found and not exists(
    select 1 from public.kh2_inbox_items
    where id=p_request_id and recipient_id=p_student and kind='parent_requested' and requested_by=v_actor.id
  ) then
    raise exception 'KH2_PARENT_REQUEST_CONFLICT';
  end if;
end;
$$;

create function kh2_private.normalize_excuse_reason(p_reason text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_reason text := btrim(p_reason,E' \t\n\r');
begin
  if v_reason is not null and char_length(v_reason) not between 1 and 400 then
    raise exception 'KH2_INVALID_EXCUSE_REASON';
  end if;
  return v_reason;
end;
$$;

create function public.kh2_register_delays(
  p_student_ids uuid[],
  p_dates date[],
  p_note text,
  p_excuse_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor public.kh2_people;
  v_students uuid[];
  v_dates date[];
  v_note text := coalesce(btrim(p_note),'');
  v_excuse text;
  v_added int;
begin
  select * into v_actor from public.kh2_people where id = (select auth.uid());
  if not found or (v_actor.role <> 'admin' and (v_actor.role <> 'gate' or v_actor.gate_revoked_at is not null) and v_actor.gate_assigned_at is null) then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;

  v_excuse := kh2_private.normalize_excuse_reason(p_excuse_reason);

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

  insert into public.kh2_delays(student_id,recorder_id,date_on,note,excuse_reason)
  select s.id,v_actor.id,d.day,v_note,v_excuse
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

create or replace function public.kh2_register_delays(
  p_student_ids uuid[],p_dates date[],p_note text default ''
)
returns jsonb language sql security definer set search_path = '' as $$
  select public.kh2_register_delays(p_student_ids,p_dates,p_note,null);
$$;

create function kh2_private.update_delay(
  p_delay uuid,p_action text,p_reason text,p_student uuid,p_date date,p_excuse_reason text,p_edit_excuse boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor public.kh2_people;
  v_target public.kh2_people;
  v_old public.kh2_delays;
  v_new public.kh2_delays;
  v_before jsonb;
  v_after jsonb;
  v_reason text := coalesce(btrim(p_reason),'');
  v_excuse text;
  v_history_action text := p_action;
begin
  select * into v_actor from public.kh2_people where id=(select auth.uid());
  if not found or not (v_actor.role='admin' or v_actor.gate_assigned_at is not null
      or (v_actor.role='gate' and v_actor.gate_revoked_at is null)) then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;
  if p_action is null or p_action not in ('correct','cancel') then
    raise exception 'KH2_INVALID_ACTION';
  end if;
  if char_length(v_reason) not between 3 and 400 then
    raise exception 'KH2_INVALID_CHANGE_REASON';
  end if;
  select * into v_old from public.kh2_delays where id=p_delay for update;
  if not found or v_old.cancelled_at is not null then raise exception 'KH2_DELAY_UNAVAILABLE'; end if;
  if v_actor.role<>'admin' and (v_old.recorder_id is distinct from v_actor.id or v_old.student_id=v_actor.id) then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;

  select jsonb_build_object('student_id',p.id,'full_name',p.full_name,'class_name',p.class_name,
    'date_on',v_old.date_on,'excuse_reason',v_old.excuse_reason)
  into v_before from public.kh2_people p where p.id=v_old.student_id;

  if p_action='correct' then
    if p_date is null or p_date < date '1900-01-01' or p_date > (now() at time zone 'Asia/Tehran')::date then
      raise exception 'KH2_INVALID_DATE';
    end if;
    if p_student=v_actor.id then raise exception 'KH2_OWN_DELAY' using errcode='42501'; end if;
    select * into v_target from public.kh2_people where id=p_student and role='student';
    if not found then raise exception 'KH2_STUDENT_MISSING'; end if;
    v_excuse := case when p_edit_excuse then kh2_private.normalize_excuse_reason(p_excuse_reason)
      when p_student=v_old.student_id then v_old.excuse_reason end;
    v_after := jsonb_build_object('student_id',v_target.id,'full_name',v_target.full_name,
      'class_name',v_target.class_name,'date_on',p_date,'excuse_reason',v_excuse);

    if p_student=v_old.student_id and p_date=v_old.date_on then
      if v_excuse is not distinct from v_old.excuse_reason then raise exception 'KH2_UNCHANGED_DELAY'; end if;
      update public.kh2_delays set excuse_reason=v_excuse where id=p_delay;
      v_history_action := 'excuse';
    else
      update public.kh2_delays set cancelled_at=now() where id=p_delay;
      insert into public.kh2_delays(student_id,recorder_id,date_on,note,excuse_reason)
      values(p_student,v_actor.id,p_date,case when p_student=v_old.student_id then v_old.note else '' end,v_excuse)
      on conflict (student_id,date_on) where cancelled_at is null do nothing
      returning * into v_new;
      if not found then raise exception 'KH2_DUPLICATE_DELAY'; end if;
    end if;
  else
    update public.kh2_delays set cancelled_at=now() where id=p_delay;
  end if;

  insert into public.kh2_delay_changes(original_id,replacement_id,action,before_entry,after_entry,reason,changed_by,changed_by_name)
  values(p_delay,v_new.id,v_history_action,v_before,v_after,v_reason,v_actor.id,v_actor.full_name);
  return jsonb_build_object('ok',true,'replacement_id',v_new.id);
end;
$$;

create or replace function public.kh2_update_delay(
  p_delay uuid,p_action text,p_reason text,p_student uuid default null,p_date date default null
)
returns jsonb language sql security definer set search_path = '' as $$
  select kh2_private.update_delay(p_delay,p_action,p_reason,p_student,p_date,null,false);
$$;

create function public.kh2_update_delay(
  p_delay uuid,p_action text,p_reason text,p_student uuid,p_date date,p_excuse_reason text
)
returns jsonb language sql security definer set search_path = '' as $$
  select kh2_private.update_delay(p_delay,p_action,p_reason,p_student,p_date,p_excuse_reason,true);
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
    'delays', coalesce((select jsonb_agg(
      case when v_actor.role='admin' or d.student_id=v_actor.id or d.recorder_id=v_actor.id
        then to_jsonb(d) else to_jsonb(d)-'excuse_reason' end || jsonb_build_object(
      'excused',d.excuse_reason is not null,
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

create or replace function public.kh2_inbox(p_mark_read boolean default false,p_item uuid default null)
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

revoke all on function kh2_private.normalize_excuse_reason(text),
  kh2_private.update_delay(uuid,text,text,uuid,date,text,boolean) from public, anon, authenticated;
revoke all on function public.kh2_request_parent(uuid,uuid),
  public.kh2_register_delays(uuid[],date[],text,text),
  public.kh2_update_delay(uuid,text,text,uuid,date,text) from public, anon, authenticated;
grant execute on function public.kh2_request_parent(uuid,uuid),
  public.kh2_register_delays(uuid[],date[],text,text),
  public.kh2_update_delay(uuid,text,text,uuid,date,text) to authenticated;

commit;
