import { shift,today } from './domain.js';

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
const gate={id:'gate',full_name:'مهدی هاشمی',username:'demo_gate',role:'gate',created_at:now};
const counts=[3,2,4,1,3,0,2,4,1,2];
const initial={
  students:seededStudents,staff:[gate],
  delays:counts.flatMap((count,offset)=>Array.from({length:count},(_,j)=>({
    id:'delay-'+offset+'-'+j,student_id:seededStudents[(j+offset+(offset===2?10:0))%seededStudents.length].id,
    date_on:shift(now,-offset),recorder_id:gate.id,recorder_name:gate.full_name,note:'',status:'active'
  }))),
  appeals:[
    {id:'appeal-1',delay_id:'delay-0-0',student_id:'sample-0',recorder_id:'gate',date_on:now,status:'pending',reason:'سرویس مدرسه امروز با تأخیر رسید. لطفاً زمان ورود را بررسی کنید.',created_at:now},
    {id:'appeal-2',delay_id:'delay-1-0',student_id:'sample-1',recorder_id:'gate',date_on:shift(now,-1),status:'approved',reason:'زمان ورود من در دفتر نگهبانی ثبت شده است.',response:'زمان ثبت‌شده در دفتر بررسی شد.',created_at:now}
  ],
  grades:seededStudents.flatMap(person=>['ریاضی','ادبیات فارسی','زبان انگلیسی'].map((subject,index)=>({student_id:person.id,subject,term:'نوبت اول',score:17.5+index}))),
  passwords:{}
};
let database=structuredClone(initial);
let actor=admin;
const photos={};

export function selectDemoRole(role){
  actor={admin,gate,student:database.students[0]}[role]??admin;
}
export function overview(){
  const own=actor.role==='student';
  return Promise.resolve({
    me:{...actor},
    students:database.students.filter(p=>!own||p.id===actor.id).map(p=>({...p,username:actor.role==='gate'?undefined:p.username})),
    staff:actor.role==='admin'?database.staff:[],
    delays:database.delays.filter(d=>!own||d.student_id===actor.id)
      .map(d=>({...d,status:database.appeals.find(a=>a.delay_id===d.id)?.status??'active'}))
      .sort((a,b)=>b.date_on.localeCompare(a.date_on)),
    appeals:database.appeals.filter(a=>actor.role==='admin'||(own?a.student_id===actor.id:a.recorder_id===actor.id))
  });
}
export async function gradesFor(id){
  if(actor.role!=='admin') throw new Error('KH2_FORBIDDEN');
  return database.grades.filter(g=>g.student_id===id);
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
  if(['register_delay','review_appeal'].includes(action)&&actor.role==='student') throw new Error('KH2_FORBIDDEN');
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
    if([...database.staff,...database.students].some(p=>p.username===data.username)) throw new Error('KH2_DUPLICATE_USERNAME');
    database.staff.push({...data,password:undefined,id:crypto.randomUUID(),role:'gate',created_at:now});
  }
  if(action==='register_delay'){
    if(!data.date_on||data.date_on>today()) throw new Error('KH2_INVALID_DATE');
    if(database.delays.some(d=>d.student_id===data.student_id&&d.date_on===data.date_on)) throw new Error('KH2_DUPLICATE_DELAY');
    database.delays.unshift({...data,id:crypto.randomUUID(),recorder_name:actor.full_name,recorder_id:actor.id,status:'active'});
  }
  if(action==='send_appeal'){
    if(data.reason.trim().length<5) throw new Error('KH2_INVALID_REASON');
    if(database.appeals.some(a=>a.delay_id===data.delay_id)) throw new Error('KH2_DUPLICATE_APPEAL');
    const delay=database.delays.find(d=>d.id===data.delay_id&&d.student_id===actor.id);
    if(!delay) throw new Error('KH2_FORBIDDEN');
    database.appeals.unshift({...data,id:crypto.randomUUID(),student_id:actor.id,recorder_id:delay.recorder_id,date_on:delay.date_on,status:'pending',created_at:now});
  }
  if(action==='review_appeal'){
    if(data.response.trim().length<2) throw new Error('KH2_INVALID_RESPONSE');
    const appeal=database.appeals.find(a=>a.id===data.appeal_id&&a.status==='pending'&&(actor.role==='admin'||a.recorder_id===actor.id));
    if(!appeal) throw new Error('KH2_APPEAL_UNAVAILABLE');
    Object.assign(appeal,{status:data.status,response:data.response,reviewed_at:now});
  }
  return {ok:true};
}
