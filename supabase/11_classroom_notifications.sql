begin;

alter table kh2_private.ledger_entries drop constraint ledger_entries_attendance_check;
update kh2_private.ledger_entries set attendance='absent' where attendance='excused';
alter table kh2_private.ledger_entries add constraint ledger_entries_attendance_check
  check (attendance in ('present','absent','late'));

alter table public.kh2_inbox_items
  add column lesson_assignment_id uuid references public.kh2_teacher_assignments(id) on delete cascade,
  add column message text,
  drop constraint kh2_inbox_items_kind_check,
  drop constraint kh2_inbox_items_target_check,
  add constraint kh2_inbox_items_kind_check check (kind in (
    'delay_added','appeal_added','appeal_approved','appeal_rejected','parent_requested',
    'teacher_message','student_message','lesson_absence','lesson_late'
  )),
  add constraint kh2_inbox_items_target_check check (
    (kind='parent_requested' and delay_id is null and lesson_assignment_id is null and message is null)
    or (kind in ('delay_added','appeal_added','appeal_approved','appeal_rejected')
      and delay_id is not null and requested_by is null and lesson_assignment_id is null and message is null)
    or (kind in ('teacher_message','student_message') and delay_id is null and lesson_assignment_id is not null
      and message is not null and char_length(btrim(message)) between 1 and 800)
    or (kind in ('lesson_absence','lesson_late') and delay_id is null and lesson_assignment_id is not null and message is null)
  );

create unique index kh2_inbox_lesson_attendance_idx
  on public.kh2_inbox_items(lesson_assignment_id,date_on,recipient_id,kind)
  where kind in ('lesson_absence','lesson_late');

alter function public.kh2_save_teaching_ledger(uuid,date,integer,text,jsonb) set schema kh2_private;
revoke all on function kh2_private.kh2_save_teaching_ledger(uuid,date,integer,text,jsonb) from public,anon,authenticated;

create function public.kh2_save_teaching_ledger(p_assignment uuid,p_date date,p_revision integer,p_topic text,p_rows jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare
  v_revision integer;
begin
  if jsonb_typeof(p_rows)='array' and p_rows @> '[{"attendance":"excused"}]'::jsonb then
    raise exception 'KH2_INVALID_LEDGER';
  end if;
  v_revision:=kh2_private.kh2_save_teaching_ledger(p_assignment,p_date,p_revision,p_topic,p_rows);

  delete from public.kh2_inbox_items n
    where n.lesson_assignment_id=p_assignment and n.date_on=p_date and n.kind in ('lesson_absence','lesson_late')
      and not exists (
        select 1 from kh2_private.ledger_entries e
          where e.assignment_id=p_assignment and e.date_on=p_date and e.student_id=n.recipient_id and
          n.kind=case e.attendance when 'absent' then 'lesson_absence' when 'late' then 'lesson_late' end
      );

  insert into public.kh2_inbox_items(recipient_id,lesson_assignment_id,date_on,kind,requested_by)
    select e.student_id,p_assignment,p_date,
      case e.attendance when 'absent' then 'lesson_absence' else 'lesson_late' end,(select auth.uid())
    from kh2_private.ledger_entries e
    where e.assignment_id=p_assignment and e.date_on=p_date and e.attendance in ('absent','late')
    on conflict (lesson_assignment_id,date_on,recipient_id,kind) where kind in ('lesson_absence','lesson_late') do nothing;

  return v_revision;
end;
$$;

create function public.kh2_student_coursework()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_student public.kh2_people;
begin
  select * into v_student from public.kh2_people where id=(select auth.uid()) and role='student';
  if not found then raise exception 'KH2_FORBIDDEN' using errcode='42501'; end if;
  return jsonb_build_object(
    'entries',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.date_on desc,x.subject,x.teacher_name)
      from (
        select e.date_on,e.attendance,e.score,a.class_name,a.subject,p.full_name as teacher_name
        from kh2_private.ledger_entries e join public.kh2_teacher_assignments a on a.id=e.assignment_id
        join public.kh2_people p on p.id=a.staff_id
        where e.student_id=v_student.id and (e.attendance is not null or e.score is not null)
      ) x
    ),'[]'::jsonb),
    'teachers',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.teacher_name,x.subject)
      from (
        select a.id,a.class_name,a.subject,p.full_name as teacher_name
        from public.kh2_teacher_assignments a join public.kh2_people p on p.id=a.staff_id
        where a.class_name=v_student.class_name and a.archived_at is null and p.id<>v_student.id
      ) x
    ),'[]'::jsonb)
  );
end;
$$;

create function public.kh2_send_classroom_message(p_assignment uuid,p_student uuid,p_date date,p_message text,p_request uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_assignment public.kh2_teacher_assignments;
  v_student public.kh2_people;
  v_recipient uuid;
  v_kind text;
begin
  select * into v_assignment from public.kh2_teacher_assignments where id=p_assignment and archived_at is null for share;
  select * into v_student from public.kh2_people where id=p_student and role='student';
  if v_assignment.id is null or v_student.id is null or v_actor is null or v_student.id=v_assignment.staff_id then
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;

  if p_date is null or p_date<date '1900-01-01' or p_date>(now() at time zone 'Asia/Tehran')::date then
    raise exception 'KH2_INVALID_DATE';
  end if;
  if v_actor=v_student.id and v_student.class_name=v_assignment.class_name then
    v_recipient:=v_assignment.staff_id;
    v_kind:='student_message';
  elsif v_actor=v_assignment.staff_id and exists(
    select 1 from kh2_private.ledger_roster(v_assignment.class_name,p_date,p_assignment) r where r.id=p_student
  ) then
    v_recipient:=p_student;
    v_kind:='teacher_message';
  else
    raise exception 'KH2_FORBIDDEN' using errcode='42501';
  end if;

  p_message:=btrim(p_message);
  if p_request is null or p_message is null or char_length(p_message) not between 1 and 800 then
    raise exception 'KH2_INVALID_CLASSROOM_MESSAGE';
  end if;
  insert into public.kh2_inbox_items(id,recipient_id,kind,date_on,requested_by,lesson_assignment_id,message)
  values(p_request,v_recipient,v_kind,p_date,v_actor,p_assignment,p_message)
  on conflict(id) do nothing;
  if not found and not exists(
    select 1 from public.kh2_inbox_items n where n.id=p_request and n.recipient_id=v_recipient
      and n.kind=v_kind and n.date_on=p_date and n.requested_by=v_actor
      and n.lesson_assignment_id=p_assignment and n.message=p_message
  ) then
    raise exception 'KH2_CLASSROOM_MESSAGE_CONFLICT';
  end if;
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
  v_can_review:=v_actor.role='admin' or v_actor.gate_assigned_at is not null
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
      from (
        select n.id,n.delay_id,n.kind,n.date_on,n.created_at,n.read_at,n.message,a.subject,a.class_name,
          case when n.lesson_assignment_id is not null then sender.full_name end as sender_name
        from public.kh2_inbox_items n
        left join public.kh2_teacher_assignments a on a.id=n.lesson_assignment_id
        left join public.kh2_people sender on sender.id=n.requested_by
        where n.recipient_id=v_actor.id and (n.kind<>'appeal_added' or v_can_review)
        order by n.created_at desc,n.id desc limit 50
      ) i),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.kh2_save_teaching_ledger(uuid,date,integer,text,jsonb),
  public.kh2_student_coursework(),public.kh2_send_classroom_message(uuid,uuid,date,text,uuid)
  from public,anon,authenticated;
grant execute on function public.kh2_save_teaching_ledger(uuid,date,integer,text,jsonb),
  public.kh2_student_coursework(),public.kh2_send_classroom_message(uuid,uuid,date,text,uuid) to authenticated;

commit;
