import { digits,shift,today } from './domain.js?v=delay-management';

const now=today();
const seededStudents=[
  ['امیرعلی محمدی','دهم تجربی','0010000001'],['محمدرضا حسینی','یازدهم ریاضی','0010000002'],
  ['پارسا رضایی','دهم تجربی','0010000003'],['علی‌اصغر احمدی','دوازدهم انسانی','0010000004'],
  ['آرین موسوی','یازدهم ریاضی','0010000005'],['سینا کریمی','دهم تجربی','0010000006'],
  ['عرفان رحیمی','دوازدهم انسانی','0010000007'],['امیرحسین نوری','یازدهم ریاضی','0010000008'],
  ['مهدی صادقی','دوازدهم انسانی','0010000009'],['محمدطاها امینی','دهم تجربی','0010000010'],
  ['رضا جعفری','یازدهم ریاضی','0010000011'],['یاسین اکبری','دوازدهم انسانی','0010000012']
].map(([full_name,class_name,username],index)=>({id:'sample-'+index,full_name,class_name,username,role:'student',created_at:now}));
const admin={id:'manager',full_name:'مدیر دبیرستان',username:'demo_admin',role:'admin',created_at:now};
const teacher={id:'demo-teacher',full_name:'دبیر آزمایشی',username:'demo_teacher',role:'teacher'};
const deputy={id:'demo-deputy',full_name:'معاون آزمایشی',username:'demo_deputy',role:'deputy'};
const gate=seededStudents[7];
gate.gate_assigned_at=now;
const counts=[3,2,4,1,3,0,2,4,1,2];
const initial={
  students:seededStudents,
  delays:counts.flatMap((count,offset)=>Array.from({length:count},(_,j)=>({
    id:'delay-'+offset+'-'+j,student_id:seededStudents[(j+offset+(offset===2?10:0))%seededStudents.length].id,
    date_on:shift(now,-offset),recorder_id:gate.id,recorder_name:gate.full_name,note:'',status:'active'
  }))),
  appeals:[
    {id:'appeal-1',delay_id:'delay-0-0',student_id:'sample-0',recorder_id:'gate',date_on:now,status:'pending',reason:'سرویس مدرسه امروز با تأخیر رسید. لطفاً زمان ورود را بررسی کنید.',created_at:now},
    {id:'appeal-2',delay_id:'delay-1-0',student_id:'sample-1',recorder_id:'gate',date_on:shift(now,-1),status:'approved',reason:'زمان ورود من در دفتر نگهبانی ثبت شده است.',response:'زمان ثبت‌شده در دفتر بررسی شد.',created_at:now}
  ],
  grades:seededStudents.flatMap(person=>['ریاضی','ادبیات فارسی','زبان انگلیسی'].map((subject,index)=>({student_id:person.id,subject,term:'نوبت اول',score:17.5+index}))),
  records:{'sample-0':{given_name:'امیرعلی',family_name:'محمدی',birth_date:'1389/06/15',grade:'دهم',track:'علوم تجربی',enrollment:'فعال'}},
  changes:[],
  classMoves:[],
  followupSettings:{period:'month',threshold:3},
  inboxItems:[],
  educators:[{...teacher,personnel_code:'100001',evaluator:true,password_pending:false},{...deputy,deputy:true,password_pending:true}],
  assignments:[{id:'demo-teaching',staff_id:teacher.id,class_name:'دهم تجربی',subject:'ریاضی'}],
  passwords:{},
  managedPasswords:{},
  ledgers:{}
};
let database=structuredClone(initial);
let actor=admin;
const photos={};
const canRecord=()=>actor.role==='admin'||Boolean(actor.gate_assigned_at);

function excuseText(reason){
  if(reason==null) return null;
  const text=reason.trim();
  if(!text||[...text].length>400) throw new Error('KH2_INVALID_EXCUSE_REASON');
  return text;
}

export function selectDemoRole(role){
  const sampleRep=database.students.find(person=>person.id===gate.id);
  actor={admin,gate:sampleRep,student:database.students[0],teacher,deputy}[role]??admin;
}
export function overview(){
  return Promise.resolve({
    me:{...actor},
    students:database.students.filter(p=>canRecord()||p.id===actor.id).map(p=>({...p,username:actor.gate_assigned_at&&p.id!==actor.id?undefined:p.username})),
    staff:actor.role==='admin'?database.students.filter(p=>p.gate_assigned_at):[],
    delays:database.delays.filter(d=>canRecord()||d.student_id===actor.id)
      .map(d=>({...d,excused:Boolean(d.excuse_reason),
        excuse_reason:actor.role==='admin'||d.recorder_id===actor.id||d.student_id===actor.id?d.excuse_reason:undefined,
        status:d.cancelled_at?'cancelled':database.appeals.find(a=>a.delay_id===d.id)?.status??'active',
        has_history:actor.role==='admin'&&database.changes.some(item=>item.original_id===d.id||item.replacement_id===d.id)}))
      .sort((a,b)=>b.date_on.localeCompare(a.date_on)),
    appeals:database.appeals.filter(a=>actor.role==='admin'||a.student_id===actor.id||Boolean(actor.gate_assigned_at&&a.recorder_id===actor.id))
      .map(a=>({...a,delay_cancelled:Boolean(database.delays.find(d=>d.id===a.delay_id)?.cancelled_at)}))
  });
}
export async function educators(){
  if(!['admin','teacher','deputy'].includes(actor.role)) throw new Error('KH2_FORBIDDEN');
  const all=actor.role==='admin';
  return {
    staff:database.educators.filter(person=>all||person.id===actor.id).map(person=>({...person})),
    assignments:database.assignments.filter(row=>all||row.staff_id===actor.id),
    classes:all?[...new Set(database.students.map(person=>person.class_name))]:[]
  };
}
export async function staffPassword(id){
  if(actor.role!=='admin') throw new Error('KH2_FORBIDDEN');
  return {password:database.managedPasswords[id]??null};
}
export async function setStaffPassword(id,password){
  if(actor.role!=='admin') throw new Error('KH2_FORBIDDEN');
  const person=database.educators.find(item=>item.id===id);
  if(!person) throw new Error('KH2_STAFF_MISSING');
  const size=new TextEncoder().encode(password).length;
  if(size<8||size>72) throw new Error('KH2_INVALID_STAFF_PASSWORD');
  if(/^\d{10}$/.test(person.username)&&/^\d{10}$/.test(digits(password))) password=digits(password);
  database.passwords[person.username]=password;
  database.managedPasswords[id]=password;
  person.password_pending=false;
}
export async function importStaffDetails(rows){
  if(actor.role!=='admin') throw new Error('KH2_FORBIDDEN');
  const people=Object.keys(rows).map(username=>database.educators.find(person=>person.username===username));
  if(people.some(person=>!person)) throw new Error('KH2_STAFF_IMPORT_UNKNOWN');
  for(const person of people) person.details={...person.details,...rows[person.username]};
  return people.length;
}
export async function teacherAssignment(id,className,subject,remove=null){
  if(actor.role!=='admin') throw new Error('KH2_FORBIDDEN');
  if(remove){
    const assignment=database.assignments.find(row=>row.id===remove&&row.staff_id===id);
    if(assignment) assignment.archived_at??=now;
    return;
  }
  subject=subject.trim();
  if(!database.educators.some(person=>person.id===id)) throw new Error('KH2_STAFF_MISSING');
  if(!database.students.some(person=>person.class_name===className)) throw new Error('KH2_INVALID_CLASS');
  if(!subject||[...subject].length>100) throw new Error('KH2_INVALID_SUBJECT');
  const assignment=database.assignments.find(row=>row.staff_id===id&&row.class_name===className&&row.subject===subject);
  if(assignment) assignment.archived_at=null;
  else database.assignments.push({id:crypto.randomUUID(),staff_id:id,class_name:className,subject});
}
export async function teachingLedger(id,date){
  const assignment=database.assignments.find(row=>row.id===id&&row.staff_id===actor.id);
  if(!assignment) throw new Error('KH2_FORBIDDEN');
  if(date<'1900-01-01'||date>today()) throw new Error('KH2_INVALID_DATE');
  const saved=database.ledgers[id+':'+date];
  const entries=new Map((saved?.rows??[]).map(row=>[row.id,row]));
  const rows=database.students.flatMap(person=>{
    const previous=database.classMoves.find(move=>move.student_id===person.id&&move.effective_on>date)?.previous_class;
    const entry=entries.get(person.id);
    if(entry) return [{...entry,full_name:person.full_name}];
    if(assignment.archived_at||(previous??person.class_name)!==assignment.class_name) return [];
    return [{id:person.id,full_name:person.full_name,attendance:null,score:null,note:''}];
  });
  return {rows,topic:saved?.topic??'',revision:saved?.revision??0,archived:Boolean(assignment.archived_at)};
}
export async function saveTeachingLedger(id,date,revision,topic,rows){
  const current=await teachingLedger(id,date);
  if(current.archived) throw new Error('KH2_ARCHIVED_ASSIGNMENT');
  if(current.revision!==revision) throw new Error('KH2_LEDGER_CHANGED');
  const allowed=new Set(current.rows.map(row=>row.id));
  if(rows.some(row=>!allowed.has(row.id))) throw new Error('KH2_INVALID_LEDGER');
  database.ledgers[id+':'+date]={revision:revision+1,topic,rows:rows.filter(row=>row.attendance||row.score!==null||row.note)};
  return revision+1;
}
export async function gradesFor(id){
  if(actor.role!=='admin') throw new Error('KH2_FORBIDDEN');
  return database.grades.filter(g=>g.student_id===id);
}
export async function studentRecord(id){
  if(actor.role!=='admin'&&!actor.gate_assigned_at) throw new Error('KH2_FORBIDDEN');
  const person=database.students.find(p=>p.id===id);
  if(!person) throw new Error('KH2_STUDENT_MISSING');
  const details=database.records[id]??{};
  if(actor.role==='admin') return {class_name:person.class_name,national_id:person.username,details:{...details}};
  const {grade,track,enrollment}=details;
  return {class_name:person.class_name,details:{grade,track,enrollment}};
}
export async function setBirthDate(id,date){
  if(actor.role!=='admin') throw new Error('KH2_FORBIDDEN');
  if(!database.students.some(p=>p.id===id)) throw new Error('KH2_STUDENT_MISSING');
  if(!/^(13|14)\d{2}\/(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])$/.test(date)||
    (date.slice(5,7)>'06'&&date.endsWith('/31'))) throw new Error('KH2_INVALID_BIRTH_DATE');
  database.records[id]={...database.records[id],birth_date:date};
}
export const photoLinks=paths=>Promise.resolve(Object.fromEntries(paths.filter(p=>photos[p]).map(p=>[p,photos[p]])));
export async function putPhoto(id,file){
  if(actor.role!=='admin') throw new Error('KH2_FORBIDDEN');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||!file.size||file.size>3145728) throw new Error('KH2_INVALID_PHOTO');
  const person=database.students.find(p=>p.id===id);
  if(person.photo_path) URL.revokeObjectURL(photos[person.photo_path]);
  person.photo_path=id;
  photos[id]=URL.createObjectURL(file);
}
export async function changePassword(username,previous,password){
  const expected=database.passwords[username]??(actor.role==='student'?actor.username:'demopass123');
  if(previous!==expected) throw new Error('invalid_credentials');
  if(previous===password) throw new Error('same_password');
  database.passwords[username]=password;
  delete database.managedPasswords[actor.id];
}
export async function act(action,data){
  if(['import_students','import_grades','add_gate'].includes(action)&&actor.role!=='admin') throw new Error('KH2_FORBIDDEN');
  if(['register_delay','review_appeal'].includes(action)&&!canRecord()) throw new Error('KH2_FORBIDDEN');
  if(action==='send_appeal'&&actor.role!=='student') throw new Error('KH2_FORBIDDEN');
  if(action==='import_students'||action==='import_grades'){
    const result={added:0,skipped:0,errors:[]};
    if(!data.length || data.length>300) throw new Error('KH2_INVALID_LIST');
    for(const [index,row] of data.entries()){
      const student=database.students.find(p=>p.username===row.username);
      let error='';
      if(action==='import_students'){
        if(student) {result.skipped++;continue;}
        if(!/^\d{10}$/.test(row.username)||!row.full_name||!row.class_name) error='KH2_INVALID_STUDENT';
        else database.students.push({...row,id:crypto.randomUUID(),role:'student',created_at:now});
      }else if(!student) error='KH2_STUDENT_MISSING';
      else if(!row.subject||!row.term||row.score===''||!Number.isFinite(Number(row.score))||Number(row.score)<0||Number(row.score)>20) error='KH2_INVALID_GRADE';
      else{
        const key=g=>g.student_id===student.id&&g.subject===row.subject&&g.term===row.term;
        database.grades=database.grades.filter(g=>!key(g));
        database.grades.push({student_id:student.id,subject:row.subject,term:row.term,score:Number(row.score)});
      }
      if(error) result.errors.push({row:index+1,username:row.username,error});
      else result.added++;
    }
    return result;
  }
  if(action==='add_gate'){
    if(!/^\d{10}$/.test(data.username)) throw new Error('KH2_INVALID_NATIONAL_ID');
    const person=database.students.find(p=>p.username===data.username);
    if(!person) throw new Error('KH2_STUDENT_MISSING');
    if(person.gate_assigned_at) throw new Error('KH2_GATE_ALREADY_ASSIGNED');
    person.gate_assigned_at=today();
    return {id:person.id};
  }
  if(action==='register_delay'){
    const result=await registerDelays([data.student_id],[data.date_on],data.note);
    if(!result.added) throw new Error('KH2_DUPLICATE_DELAY');
  }
  if(action==='send_appeal'){
    if(data.reason.trim().length<5) throw new Error('KH2_INVALID_REASON');
    if(database.appeals.some(a=>a.delay_id===data.delay_id)) throw new Error('KH2_DUPLICATE_APPEAL');
    const delay=database.delays.find(d=>d.id===data.delay_id&&d.student_id===actor.id&&!d.cancelled_at);
    if(!delay) throw new Error('KH2_FORBIDDEN');
    database.appeals.unshift({...data,id:crypto.randomUUID(),student_id:actor.id,recorder_id:delay.recorder_id,date_on:delay.date_on,status:'pending',created_at:now});
    const recorder=database.students.find(person=>person.id===delay.recorder_id&&person.gate_assigned_at);
    addNotification(recorder?.id??admin.id,delay,'appeal_added');
  }
  if(action==='review_appeal'){
    if(data.response.trim().length<2) throw new Error('KH2_INVALID_RESPONSE');
    const appeal=database.appeals.find(a=>a.id===data.appeal_id&&a.status==='pending'&&!database.delays.find(d=>d.id===a.delay_id)?.cancelled_at&&(actor.role==='admin'||(a.recorder_id===actor.id&&a.student_id!==actor.id)));
    if(!appeal) throw new Error('KH2_APPEAL_UNAVAILABLE');
    Object.assign(appeal,{status:data.status,response:data.response,reviewed_at:now});
    const delay=database.delays.find(record=>record.id===appeal.delay_id);
    addNotification(delay.student_id,delay,data.status==='approved'?'appeal_approved':'appeal_rejected');
  }
  return {ok:true};
}


export async function registerDelays(studentIds,days,note='',reason=null){
  if(!canRecord()) throw new Error('KH2_FORBIDDEN');
  const excuse_reason=excuseText(reason);
  const people=[...new Set(studentIds)], dates=[...new Set(days)];
  if(!people.length||!dates.length||(people.length>1&&dates.length>1)) throw new Error('KH2_INVALID_DELAY_BATCH');
  if(dates.some(day=>!day||day<'1900-01-01'||day>today())) throw new Error('KH2_INVALID_DATE');
  if(note.trim().length>400) throw new Error('KH2_INVALID_DELAY_NOTE');
  if(people.includes(actor.id)) throw new Error('KH2_OWN_DELAY');
  if(people.some(id=>!database.students.some(p=>p.id===id))) throw new Error('KH2_STUDENT_MISSING');
  const result={added:0,skipped:0};
  for(const student_id of people){
    for(const date_on of dates){
      if(database.delays.some(d=>d.student_id===student_id&&d.date_on===date_on&&!d.cancelled_at)){
        result.skipped++;
        continue;
      }
      database.delays.unshift({student_id,date_on,note:note.trim(),excuse_reason,id:crypto.randomUUID(),recorder_name:actor.full_name,recorder_id:actor.id,status:'active'});
      addNotification(student_id,database.delays[0],'delay_added');
      result.added++;
    }
  }
  return result;
}


export async function updateDelay(id,action,reason,studentId,date,excuseReason){
  if(!canRecord()) throw new Error('KH2_FORBIDDEN');
  if(!['correct','cancel'].includes(action)) throw new Error('KH2_INVALID_ACTION');
  const trimmed=reason.trim();
  if(trimmed.length<3||trimmed.length>400) throw new Error('KH2_INVALID_CHANGE_REASON');
  const original=database.delays.find(d=>d.id===id&&!d.cancelled_at);
  if(!original) throw new Error('KH2_DELAY_UNAVAILABLE');
  if(actor.role!=='admin'&&(original.recorder_id!==actor.id||original.student_id===actor.id)) throw new Error('KH2_FORBIDDEN');
  const snapshot=(p,date_on,excuse_reason)=>({student_id:p.id,full_name:p.full_name,class_name:p.class_name,date_on,excuse_reason});
  const before=snapshot(database.students.find(p=>p.id===original.student_id),original.date_on,original.excuse_reason??null);
  const now=new Date().toISOString();
  let after=null, replacement=null;
  if(action==='correct'){
    if(!date||date<'1900-01-01'||date>today()) throw new Error('KH2_INVALID_DATE');
    if(studentId===actor.id) throw new Error('KH2_OWN_DELAY');
    const person=database.students.find(p=>p.id===studentId);
    if(!person) throw new Error('KH2_STUDENT_MISSING');
    const sameStudent=studentId===original.student_id;
    const excuse=excuseReason===undefined?(sameStudent?before.excuse_reason:null):excuseText(excuseReason);
    if(sameStudent&&date===original.date_on){
      if(excuse===before.excuse_reason) throw new Error('KH2_UNCHANGED_DELAY');
      original.excuse_reason=excuse;
      action='excuse';
    }else{
      const result=await registerDelays([studentId],[date],sameStudent?original.note:'',excuse);
      if(!result.added) throw new Error('KH2_DUPLICATE_DELAY');
      replacement=database.delays[0];
    }
    after=snapshot(person,date,excuse);
  }
  if(action!=='excuse') original.cancelled_at=now;
  database.changes.unshift({original_id:id,replacement_id:replacement?.id,action,before_entry:before,after_entry:after,
    reason:trimmed,changed_by_name:actor.full_name,changed_at:now});
  return {ok:true,replacement_id:replacement?.id};
}

export async function delayHistory(id){
  if(actor.role!=='admin') throw new Error('KH2_FORBIDDEN');
  return database.changes.filter(item=>item.original_id===id||item.replacement_id===id);
}

export async function revokeGate(id,assignedDate){
  if(actor.role!=='admin') throw new Error('KH2_FORBIDDEN');
  const person=database.students.find(p=>p.id===id&&p.gate_assigned_at&&p.gate_assigned_at===assignedDate);
  if(!person) throw new Error('KH2_GATE_NOT_ASSIGNED');
  person.gate_assigned_at=null;
  return {ok:true};
}

function addNotification(recipientId,delay,kind){
  database.inboxItems.unshift({id:crypto.randomUUID(),kind,delay_id:delay.id,date_on:delay.date_on,created_at:new Date().toISOString(),recipientId});
}
export async function requestParent(studentId,id){
  if(!canRecord()||studentId===actor.id) throw new Error('KH2_FORBIDDEN');
  if(!database.students.some(person=>person.id===studentId)) throw new Error('KH2_STUDENT_MISSING');
  const existing=database.inboxItems.find(item=>item.id===id);
  if(existing){
    if(existing.kind!=='parent_requested'||existing.recipientId!==studentId||existing.requestedBy!==actor.id){
      throw new Error('KH2_PARENT_REQUEST_CONFLICT');
    }
    return;
  }
  database.inboxItems.unshift({id,kind:'parent_requested',delay_id:null,date_on:today(),
    created_at:new Date().toISOString(),recipientId:studentId,requestedBy:actor.id});
}

export async function inbox(markRead=false,id=null){
  const items=database.inboxItems.filter(item=>item.recipientId===actor.id&&(
    item.kind!=='appeal_added'||actor.role==='admin'||actor.gate_assigned_at));
  if(markRead||id){
    for(const item of items) if(!item.read_at&&(markRead||item.id===id)) item.read_at=new Date().toISOString();
  }
  return {unread:items.filter(item=>!item.read_at).length,items:items.slice(0,50)};
}

export async function followup(){
  return {
    overview:await overview(),
    settings:actor.role==='admin'?database.followupSettings:null,
    class_moves:database.classMoves.filter(move=>actor.role==='admin'||actor.gate_assigned_at||move.student_id===actor.id)
  };
}

export async function saveFollowup(period,threshold){
  if(actor.role!=='admin') throw new Error('KH2_FORBIDDEN');
  if(!['week','month'].includes(period)||!Number.isInteger(threshold)||threshold<1||threshold>31) throw new Error('KH2_INVALID_FOLLOWUP');
  database.followupSettings={period,threshold};
}

export async function moveStudent(id,className,date,expectedClass){
  if(actor.role!=='admin') throw new Error('KH2_FORBIDDEN');
  const person=database.students.find(p=>p.id===id);
  if(!person) throw new Error('KH2_STUDENT_MISSING');
  const next=className.trim();
  if(!next||next.length>80) throw new Error('KH2_INVALID_CLASS');
  if(!date||date<'1900-01-01'||date>today()) throw new Error('KH2_INVALID_DATE');
  if(person.class_name!==expectedClass) throw new Error('KH2_CLASS_CHANGED');
  if(person.class_name===next) throw new Error('KH2_UNCHANGED_CLASS');
  if(database.classMoves.some(move=>move.student_id===id&&move.effective_on>=date)) throw new Error('KH2_CLASS_MOVE_ORDER');
  database.classMoves.push({student_id:id,effective_on:date,previous_class:person.class_name,new_class:next});
  person.class_name=next;
}
