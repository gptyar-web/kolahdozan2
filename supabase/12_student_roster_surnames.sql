begin;

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
      (case when v_gate and p.id <> v_actor.id then to_jsonb(p) - 'username' else to_jsonb(p) end)
      || jsonb_build_object('family_name',r.details->>'family_name')
      order by p.full_name,p.id) from public.kh2_people p
      left join public.kh2_student_records r on r.student_id=p.id
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

create or replace function public.kh2_teaching_ledger(p_assignment uuid,p_date date)
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
      select jsonb_agg(jsonb_build_object('id',p.id,'full_name',p.full_name,'family_name',r.details->>'family_name',
          'attendance',e.attendance,'score',e.score,'note',coalesce(e.note,'')) order by p.full_name,p.id)
      from kh2_private.ledger_roster(v_assignment.class_name,p_date,p_assignment) p
      left join public.kh2_student_records r on r.student_id=p.id
      left join kh2_private.ledger_entries e
      on e.assignment_id=p_assignment and e.date_on=p_date and e.student_id=p.id
      where v_assignment.archived_at is null or e.student_id is not null
    ),'[]'::jsonb));
end;
$$;

commit;
