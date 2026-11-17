-- Run with SQL-editor privileges. All fixture users and records are rolled back.
begin;
do $test$
<<test_case>>
declare
  admin_id uuid;
  student_id uuid;
  other_id uuid;
  gate_id uuid;
  other_gate_id uuid;
  delay_id uuid;
  gate_delay_id uuid;
  batch_date date;
  correction_id uuid;
  assignment_date timestamptz;
  notice_id uuid;
  gate_appeal_id uuid;
  gate_password_hash text;
  appeal_id uuid;
  result jsonb;
  test_date date := ((now() at time zone 'Asia/Tehran')::date - 1);
  suffix text := left(replace(gen_random_uuid()::text,'-',''),10);
  id_1 text := '00' || lpad((floor(random()*100000000)::bigint)::text,8,'0');
  id_3 text := '00' || lpad((floor(random()*100000000)::bigint)::text,8,'0');
  id_4 text := '00' || lpad((floor(random()*100000000)::bigint)::text,8,'0');
  id_2 text := '00' || lpad((floor(random()*100000000)::bigint)::text,8,'0');
begin
  admin_id := kh2_private.add_person('kh2_fixture_'||suffix,'TestOnly!'||suffix,'مدیر آزمایش تراکنشی','admin');
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  result := public.kh2_act('import_students',jsonb_build_array(
    jsonb_build_object('username',id_1,'full_name','دانش‌آموز اول','class_name','آزمایش یک'),
    jsonb_build_object('username',id_2,'full_name','دانش‌آموز دوم','class_name','آزمایش دو'),
    jsonb_build_object('username',id_3,'full_name','نمایندهٔ اول','class_name','آزمایش یک'),
    jsonb_build_object('username',id_4,'full_name','نمایندهٔ دوم','class_name','آزمایش دو'),
    jsonb_build_object('username','invalid','full_name','ردیف نامعتبر','class_name','آزمایش سه')));
  assert result->>'added' = '4' and jsonb_array_length(result->'errors') = 1, 'Batch student validation failed';
  select id into strict student_id from public.kh2_people where username=id_1;
  select id into strict other_id from public.kh2_people where username=id_2;
  select id into strict gate_id from public.kh2_people where username=id_3;
  select id into strict other_gate_id from public.kh2_people where username=id_4;
  select encrypted_password into strict gate_password_hash from auth.users where id=gate_id;
  result := public.kh2_act('add_gate',jsonb_build_object('username',id_3));
  assert (result->>'id')::uuid = gate_id, 'Representative assignment must reuse the student account';
  result := public.kh2_act('add_gate',jsonb_build_object('username',id_4));
  assert (result->>'id')::uuid = other_gate_id, 'Second representative assignment failed';
  assert exists(select 1 from public.kh2_people where id=gate_id and role='student' and gate_assigned_at is not null), 'Assignment removed the student role';
  assert (select encrypted_password from auth.users where id=gate_id) = gate_password_hash, 'Assignment changed the existing password';
  assert exists(select 1 from jsonb_array_elements(public.kh2_overview()->'staff') p where p->>'id'=gate_id::text), 'Assigned student does not appear in the staff list';
  begin
    perform public.kh2_act('add_gate',jsonb_build_object('username',id_3));
    raise exception 'Duplicate representative assignment was accepted';
  exception when raise_exception then assert sqlerrm='KH2_GATE_ALREADY_ASSIGNED', sqlerrm; end;
  perform public.kh2_act('register_delay',jsonb_build_object('student_id',gate_id,'date_on',test_date));
  select d.id into strict gate_delay_id from public.kh2_delays d where d.student_id=gate_id and date_on=test_date;
  assert exists(select 1 from auth.users u where u.id=student_id and extensions.crypt(id_1,u.encrypted_password)=u.encrypted_password), 'Initial password mismatch';

  result := public.kh2_act('import_students',jsonb_build_array(jsonb_build_object('username',id_1,'full_name','دانش‌آموز اول','class_name','آزمایش یک')));
  assert result->>'skipped' = '1', 'Duplicate import should skip the existing account';
  result := public.kh2_act('import_grades',jsonb_build_array(jsonb_build_object('username',id_1,'subject','ریاضی','term','نوبت اول','score','18.5')));
  assert result->>'added' = '1', 'Grade import failed';
  assert (public.kh2_grades_for(student_id)->0->>'score')::numeric = 18.5, 'Grade lookup failed';

  assert not has_table_privilege('authenticated','public.kh2_student_records','SELECT'), 'Student records are readable directly';
  assert not has_function_privilege('anon','public.kh2_student_record(uuid)','EXECUTE'), 'Anonymous callers can read student records';
  perform public.kh2_set_birth_date(student_id,'1389/06/15');
  update public.kh2_student_records r set details=details||'{"grade":"آزمایش","address":"نشانی آزمایشی"}'::jsonb
  where r.student_id=test_case.student_id;
  result := public.kh2_student_record(student_id);
  assert result->>'national_id'=id_1 and result->'details'->>'birth_date'='1389/06/15', 'Admin cannot see the full student record';

  perform set_config('request.jwt.claim.sub',gate_id::text,true);
  result := public.kh2_student_record(student_id);
  assert not result ? 'national_id' and result->'details'='{"grade":"آزمایش"}'::jsonb, 'Gate student record exposed private fields';
  begin
    perform public.kh2_set_birth_date(student_id,'1389/06/16');
    raise exception 'A representative edited a student record';
  exception when insufficient_privilege then assert sqlerrm='KH2_FORBIDDEN', sqlerrm; end;
  result := public.kh2_overview();
  assert result->'me'->>'username'=id_3 and result->'me'->>'role'='student', 'Representative lost access to own student profile';
  begin
    perform public.kh2_act('add_gate',jsonb_build_object('username',id_1));
    raise exception 'A representative can appoint other representatives';
  exception when insufficient_privilege then null; end;
  begin
    perform public.kh2_act('register_delay',jsonb_build_object('student_id',gate_id,'date_on',test_date-1));
    raise exception 'Representative registered own delay';
  exception when insufficient_privilege then assert sqlerrm='KH2_OWN_DELAY', sqlerrm; end;
  perform public.kh2_act('send_appeal',jsonb_build_object('delay_id',gate_delay_id,'reason','اعتراض شخصی نماینده'));
  result := public.kh2_overview();
  select (a->>'id')::uuid into strict gate_appeal_id from jsonb_array_elements(result->'appeals') a where a->>'delay_id'=gate_delay_id::text;
  begin
    perform public.kh2_act('review_appeal',jsonb_build_object('appeal_id',gate_appeal_id,'status','approved','response','نتیجه بررسی شد'));
    raise exception 'Representative reviewed own appeal';
  exception when raise_exception then assert sqlerrm='KH2_APPEAL_UNAVAILABLE', sqlerrm; end;
  assert exists(select 1 from jsonb_array_elements(result->'students') p where p->>'id'=student_id::text and not p ? 'username'), 'Gate student list exposed usernames';
  begin
    perform public.kh2_grades_for(student_id);
    raise exception 'Gate role can see grades';
  exception when insufficient_privilege then null; end;
  perform public.kh2_act('register_delay',jsonb_build_object('student_id',student_id,'date_on',test_date));
  select d.id into strict delay_id from public.kh2_delays d where d.student_id=(select id from public.kh2_people where username=id_1) and date_on=test_date;
  begin
    perform public.kh2_act('register_delay',jsonb_build_object('student_id',student_id,'date_on',test_date));
    raise exception 'Duplicate delay was accepted';
  exception when raise_exception then assert sqlerrm='KH2_DUPLICATE_DELAY', sqlerrm; end;

  perform set_config('request.jwt.claim.sub',other_id::text,true);
  result := public.kh2_overview();
  assert jsonb_array_length(result->'students') = 1 and jsonb_array_length(result->'delays') = 0, 'Other student received someone else’s data';
  begin
    perform public.kh2_act('send_appeal',jsonb_build_object('delay_id',delay_id,'reason','این اعتراض به رکورد دیگری است'));
    raise exception 'Other student filed an appeal for someone else';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claim.sub',student_id::text,true);
  perform public.kh2_act('send_appeal',jsonb_build_object('delay_id',delay_id,'reason','در ساعت ثبت‌شده اشتباه شده است'));
  result := public.kh2_overview();
  appeal_id := (result->'appeals'->0->>'id')::uuid;
  assert (result->'delays'->0->>'status') = 'pending', 'Pending appeal is not reflected in student view';

  perform set_config('request.jwt.claim.sub',other_gate_id::text,true);
  result := public.kh2_overview();
  assert not exists(select 1 from jsonb_array_elements(result->'appeals') a where a->>'id'=appeal_id::text), 'Another gate representative received this appeal';
  begin
    perform public.kh2_act('review_appeal',jsonb_build_object('appeal_id',appeal_id,'status','approved','response','نتیجه بررسی شد'));
    raise exception 'Another gate representative reviewed this appeal';
  exception when raise_exception then assert sqlerrm='KH2_APPEAL_UNAVAILABLE', sqlerrm; end;

  perform set_config('request.jwt.claim.sub',gate_id::text,true);
  perform public.kh2_act('review_appeal',jsonb_build_object('appeal_id',appeal_id,'status','approved','response','نتیجه بررسی شد'));
  perform set_config('request.jwt.claim.sub',student_id::text,true);
  result := public.kh2_overview();
  assert (result->'delays'->0->>'status') = 'approved' and (result->'appeals'->0->>'response') = 'نتیجه بررسی شد', 'Review result is missing';

  batch_date := test_date - 5;
  begin
    perform public.kh2_register_delays(array[other_id],array[batch_date],'');
    raise exception 'A regular student registered delays';
  exception when insufficient_privilege then assert sqlerrm='KH2_FORBIDDEN', sqlerrm; end;

  perform set_config('request.jwt.claim.sub',gate_id::text,true);
  result := public.kh2_register_delays(array[student_id],array[batch_date,batch_date-1,batch_date-1],'گروهی');
  assert (result->>'added')::integer=2 and (result->>'skipped')::integer=0, 'One student with multiple dates failed';
  result := public.kh2_register_delays(array[student_id,other_id],array[batch_date],'گروه دوم');
  assert (result->>'added')::integer=1 and (result->>'skipped')::integer=1, 'One date with multiple students failed';
  result := public.kh2_register_delays(array[student_id,other_id],array[batch_date],'تکراری');
  assert (result->>'added')::integer=0 and (result->>'skipped')::integer=2, 'A retry inserted duplicate rows';
  assert exists(select 1 from public.kh2_delays d where d.student_id=(select id from public.kh2_people where username=id_1) and d.date_on=batch_date and d.note='گروهی' and d.recorder_id=gate_id), 'A duplicate changed the original record';
  begin
    perform public.kh2_register_delays(array[student_id,gate_id],array[batch_date-2],'');
    raise exception 'A batch included the representative’s own account';
  exception when insufficient_privilege then assert sqlerrm='KH2_OWN_DELAY', sqlerrm; end;
  begin
    perform public.kh2_register_delays(array[student_id],array[batch_date-2,test_date+2],'');
    raise exception 'A batch included a future date';
  exception when raise_exception then assert sqlerrm='KH2_INVALID_DATE', sqlerrm; end;
  begin
    perform public.kh2_register_delays(array[student_id,gen_random_uuid()],array[batch_date-2],'');
    raise exception 'A batch included an unknown student';
  exception when raise_exception then assert sqlerrm='KH2_STUDENT_MISSING', sqlerrm; end;
  assert not exists(select 1 from public.kh2_delays d where d.student_id=(select id from public.kh2_people where username=id_1) and d.date_on=batch_date-2), 'An invalid batch partially wrote records';

  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  result := public.kh2_register_delays(array[student_id,other_id],array[batch_date-2],'');
  assert (result->>'added')::integer=2, 'Administrator could not register a batch';
  -- An administrator can amend the date or student without overwriting the original.
  begin
    perform public.kh2_update_delay(delay_id,'correct','تاریخ اصلاح شد',student_id,batch_date);
    raise exception 'Correction overwrote an existing delay';
  exception when raise_exception then assert sqlerrm='KH2_DUPLICATE_DELAY', sqlerrm; end;
  assert exists(select 1 from public.kh2_delays where id=delay_id and cancelled_at is null), 'Failed correction cancelled the original';
  result := public.kh2_update_delay(delay_id,'correct','دانش‌آموز اشتباه بود',other_id,batch_date-3);
  correction_id := (result->>'replacement_id')::uuid;
  result := public.kh2_delay_history(correction_id);
  assert result->0->>'reason'='دانش‌آموز اشتباه بود'
    and result->0->>'changed_by'=admin_id::text
    and result->0->'before_entry'->>'student_id'=student_id::text
    and result->0->'after_entry'->>'student_id'=other_id::text, 'Correction audit entries are incomplete';
  assert exists(select 1 from public.kh2_delays where id=delay_id and cancelled_at is not null), 'Correction did not preserve original as cancelled';
  assert exists(select 1 from public.kh2_appeals a where a.id=appeal_id and a.delay_id=test_case.delay_id), 'Another student got the original appeal';
  perform public.kh2_update_delay(correction_id,'cancel','این ثبت لازم نبود');
  result := public.kh2_delay_history(correction_id);
  assert jsonb_array_length(result)=2 and exists(select 1 from jsonb_array_elements(result) a where a->>'action'='cancel'), 'Cancellation history is missing';
  result := public.kh2_register_delays(array[other_id],array[batch_date-3],'ثبت تازه');
  assert (result->>'added')::int=1, 'Cancelled dates cannot be registered again';
  -- Old clients can still use the one-record API.
  perform public.kh2_act('register_delay',jsonb_build_object('student_id',other_id,'date_on',batch_date-4));

  select gate_assigned_at into strict assignment_date from public.kh2_people where id=gate_id;
  perform public.kh2_revoke_gate(gate_id,assignment_date);
  assert exists(select 1 from public.kh2_people where id=gate_id and role='student' and gate_assigned_at is null), 'Revocation removed student account';
  assert (select encrypted_password from auth.users where id=gate_id) = gate_password_hash, 'Revocation changed the password';
  perform set_config('request.jwt.claim.sub',gate_id::text,true);
  begin
    perform public.kh2_student_record(student_id);
    raise exception 'Revoked representative read a student record';
  exception when insufficient_privilege then assert sqlerrm='KH2_FORBIDDEN', sqlerrm; end;
  result := public.kh2_overview();
  assert jsonb_array_length(result->'students')=1 and result->'me'->>'role'='student', 'Revocation did not restrict the representative';
  begin
    perform public.kh2_register_delays(array[other_id],array[batch_date-5],'');
    raise exception 'Revoked representative registered a delay';
  exception when insufficient_privilege then assert sqlerrm='KH2_FORBIDDEN', sqlerrm; end;
  begin
    perform public.kh2_delay_history(correction_id);
    raise exception 'Student read private correction history';
  exception when insufficient_privilege then assert sqlerrm='KH2_FORBIDDEN', sqlerrm; end;
  begin
    perform public.kh2_update_delay(correction_id,'cancel','دلیل آزمایش');
    raise exception 'Student cancelled a delay';
  exception when insufficient_privilege then assert sqlerrm='KH2_FORBIDDEN', sqlerrm; end;
  begin
    perform public.kh2_revoke_gate(other_gate_id);
    raise exception 'Student revoked someone else’s role';
  exception when insufficient_privilege then assert sqlerrm='KH2_FORBIDDEN', sqlerrm; end;

  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  assert public.kh2_followup()->'settings'->>'period'='month', 'Default period is missing';
  perform public.kh2_save_followup('week',2);
  assert public.kh2_followup()->'settings'->>'threshold'='2', 'Administrator could not save a threshold';
  perform public.kh2_move_student(student_id,'آزمایش سه',test_date,'آزمایش یک');
  assert (select class_name from public.kh2_people where id=student_id)='آزمایش سه', 'Current class did not change';
  result := public.kh2_followup();
  assert exists(select 1 from jsonb_array_elements(result->'class_moves') m where m->>'student_id'=student_id::text
    and m->>'previous_class'='آزمایش یک' and m->>'new_class'='آزمایش سه' and m->>'effective_on'=test_date::text), 'Class history was not recorded';
  begin
    perform public.kh2_move_student(student_id,'آزمایش چهار',test_date-1,'آزمایش سه');
    raise exception 'Old transfer dates can break class history';
  exception when raise_exception then assert sqlerrm='KH2_CLASS_MOVE_ORDER',sqlerrm; end;
  perform public.kh2_move_student(other_id,'آزمایش چهار',test_date,'آزمایش دو');

  perform set_config('request.jwt.claim.sub',student_id::text,true);
  result := public.kh2_followup();
  assert (result->'settings')='null'::jsonb and jsonb_array_length(result->'class_moves')=1, 'Private class and settings data leaked';
  begin
    perform public.kh2_move_student(student_id,'آزمایش پنج',test_date+1,'آزمایش سه');
    raise exception 'Student could change class';
  exception when insufficient_privilege then null; end;
  begin
    perform public.kh2_save_followup('month',5);
    raise exception 'Student could change follow-up settings';
  exception when insufficient_privilege then null; end;

  result := public.kh2_inbox();
  assert exists(select 1 from jsonb_array_elements(result->'items') n where n->>'kind'='appeal_approved' and n->>'delay_id'=delay_id::text), 'Appeal outcome was not delivered';
  select (n->>'id')::uuid into strict notice_id from jsonb_array_elements(result->'items') n
    where n->>'kind'='delay_added' and n->>'delay_id'=delay_id::text;
  perform set_config('request.jwt.claim.sub',other_id::text,true);
  result := public.kh2_inbox(false,notice_id);
  assert not exists(select 1 from jsonb_array_elements(result->'items') n where n->>'id'=notice_id::text), 'Another student read a private notification';
  perform set_config('request.jwt.claim.sub',student_id::text,true);
  result := public.kh2_inbox();
  assert exists(select 1 from jsonb_array_elements(result->'items') n where n->>'id'=notice_id::text and n->>'read_at' is null), 'Another student could mark a private notification read';
  result := public.kh2_inbox(false,notice_id);
  assert exists(select 1 from jsonb_array_elements(result->'items') n where n->>'id'=notice_id::text and n->>'read_at' is not null), 'Student could not mark a notification read';
  result := public.kh2_inbox(true);
  assert result->>'unread'='0','Student could not mark all as read';

  perform set_config('request.jwt.claim.sub',gate_id::text,true);
  result := public.kh2_inbox();
  assert not exists(select 1 from jsonb_array_elements(result->'items') n where n->>'kind'='appeal_added'), 'Revoked gate account retained reviewer notifications';
  assert exists(select 1 from public.kh2_inbox_items where recipient_id=gate_id and kind='appeal_added'), 'Recorder did not receive an appeal notification before revocation';
  assert exists(select 1 from public.kh2_inbox_items where recipient_id=admin_id and kind='appeal_added'), 'Administrator did not receive an unassigned appeal notification';

  raise notice 'School portal role and data checks passed';
end;
$test$;
select 'school portal role and data checks passed' as result;
rollback;
