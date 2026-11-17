import { shift,today } from './domain.js?v=delay-management';

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
  passwords:{}
};
let database=structuredClone(initial);
let actor=admin;
const photos={};

export function selectDemoRole(role){
  const sampleRep=database.students.find(person=>person.id===gate.id);
  actor={admin,gate:sampleRep,student:database.students[0]}[role]??admin;
}
export function overview(){
  const own=actor.role==='student'&&!actor.gate_assigned_at;
  return Promise.resolve({
    me:{...actor},
    students:database.students.filter(p=>!own||p.id===actor.id).map(p=>({...p,username:actor.gate_assigned_at&&p.id!==actor.id?undefined:p.username})),
    staff:actor.role==='admin'?database.students.filter(p=>p.gate_assigned_at):[],
    delays:database.delays.filter(d=>!own||d.student_id===actor.id)
      .map(d=>({...d,status:d.cancelled_at?'cancelled':database.appeals.find(a=>a.delay_id===d.id)?.status??'active',
        has_history:actor.role==='admin'&&database.changes.some(item=>item.original_id===d.id||item.replacement_id===d.id)}))
      .sort((a,b)=>b.date_on.localeCompare(a.date_on)),
    appeals:database.appeals.filter(a=>actor.role==='admin'||a.student_id===actor.id||Boolean(actor.gate_assigned_at&&a.recorder_id===actor.id))
      .map(a=>({...a,delay_cancelled:Boolean(database.delays.find(d=>d.id===a.delay_id)?.cancelled_at)}))
  });
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
}
export async function act(action,data){
  if(['import_students','import_grades','add_gate'].includes(action)&&actor.role!=='admin') throw new Error('KH2_FORBIDDEN');
  if(['register_delay','review_appeal'].includes(action)&&actor.role==='student'&&!actor.gate_assigned_at) throw new Error('KH2_FORBIDDEN');
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


export async function registerDelays(studentIds,days,note=''){
  if(actor.role==='student'&&!actor.gate_assigned_at) throw new Error('KH2_FORBIDDEN');
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
      database.delays.unshift({student_id,date_on,note:note.trim(),id:crypto.randomUUID(),recorder_name:actor.full_name,recorder_id:actor.id,status:'active'});
      addNotification(student_id,database.delays[0],'delay_added');
      result.added++;
    }
  }
  return result;
}


export async function updateDelay(id,action,reason,studentId,date){
  if(actor.role!=='admin') throw new Error('KH2_FORBIDDEN');
  const trimmed=reason.trim();
  if(trimmed.length<3||trimmed.length>400) throw new Error('KH2_INVALID_CHANGE_REASON');
  const original=database.delays.find(d=>d.id===id&&!d.cancelled_at);
  if(!original) throw new Error('KH2_DELAY_UNAVAILABLE');
  const snapshot=(p,date_on)=>({student_id:p.id,full_name:p.full_name,class_name:p.class_name,date_on});
  const before=snapshot(database.students.find(p=>p.id===original.student_id),original.date_on);
  const now=new Date().toISOString();
  let after=null, replacement=null;
  if(action==='correct'){
    if(!date||date<'1900-01-01'||date>today()) throw new Error('KH2_INVALID_DATE');
    const person=database.students.find(p=>p.id===studentId);
    if(!person) throw new Error('KH2_STUDENT_MISSING');
    if(studentId===original.student_id&&date===original.date_on) throw new Error('KH2_UNCHANGED_DELAY');
    const result=await registerDelays([studentId],[date],studentId===original.student_id?original.note:'');
    if(!result.added) throw new Error('KH2_DUPLICATE_DELAY');
    replacement=database.delays[0];
    after=snapshot(person,date);
  }else if(action!=='cancel') throw new Error('KH2_INVALID_ACTION');
  original.cancelled_at=now;
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
