-- Run with SQL-editor privileges. All fixture users and records are rolled back.
begin;
do $test$
declare
  admin_id uuid;
  student_id uuid;
  other_id uuid;
  gate_id uuid;
  other_gate_id uuid;
  delay_id uuid;
  appeal_id uuid;
  result jsonb;
  test_date date := ((now() at time zone 'Asia/Tehran')::date - 1);
  suffix text := left(replace(gen_random_uuid()::text,'-',''),10);
  id_1 text := '00' || lpad((floor(random()*100000000)::bigint)::text,8,'0');
  id_2 text := '00' || lpad((floor(random()*100000000)::bigint)::text,8,'0');
begin
  admin_id := kh2_private.add_person('kh2_fixture_'||suffix,'TestOnly!'||suffix,'مدیر آزمایش تراکنشی','admin');
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  result := public.kh2_act('add_gate',jsonb_build_object('username','gate1_'||suffix,'password','TestOnly!'||suffix,'full_name','نمایندهٔ اول'));
  gate_id := (result->>'id')::uuid;
  result := public.kh2_act('add_gate',jsonb_build_object('username','gate2_'||suffix,'password','TestOnly!'||suffix,'full_name','نمایندهٔ دوم'));
  other_gate_id := (result->>'id')::uuid;
  result := public.kh2_act('import_students',jsonb_build_array(
    jsonb_build_object('username',id_1,'full_name','دانش‌آموز اول','class_name','آزمایش یک'),
    jsonb_build_object('username',id_2,'full_name','دانش‌آموز دوم','class_name','آزمایش دو'),
    jsonb_build_object('username','invalid','full_name','ردیف نامعتبر','class_name','آزمایش سه')));
  assert result->>'added' = '2' and jsonb_array_length(result->'errors') = 1, 'Batch student validation failed';
  select id into strict student_id from public.kh2_people where username=id_1;
  select id into strict other_id from public.kh2_people where username=id_2;
  assert exists(select 1 from auth.users u where u.id=student_id and extensions.crypt(id_1,u.encrypted_password)=u.encrypted_password), 'Initial password mismatch';

  result := public.kh2_act('import_students',jsonb_build_array(jsonb_build_object('username',id_1,'full_name','دانش‌آموز اول','class_name','آزمایش یک')));
  assert result->>'skipped' = '1', 'Duplicate import should skip the existing account';
  result := public.kh2_act('import_grades',jsonb_build_array(jsonb_build_object('username',id_1,'subject','ریاضی','term','نوبت اول','score','18.5')));
  assert result->>'added' = '1', 'Grade import failed';
  assert (public.kh2_grades_for(student_id)->0->>'score')::numeric = 18.5, 'Grade lookup failed';

  perform set_config('request.jwt.claim.sub',gate_id::text,true);
  result := public.kh2_overview();
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
  raise notice 'School portal role and data checks passed';
end;
$test$;
select 'school portal role and data checks passed' as result;
rollback;
