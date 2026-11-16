import test from 'node:test';
import assert from 'node:assert/strict';
import {active,calendarDays,classYear,dayParts,importRows,matches,showDate,today} from '../dist/domain.js';
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
  assert.ok(students.every(s=>!s.username));
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
  await demo.act('add_gate',{username:'test_representative',full_name:'نماینده نمونه',password:'TestPassword12'});
  assert.ok((await demo.overview()).staff.some(p=>p.username==='test_representative'));
  demo.selectDemoRole('gate');
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
