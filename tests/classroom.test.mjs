import test from 'node:test';
import assert from 'node:assert/strict';
import {compareStudentNames,importRows,localizeGradeList,today} from '../dist/domain.js';
import {printLedger,reportRows} from '../dist/report.js';
import {attendanceLabels,displayScore,scoreValue} from '../dist/staff.js';
import * as demo from '../dist/demo.js';

test('grades use Persian digits without changing class identifiers or course names',()=>{
  const line='0010000001,"ریاضی, بخش 2",نوبت 1,19.25';
  const displayed=localizeGradeList(line);
  assert.equal(displayed,'0010000001,"ریاضی, بخش 2",نوبت 1,۱۹٫۲۵');
  assert.deepEqual(importRows(displayed,'grades'),importRows(line,'grades'));
  assert.equal(displayScore('١٩.٥'),'۱۹٫۵');
  assert.equal(scoreValue('۱۹٫۵'),19.5);
  assert.equal(scoreValue(displayScore(0)),0);
  assert.deepEqual(Object.keys(attendanceLabels),['present','absent','late']);
});

test('class lists and print use the full stored surname, including compound surnames',()=>{
  const people=[
    {id:'a',full_name:'آرش کریمی',family_name:'کریمی',class_name:'دهم'},
    {id:'b',full_name:'یاسین احمدی زاده',family_name:'احمدی زاده',class_name:'دهم'}
  ];
  assert.deepEqual([...people].sort(compareStudentNames).map(person=>person.id),['b','a']);
  const rows=reportRows(people,[]);
  assert.deepEqual(rows.map(row=>row.person.id),['b','a']);
  const printed=printLedger([...rows].reverse(),{start:'',end:''});
  assert.ok(printed.includes('یاسین احمدی زاده')&&printed.indexOf('یاسین احمدی زاده')<printed.indexOf('آرش کریمی'));
});

test('classroom notices follow saved attendance and students see only their coursework',async()=>{
  const id='demo-teaching', pupil='sample-0', other='sample-2', date=today();
  demo.selectDemoRole('teacher');
  const opened=await demo.teachingLedger(id,date);
  const rows=opened.rows.map(row=>({...row,attendance:row.id===pupil?'absent':row.id===other?'late':null,
    score:row.id===pupil?19.25:0,note:'internal notes'}));
  let revision=await demo.saveTeachingLedger(id,date,0,'نمونه',rows);
  revision=await demo.saveTeachingLedger(id,date,revision,'نمونه',rows);
  await demo.sendClassroomMessage(id,pupil,date,'سلام','teacher-request');
  await assert.rejects(demo.sendClassroomMessage(id,'sample-1',date,'سلام','outside-class'),/KH2_FORBIDDEN/);
  demo.selectDemoRole('student');
  const coursework=await demo.studentCoursework();
  assert.deepEqual(coursework.entries.map(row=>[row.attendance,row.score]),[['absent',19.25]]);
  assert.ok(!Object.hasOwn(coursework.entries[0],'note'));
  assert.deepEqual((await demo.inbox()).items.map(row=>row.kind).sort(),['lesson_absence','teacher_message']);
  await demo.sendClassroomMessage(id,pupil,date,'پیام پاسخ','student-request');
  await demo.sendClassroomMessage(id,pupil,date,'پیام پاسخ','student-request');
  await assert.rejects(demo.sendClassroomMessage(id,other,date,'پیام جعلی','another-request'),/KH2_FORBIDDEN/);
  demo.selectDemoRole('teacher');
  assert.deepEqual((await demo.inbox()).items.map(row=>row.kind),['student_message']);
  rows.find(row=>row.id===pupil).attendance='present';
  await demo.saveTeachingLedger(id,date,revision,'اصلاح‌شده',rows);
  demo.selectDemoRole('student');
  assert.deepEqual((await demo.inbox()).items.map(row=>row.kind),['teacher_message']);
});
