import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { digits } from './domain.js?v=delay-management';

const sessionKey='kh2-session-v1';
let session;
let refreshRequest;
try {session=JSON.parse(sessionStorage.getItem(sessionKey));} catch {session=null;}

export class ApiError extends Error {
  constructor(message,status,code) {
    super(message);
    this.status=status;
    this.code=code;
  }
}

function setSession(value) {
  session=value?.access_token?value:null;
  try {
    if(session) sessionStorage.setItem(sessionKey, JSON.stringify(session));
    else sessionStorage.removeItem(sessionKey);
  } catch { /* Keep the current session in memory when storage is unavailable. */ }
}

async function request(path,{method='GET',body,token,headers={}}={}) {
  if(!SUPABASE_URL || !SUPABASE_KEY) throw new ApiError('KH2_NO_CONFIG',503);
  const isFile=body instanceof Blob;
  let response;
  try {
    response=await fetch(SUPABASE_URL+path,{
      method, headers:{apikey:SUPABASE_KEY,...(token?{Authorization:'Bearer '+token}:{}),
        ...(body&&!isFile?{'Content-Type':'application/json'}:{}),...headers},
      body:isFile?body:body===undefined?undefined:JSON.stringify(body)
    });
  } catch {throw new ApiError('KH2_NETWORK',0);}
  const raw=await response.text();
  let data;
  try {data=raw?JSON.parse(raw):null;} catch {data=null;}
  if(!response.ok) throw new ApiError(data?.message??data?.msg??data?.error_description??'KH2_SERVICE',response.status,data?.error_code??data?.code);
  return data;
}

function loginData(username,password) {
  const name=digits(username).trim().toLowerCase();
  return {email:name+'@kh2.portal.invalid',password:/^[0-9]{10}$/.test(name)&&/^\d{10}$/.test(digits(password))?digits(password):password};
}
export async function signIn(username,password) {
  const data=await request('/auth/v1/token?grant_type=password',{method:'POST',body:loginData(username,password)});
  setSession(data);
}
export function hasSession() {return Boolean(session);}
async function getToken() {
  const previous=session;
  if(!previous) throw new ApiError('KH2_EXPIRED',401);
  if((previous.expires_at??0)>Date.now()/1000+40) return previous.access_token;
  if(!refreshRequest){
    refreshRequest=request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:previous.refresh_token}})
      .then(data=>{if(session===previous) setSession(data);return session?.access_token;})
      .catch(error=>{if(session===previous && [400,401,403].includes(error.status)) setSession(null);throw error;})
      .finally(()=>{refreshRequest=null;});
  }
  const token=await refreshRequest;
  if(!token) throw new ApiError('KH2_EXPIRED',401);
  return token;
}
async function memberRequest(path,options={}) {
  const token=await getToken();
  return request(path,{...options,token});
}
export async function signOut() {
  const token=session?.access_token;
  setSession(null);
  if(token) await request('/auth/v1/logout?scope=local',{method:'POST',token}).catch(()=>{});
}
function rpc(name,body={}) {
  return memberRequest('/rest/v1/rpc/kh2_'+name,{method:'POST',body});
}
export const overview=()=>rpc('overview');
export const followup=()=>rpc('followup');
export const inbox=(markRead=false,item=null)=>rpc('inbox',{p_mark_read:markRead,p_item:item});
export const saveFollowup=(period,threshold)=>rpc('save_followup',{p_period:period,p_threshold:threshold});
export const moveStudent=(id,className,date,expectedClass)=>
  rpc('move_student',{p_student:id,p_class:className,p_effective:date,p_expected_class:expectedClass});
export const gradesFor=(student)=>rpc('grades_for',{p_student:student});
export const studentRecord=id=>rpc('student_record',{p_student:id});
export const educators=()=>rpc('staff_directory');
export const issueStaffPassword=(staff,password)=>rpc('issue_staff_password',{p_staff:staff,p_password:password});
export const teacherAssignment=(staff,className,subject,remove=null)=>
  rpc('set_teacher_assignment',{p_staff:staff,p_class:className,p_subject:subject,p_remove:remove});
export const setBirthDate=(id,date)=>rpc('set_birth_date',{p_student:id,p_birth_date:date});
export const act=(action,data)=>rpc('act',{p_action:action,p_data:data});
export const updateDelay=(id,action,reason,student=null,date=null,excuseReason=null)=>
  rpc('update_delay',{p_delay:id,p_action:action,p_reason:reason,p_student:student,p_date:date,p_excuse_reason:excuseReason});
export const requestParent=(student,id)=>rpc('request_parent',{p_student:student,p_request_id:id});
export const delayHistory=id=>rpc('delay_history',{p_delay:id});
export const revokeGate=(id,assignedDate)=>rpc('revoke_gate',{p_person:id,p_assigned_at:assignedDate??null});
export function registerDelays(studentIds,days,note,excuseReason=null) {
  return rpc('register_delays',{p_student_ids:studentIds,p_dates:days,p_note:note,p_excuse_reason:excuseReason});
}

export async function changePassword(username,previous,password) {
  const old=await request('/auth/v1/token?grant_type=password',{method:'POST',body:loginData(username,previous)});
  try {
    await request('/auth/v1/user',{method:'PUT',body:{password:loginData(username,password).password},token:old.access_token});
  } finally {
    await request('/auth/v1/logout?scope=local',{method:'POST',token:old.access_token}).catch(()=>{});
  }
  await signIn(username,password);
}
export async function putPhoto(id,file) {
  const type={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
  if(!type || file.size>3145728 || !file.size) throw new ApiError('KH2_INVALID_PHOTO',400);
  const path=id+'/'+crypto.randomUUID()+'.'+type;
  await memberRequest('/storage/v1/object/kh2-student-photos/'+path,{method:'POST',body:file,headers:{'Content-Type':file.type}});
  await act('set_photo',{student_id:id,path});
}
export async function photoLinks(paths) {
  if(!paths.length) return {};
  const token=await getToken();
  const output={};
  for(let start=0;start<paths.length;start+=50){
    const result=await request('/storage/v1/object/sign/kh2-student-photos',{
      method:'POST',token,body:{paths:paths.slice(start,start+50),expiresIn:360}
    });
    const data=Array.isArray(result)?result:result?.data??[];
    for(const {path,signedURL,signedUrl} of data){
      const url=signedURL??signedUrl;
      if(path && typeof url==='string' && url.startsWith('/object/sign/')) output[path]=SUPABASE_URL+'/storage/v1'+url;
    }
  }
  return output;
}

const messages={
  KH2_NETWORK:'ارتباط با سرور برقرار نشد. دوباره تلاش کنید.',
  KH2_NO_CONFIG:'اتصال سامانه به پایگاه داده هنوز تنظیم نشده است.',
  KH2_FORBIDDEN:'این حساب به این بخش دسترسی ندارد.',
  KH2_EXPIRED:'نشست شما پایان یافته است. دوباره وارد شوید.',
  KH2_INVALID_FOLLOWUP:'بازهٔ هفته یا ماه و تعداد ۱ تا ۳۱ را وارد کنید.',
  KH2_INVALID_CLASS:'نام کلاس باید بین ۱ تا ۸۰ نویسه باشد.',
  KH2_STAFF_MISSING:'حساب این همکار پیدا نشد.',
  KH2_PASSWORD_ALREADY_ISSUED:'رمز اولیهٔ این حساب قبلاً صادر شده است.',
  KH2_INVALID_SUBJECT:'نام درس را وارد کنید. حداکثر ۱۰۰ نویسه.',
  KH2_UNCHANGED_CLASS:'کلاس مقصد با کلاس فعلی یکسان است.',
  KH2_CLASS_CHANGED:'کلاس دانش‌آموز تغییر کرده است. پرونده را دوباره باز کنید.',
  KH2_CLASS_MOVE_ORDER:'تاریخ جابه‌جایی باید بعد از آخرین انتقال ثبت‌شده باشد.',
  KH2_INVALID_CHANGE_REASON:'دلیل تغییر باید ۳ تا ۴۰۰ نویسه باشد.',
  KH2_UNCHANGED_DELAY:'تاریخ، دانش‌آموز یا وضعیت موجه بودن را تغییر دهید.',
  KH2_INVALID_EXCUSE_REASON:'علت موجه بودن را در حداکثر ۴۰۰ نویسه وارد کنید.',
  KH2_PARENT_REQUEST_CONFLICT:'شناسهٔ درخواست تکراری است. دوباره پنجره را باز کنید.',
  KH2_DELAY_UNAVAILABLE:'این تأخیر قبلاً لغو شده یا پیدا نشد.',
  KH2_GATE_NOT_ASSIGNED:'این دسترسی قبلاً تغییر کرده است. فهرست نمایندگان را تازه کنید.',
  KH2_XLSX_UNAVAILABLE:'بارگیری ابزار خروجی اکسل انجام نشد. دوباره تلاش کنید.',
  KH2_INVALID_DELAY_BATCH:'یک دانش‌آموز و یک یا چند تاریخ، یا یک تاریخ و یک یا چند دانش‌آموز انتخاب کنید.',
  KH2_INVALID_DELAY_NOTE:'یادداشت تأخیر حداکثر ۴۰۰ نویسه می‌تواند داشته باشد.',
  KH2_DUPLICATE_DELAY:'برای این دانش‌آموز در این تاریخ قبلاً تأخیر ثبت شده است.',
  KH2_INVALID_DATE:'یک تاریخ معتبر تا امروز انتخاب کنید.',
  KH2_INVALID_BIRTH_DATE:'تاریخ تولد شمسی را به شکل ۱۳۸۹/۰۶/۱۵ وارد کنید.',
  KH2_DUPLICATE_APPEAL:'برای این تأخیر قبلاً اعتراض ثبت شده است.',
  KH2_APPEAL_UNAVAILABLE:'این اعتراض قابل بررسی نیست یا قبلاً بررسی شده است.',
  KH2_INVALID_RESPONSE:'پاسخ باید بین ۲ تا ۸۰۰ نویسه باشد.',
  KH2_INVALID_REASON:'دلیل اعتراض باید بین ۵ تا ۸۰۰ نویسه باشد.',
  KH2_INVALID_NATIONAL_ID:'کد ملی دانش‌آموز باید ده‌رقمی باشد.',
  KH2_GATE_ALREADY_ASSIGNED:'این دانش‌آموز قبلاً نماینده شده است.',
  KH2_OWN_DELAY:'ثبت تأخیر برای حساب خودتان مجاز نیست.',
  KH2_INVALID_ACCOUNT:'نام، نام کاربری یا رمز عبور معتبر نیست.',
  KH2_DUPLICATE_USERNAME:'این نام کاربری قبلاً ثبت شده است.',
  KH2_INVALID_LIST:'فهرست باید بین ۱ تا ۳۰۰ ردیف داشته باشد.',
  KH2_STUDENT_MISSING:'دانش‌آموز پیدا نشد.',
  KH2_INVALID_STUDENT:'نام، کلاس یا کد ملی ده‌رقمی معتبر نیست.',
  KH2_INVALID_GRADE:'نام درس، نوبت یا نمرهٔ ۰ تا ۲۰ درست وارد نشده است.',
  KH2_INVALID_PHOTO:'عکس باید JPEG، PNG یا WebP و حداکثر ۳ مگابایت باشد.',
  invalid_credentials:'نام کاربری یا رمز عبور درست نیست.',
  same_password:'رمز عبور جدید باید با رمز فعلی فرق داشته باشد.',
  weak_password:'برای رمز عبور جدید مقدار قوی‌تری وارد کنید.',
  over_request_rate_limit:'تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید.',
  '23505':'این نام کاربری قبلاً ثبت شده است.'
};
export function errorMessage(error) {
  return messages[error.message]??messages[error.code]??(error.status===429?messages.over_request_rate_limit:'انجام درخواست ممکن نشد. لطفاً دوباره تلاش کنید.');
}
