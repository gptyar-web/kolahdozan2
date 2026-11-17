import test from 'node:test';
import assert from 'node:assert/strict';
import {active,calendarDays,classYear,dayParts,importRows,matches,shift,showDate,today} from '../dist/domain.js';
import {indexClassMoves,studentClassOn,printLedger,reportDate,reportPeriod,reportRows} from '../dist/report.js';
import {followupRows} from '../dist/followup.js';
import * as demo from '../dist/demo.js';

test('Persian calendar handles leap days, Tehran school-year labels, and month boundaries',()=>{
  assert.deepEqual(dayParts('2025-03-20'),{year:1403,month:12,day:30});
  assert.equal(showDate('2025-03-21'),'۱۴۰۴/۰۱/۰۱');
  assert.equal(calendarDays('2025-03-28').days.length,31);
  assert.equal(classYear('2026-11-16'),'۱۴۰۵–۱۴۰۶');
  assert.equal(classYear('2026-07-16'),'۱۴۰۴–۱۴۰۵');
});
test('CSV imports preserve leading zeros and Persian scores',()=>{
  assert.deepEqual(importRows('\uFEFFکد ملی،نام،کلاس\r\n۰۰۱۰۰۰۰۰۰۱،علی احمدی،دهم ریاضی','students'),[
    {username:'0010000001',full_name:'علی احمدی',class_name:'دهم ریاضی'}
  ]);
  assert.deepEqual(importRows('national_id,subject,term,score\n۰۰۱۰۰۰۰۰۰۱,"درس, آزمایشی",نوبت اول,۱۸٫۵','grades'),[
    {username:'0010000001',subject:'درس, آزمایشی',term:'نوبت اول',score:'18.5'}
  ]);
});
test('search normalizes Persian and Arabic typing, and approved delays leave the report total',()=>{
  assert.equal(matches({full_name:'علی‌اصغر كريمی',class_name:'دهم ریاضی'},'علي كريمي دهم'),true);
  assert.equal(active([{status:'approved'},{status:'active'},{status:'pending'},{status:'rejected'}]).length,3);
});
test('demo workflow registers an appeal, restricts the student view and updates the original representative queue',async()=>{
  demo.selectDemoRole('student');
  const view=await demo.overview();
  assert.equal(view.students.length,1);
  assert.ok(view.delays.every(d=>d.student_id===view.me.id));
  const item=view.delays.find(d=>d.status==='active');
  assert.ok(item);
  await demo.act('send_appeal',{delay_id:item.id,reason:'دلیل اعتراض آزمایشی'});
  await assert.rejects(demo.act('send_appeal',{delay_id:item.id,reason:'اعتراض تکراری'}),/KH2_DUPLICATE_APPEAL/);
  demo.selectDemoRole('gate');
  const {appeals,students}=await demo.overview();
  const gateMe=(await demo.overview()).me;
  assert.ok(students.filter(s=>s.id!==gateMe.id).every(s=>!s.username));
  const appeal=appeals.find(a=>a.delay_id===item.id);
  await demo.act('review_appeal',{appeal_id:appeal.id,status:'approved',response:'نتیجه بررسی شد'});
  demo.selectDemoRole('student');
  assert.equal((await demo.overview()).delays.find(d=>d.id===item.id).status,'approved');
});

test('demo administrator can import students, assign grades and photos, and create representatives',async()=>{
  demo.selectDemoRole('admin');
  const account={username:'0101111001',full_name:'دانش‌آموز جدید',class_name:'دهم ریاضی'};
  assert.equal((await demo.act('import_students',[account])).added,1);
  assert.equal((await demo.act('import_students',[account])).skipped,1);
  const person=(await demo.overview()).students.find(p=>p.username===account.username);
  assert.ok(person);
  assert.equal((await demo.act('import_grades',[{username:account.username,subject:'ریاضی',term:'نوبت اول',score:'20'}])).added,1);
  assert.equal((await demo.gradesFor(person.id))[0].score,20);
  await demo.putPhoto(person.id,new File([new Uint8Array([137,80,78,71])],'0101111001.png',{type:'image/png'}));
  const picture=(await demo.overview()).students.find(p=>p.id===person.id).photo_path;
  assert.match((await demo.photoLinks([picture]))[picture],/^blob:/);
  assert.equal((await demo.act('add_gate',{username:account.username})).id,person.id);
  assert.ok((await demo.overview()).staff.some(p=>p.id===person.id&&p.role==='student'));
  await assert.rejects(demo.act('add_gate',{username:account.username}),/KH2_GATE_ALREADY_ASSIGNED/);
  await assert.rejects(demo.act('add_gate',{username:'0199999999'}),/KH2_STUDENT_MISSING/);
  demo.selectDemoRole('gate');
  const rep=(await demo.overview()).me;
  assert.equal(rep.role,'student');
  assert.ok(rep.gate_assigned_at);
  await assert.rejects(demo.act('register_delay',{student_id:rep.id,date_on:today()}),/KH2_OWN_DELAY/);
  await demo.changePassword(rep.username,rep.username,'NewRepPassword12');
  await assert.rejects(demo.gradesFor(person.id),/KH2_FORBIDDEN/);
  await demo.act('register_delay',{student_id:person.id,date_on:today(),note:''});
  await assert.rejects(demo.act('register_delay',{student_id:person.id,date_on:today(),note:''}),/KH2_DUPLICATE_DELAY/);
  assert.equal((await demo.overview()).delays.find(d=>d.student_id===person.id).date_on,today());
  demo.selectDemoRole('student');
  await assert.rejects(demo.act('register_delay',{student_id:person.id,date_on:today()}),/KH2_FORBIDDEN/);
  const {me}=await demo.overview();
  await assert.rejects(demo.changePassword(me.username,'wrong','NewPassword12'),/invalid_credentials/);
  await demo.changePassword(me.username,me.username,'NewPassword12');
  await demo.changePassword(me.username,'NewPassword12','AnotherPassword12');
});


test('batch delays support both selection modes, preserve existing entries and write atomically on invalid input',async()=>{
  demo.selectDemoRole('gate');
  const view=await demo.overview();
  const [first,second]=view.students.filter(person=>person.id!==view.me.id);
  const day=shift(today(),-23);
  const earlier=shift(day,-1);
  const untouched=shift(day,-2);
  assert.deepEqual(await demo.registerDelays([first.id],[day,earlier],'اصل'),{added:2,skipped:0});
  assert.deepEqual(await demo.registerDelays([first.id,second.id],[day],'دوم'),{added:1,skipped:1});
  assert.deepEqual(await demo.registerDelays([first.id,second.id],[day],'تکراری'),{added:0,skipped:2});
  const result=await demo.overview();
  assert.equal(result.delays.find(d=>d.student_id===first.id&&d.date_on===day).note,'اصل');
  assert.ok(result.delays.some(d=>d.student_id===second.id&&d.date_on===day&&d.recorder_id===view.me.id));
  await assert.rejects(demo.registerDelays([first.id,view.me.id],[untouched]),/KH2_OWN_DELAY/);
  await assert.rejects(demo.registerDelays([first.id],[untouched,shift(today(),1)]),/KH2_INVALID_DATE/);
  await assert.rejects(demo.registerDelays([first.id,second.id],[day,earlier]),/KH2_INVALID_DELAY_BATCH/);
  assert.ok(!(await demo.overview()).delays.some(d=>d.date_on===untouched));
  demo.selectDemoRole('student');
  await assert.rejects(demo.registerDelays([first.id],[untouched]),/KH2_FORBIDDEN/);
});


test('class reports respect inclusive dates and print twenty separate month/day cells per page',()=>{
  const people=[{id:'1',full_name:'دانش‌آموز نمونه',class_name:'۷۰۱'},{id:'2',full_name:'دانش‌آموز دیگر',class_name:'۷۰۲'}];
  const delay=(date_on,status='active')=>({student_id:'1',date_on,status});
  const rows=reportRows(people,[delay('2026-11-16'),delay('2026-11-15','cancelled'),delay('2026-11-13','approved'),delay('2026-11-14'),delay('2026-11-12')],'2026-11-13','2026-11-16');
  assert.deepEqual(rows.map(row=>row.dates),[['2026-11-14','2026-11-16'],[]]);
  assert.deepEqual(reportPeriod('week','2026-11-16'),{start:'2026-11-14',end:'2026-11-16'});
  assert.deepEqual(reportPeriod('month','2026-11-16'),{start:'2026-10-23',end:'2026-11-16'});
  assert.equal(reportDate('2026-11-16'),'۲۵/۰۸');
  assert.equal(reportDate('2026-10-18',{monthFirst:true}),'۰۷/۲۶');
  const html=printLedger(rows,'بازهٔ نمونه','۱۴۰۵–۱۴۰۶');
  assert.equal((html.match(/class="ledger-page"/g)||[]).length,2);
  assert.match(html,/<td class="ledger-date" dir="ltr">۰۸\/۲۳<\/td><td class="ledger-date" dir="ltr">۰۸\/۲۵<\/td>/);
  assert.equal((html.match(/class="ledger-date"/g)||[]).length,1600);
  const ongoing=printLedger([{person:people[0],dates:Array.from({length:21},(_,i)=>shift('2026-11-16',-i))}],'همهٔ تاریخ‌ها');
  assert.equal((ongoing.match(/class="ledger-page"/g)||[]).length,2);
});

test('an administrator can correct and cancel with audit history and revoke only representative privileges',async()=>{
  demo.selectDemoRole('admin');
  const {staff,students}=await demo.overview();
  const target=students[1];
  const date=shift(today(),-42);
  await demo.registerDelays([target.id],[date],'نمونه');
  const original=(await demo.overview()).delays.find(d=>d.student_id===target.id&&d.date_on===date);
  const corrected=await demo.updateDelay(original.id,'correct','تاریخ درست شد',target.id,shift(date,-1));
  const history=await demo.delayHistory(corrected.replacement_id);
  assert.equal(history[0].before_entry.date_on,date);
  assert.equal(history[0].after_entry.date_on,shift(date,-1));
  assert.equal(history[0].changed_by_name,'مدیر دبیرستان');
  await demo.updateDelay(corrected.replacement_id,'cancel','از گزارش حذف شد');
  assert.ok((await demo.delayHistory(corrected.replacement_id)).some(item=>item.action==='cancel'));
  assert.equal((await demo.overview()).delays.find(d=>d.id===original.id).status,'cancelled');
  assert.deepEqual(await demo.registerDelays([target.id],[date]),{added:1,skipped:0});
  const representative=staff.find(person=>person.id==='sample-7');
  await demo.revokeGate(representative.id,representative.gate_assigned_at);
  demo.selectDemoRole('gate');
  const personal=await demo.overview();
  assert.equal(personal.me.role,'student');
  assert.equal(personal.students.length,1);
  await assert.rejects(demo.registerDelays([target.id],[date]),/KH2_FORBIDDEN/);
  await assert.rejects(demo.delayHistory(original.id),/KH2_FORBIDDEN/);
});


test('follow-up thresholds count only active delays in the selected calendar period',()=>{
  const people=[{id:'1',full_name:'دانش‌آموز اول'},{id:'2',full_name:'دانش‌آموز دوم'}];
  const delay=(student_id,date_on,status='active')=>({student_id,date_on,status});
  const delays=[delay('1','2026-11-14'),delay('1','2026-11-16','rejected'),delay('1','2026-11-13'),
    delay('2','2026-11-16'),delay('2','2026-11-15','approved'),delay('2','2026-11-14','cancelled')];
  assert.deepEqual(followupRows(people,delays,{period:'week',threshold:2},'2026-11-16'),[{person:people[0],count:2}]);
  assert.deepEqual(followupRows(people,delays,{period:'month',threshold:3},'2026-11-16'),[{person:people[0],count:3}]);
});

test('historical reports allocate delays to the class on each date, including the transfer date',()=>{
  const person={id:'1',full_name:'دانش‌آموز',class_name:'۲۷۱'};
  const moves=indexClassMoves([
    {student_id:'1',effective_on:'2026-11-16',previous_class:'۲۷۲',new_class:'۲۷۱'},
    {student_id:'1',effective_on:'2026-11-14',previous_class:'۲۷۱',new_class:'۲۷۲'}
  ]);
  assert.equal(studentClassOn(person,'2026-11-13',moves.get('1')),'۲۷۱');
  assert.equal(studentClassOn(person,'2026-11-14',moves.get('1')),'۲۷۲');
  assert.equal(studentClassOn(person,'2026-11-16',moves.get('1')),'۲۷۱');
  const delays=['2026-11-13','2026-11-14','2026-11-16'].map(date_on=>({student_id:'1',date_on,status:'active'}));
  const rows=reportRows([person],delays,'2026-11-13','2026-11-16',{classMoves:moves});
  assert.deepEqual(rows.map(({person,dates})=>[person.class_name,dates]),[
    ['۲۷۱',['2026-11-13','2026-11-16']],['۲۷۲',['2026-11-14']]
  ]);
  const previous=reportRows([person],[],'2026-11-14','2026-11-15',{classMoves:moves});
  assert.deepEqual(previous.map(row=>row.person.class_name),['۲۷۲']);
});

test('student inbox is private and shows both the delay and appeal result',async()=>{
  demo.selectDemoRole('student');
  const pupil=(await demo.overview()).me;
  const day=shift(today(),-65);
  demo.selectDemoRole('admin');
  await demo.registerDelays([pupil.id],[day]);
  assert.ok(!(await demo.inbox()).items.some(item=>item.kind==='delay_added'&&item.date_on===day));
  demo.selectDemoRole('student');
  const delay=(await demo.overview()).delays.find(item=>item.date_on===day);
  let items=(await demo.inbox()).items;
  const notification=items.find(item=>item.kind==='delay_added'&&item.delay_id===delay.id);
  assert.ok(notification&&!notification.read_at);
  await demo.inbox(false,notification.id);
  assert.ok((await demo.inbox()).items.find(item=>item.id===notification.id).read_at);
  await demo.act('send_appeal',{delay_id:delay.id,reason:'درخواست بررسی تأخیر'});
  demo.selectDemoRole('admin');
  items=(await demo.inbox()).items;
  assert.ok(items.some(item=>item.kind==='appeal_added'&&item.delay_id===delay.id));
  const appeal=(await demo.overview()).appeals.find(item=>item.delay_id===delay.id);
  await demo.act('review_appeal',{appeal_id:appeal.id,status:'approved',response:'درخواست بررسی شد'});
  demo.selectDemoRole('student');
  assert.ok((await demo.inbox()).items.some(item=>item.kind==='appeal_approved'&&item.delay_id===delay.id));
  assert.equal((await demo.inbox(true)).unread,0);
});
