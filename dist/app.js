import * as live from './api.js?v=classroom-notices';
import * as demo from './demo.js?v=classroom-notices';
import { icon } from './icons.js?v=school-portal';
import {downloadReport,indexClassMoves,loadSheetJS,printLedger,reportDate,reportPeriod,reportRows as buildReportRows,studentClassOn} from './report.js?v=classroom-notices';
import {followupRows,isClassroomNotification,matchesInClass,notificationTitles,parentRequestMessage} from './followup.js?v=classroom-notices';
import { active,calendarDays,classYear,compareStudentNames,dayParts,digits,escape as e,fa,importRows,localizeGradeList,matches,monthStart,school,shift,showDate,today } from './domain.js?v=classroom-notices';
import {attendanceLabels,displayScore,scoreValue,workbookStaffDetails} from './staff.js?v=classroom-notices';

const app=document.querySelector('#app');
const dialog=document.querySelector('#modal');
const toast=document.querySelector('#toast');
const roleNames={admin:'مدیر سامانه',gate:'نمایندهٔ درب مدرسه',student:'دانش‌آموز',teacher:'دبیر',deputy:'معاون'};
const statusNames={active:'تأخیر ثبت‌شده',pending:'در انتظار بررسی',approved:'اعتراض پذیرفته شد',rejected:'اعتراض رد شد',cancelled:'لغوشده'};
const pageNames={dashboard:'پیشخوان',students:'دانش‌آموزان',records:'پرونده اطلاعاتی دانش‌آموز',delays:'ثبت و سوابق تأخیر',appeals:'اعتراض‌ها',myDelays:'تأخیرهای من',myAppeals:'اعتراض‌های من',reports:'گزارش و چاپ',staff:'نمایندگان درب مدرسه',followup:'پیگیری تأخیرها',parentRequests:notificationTitles.parent_requested,inbox:'اعلان‌ها',manage:'ثبت گروهی',profile:'پروفایل من',educators:'دبیران و معاونان',teaching:'کلاس‌ها و درس‌های من',ledger:'دفتر دیجیتالی'};
const pageIcons={dashboard:'home',students:'users',records:'file',delays:'clock',appeals:'message',myDelays:'clock',myAppeals:'message',reports:'report',staff:'shield',followup:'clock',parentRequests:'users',inbox:'bell',manage:'upload',profile:'user',educators:'users',teaching:'cap',ledger:'file'};
pageNames.coursework='نمرات و حضور من';
pageIcons.coursework='cap';
const state={mode:'login',page:'dashboard',data:null,photos:{},query:'',className:'',filterDate:'',reportRange:reportPeriod('all'),reportExcuse:'all',pageIndex:0,menu:false,modal:null,appealFilter:'all',loadId:0,ledger:null};
let toastTimer;
let refreshTimer;
let focusAfterModal;
let inboxSequence=0;
const limit=8;
const delayModes={dates:'یک دانش‌آموز، چند تاریخ',students:'یک تاریخ، چند دانش‌آموز'};
const reportExcuses={all:'همهٔ تأخیرها',excused:'تأخیرهای موجه',unexcused:'تأخیرهای غیرموجه'};
const logo=new URL('./assets/favicon.svg?v=school-portal',import.meta.url).href;
const dashboardArt=new URL('./assets/school-still-life.webp',import.meta.url).href;
const mobileLayout=window.matchMedia('(max-width: 900px)');
const backend=()=>state.mode==='demo'?demo:live;
const me=()=>state.data.me;
const isAdmin=()=>me().role==='admin';
const isStudent=()=>me().role==='student';
const isEducator=()=>['teacher','deputy'].includes(me().role);
const isStudentGate=()=>isStudent()&&Boolean(me().gate_assigned_at);
const canRecord=()=>isAdmin()||(me().role==='gate'&&!me().gate_revoked_at)||isStudentGate();
const canManageDelay=row=>!row.cancelled_at&&(isAdmin()||
  (canRecord()&&row.recorder_id===me().id&&row.student_id!==me().id));
const roleLabel=()=>isStudentGate()?'دانش‌آموز و نمایندهٔ درب مدرسه':me().gate_revoked_at?'نمایندهٔ سابق درب مدرسه':roleNames[me().role];
const ownsAppeal=appeal=>appeal.student_id===me().id;
const allStudents=()=>state.data.students;
const student=id=>allStudents().find(p=>p.id===id);
const rowsFor=id=>state.data.delays.filter(row=>row.student_id===id);
function allowed(){
  if(isEducator()) return ['teaching','ledger','inbox','profile'];
  if(!canRecord()) return isStudent()?['dashboard','coursework','myDelays','myAppeals','inbox','profile']:['inbox','profile'];
  const pages=['dashboard','students','records','delays','appeals','reports','parentRequests'];
  if(isAdmin()) pages.push('followup','staff','educators','manage');
  if(isAdmin()&&state.data.educators?.assignments?.some(row=>row.staff_id===me().id)) pages.push('ledger');
  if(isStudentGate()) pages.push('coursework','myDelays','myAppeals');
  return [...pages,'inbox','profile'];
}
const hasValue=(actual,wanted)=>actual===wanted?' selected':'';

function button(label,i,attributes='',kind=''){
  return '<button type="button" class="btn '+kind+'" '+attributes+'>'+ (i?icon(i):'')+(label?e(label):'')+'</button>';
}
function submit(label,i){
  return '<button type="submit" class="btn primary">'+(i?icon(i):'')+e(label)+'</button>';
}
function tile(i,color=''){
  return '<span class="icon-tile '+color+'">'+icon(i)+'</span>';
}
function badge(label,kind=''){
  return '<span class="badge '+kind+'"><span class="dot"></span>'+e(label)+'</span>';
}
function showStatus(key){
  return badge(statusNames[key]??statusNames.active,key);
}
function avatar(person,large=false) {
  const path=person?.photo_path;
  const src=state.photos[path];
  const letters=person?.full_name?.split(/\s+/).filter(Boolean).slice(0,2).map(s=>s[0]).join('');
  return '<span class="avatar'+(large?' big':'')+'"'+(path?' data-photo="'+e(path)+'"':'')+'>'+(src?'<img src="'+e(src)+'" alt="">':letters?e(letters):icon('user'))+'</span>';
}
function branding(){
  return '<div class="brand"><img src="'+logo+'" alt="" width="44" height="44"><div><strong>'+school+'</strong><small>سامانهٔ دانش‌آموزی</small></div></div>';
}
function notify(message,kind=''){
  clearTimeout(toastTimer);
  toast.className=kind;
  toast.textContent=message;
  toastTimer=setTimeout(()=>{toast.textContent='';},4400);
}
function resetFilters(){
  Object.assign(state,{query:'',className:'',filterDate:'',reportRange:reportPeriod('all'),reportExcuse:'all',pageIndex:0,appealFilter:'all',menu:false});
}
async function fetchData(){
  const id=++state.loadId;
  const api=backend();
  const [{overview,...followup},inbox]=await Promise.all([api.followup(),api.inbox()]);
  if(id!==state.loadId) return false;
  const needsDirectory=['admin','teacher','deputy'].includes(overview.me.role);
  const [educators,coursework]=await Promise.all([
    needsDirectory?api.educators().catch(error=>({error:friendly(error)})):null,
    overview.me.role==='student'?api.studentCoursework().catch(error=>({error:friendly(error)})):null
  ]);
  if(id!==state.loadId) return false;
  state.data={...overview,students:[...overview.students].sort(compareStudentNames),followup,inbox,educators,coursework,classHistory:indexClassMoves(followup.class_moves)};
  if(!allowed().includes(state.page)) state.page=allowed()[0];
  return true;
}
async function fetchPhotos(){
  if(!state.data) return;
  const id=state.loadId;
  const paths=[...new Set([...allStudents().map(x=>x.photo_path),me().photo_path].filter(Boolean))];
  try{
    const photos=await backend().photoLinks(paths);
    if(id!==state.loadId) return;
    state.photos=photos;
    for(const element of document.querySelectorAll('[data-photo]')){
      const src=photos[element.dataset.photo];
      if(src){
        const img=document.createElement('img');img.src=src;img.alt='';element.replaceChildren(img);
      }
    }
  }catch(error){if(id===state.loadId && paths.length) notify(live.errorMessage(error),'error');}
  clearTimeout(refreshTimer);
  if(paths.length && state.mode==='live') refreshTimer=setTimeout(fetchPhotos,300000);
}
async function reload(){
  if(await fetchData()){render();void fetchPhotos();}
}
function login(error=''){
  app.innerHTML=`<div class="login-page">
    <main class="login-main" id="main-content" tabindex="-1">
      ${branding()}
      <section class="login-card" aria-labelledby="login-title">
        <div class="login-heading">
          <h1 id="login-title">ورود به سامانه</h1>
          <p>نام کاربری و رمز عبور خود را وارد کنید.</p>
        </div>
        <form id="login-form">
          <label class="field">نام کاربری
            <span class="login-input">${icon('user')}<input name="username" dir="ltr" autocomplete="username" required maxlength="48"></span>
          </label>
          <label class="field">رمز عبور
            <span class="login-input">${icon('key')}<input name="password" dir="ltr" type="password" autocomplete="current-password" required maxlength="72"></span>
          </label>
          <div data-form-message${error?' class="notice error" role="alert"':' hidden'}>${e(error)}</div>
          <button type="submit" class="btn primary">ورود به سامانه${icon('left')}</button>
        </form>
        <button type="button" class="login-demo" data-action="demo">
          <span class="login-demo-icon">${icon('home')}</span>
          <span><strong>مشاهدهٔ نسخهٔ آزمایشی</strong><small>گشت‌وگذار در سامانه با داده‌های نمونه</small></span>
          ${icon('left')}
        </button>
      </section>
      <p class="login-help">برای دریافت اطلاعات ورود، با دفتر مدرسه تماس بگیرید.</p>
    </main>
    <aside class="login-visual" aria-labelledby="login-visual-title">
      <div class="login-visual-copy">
        <h2 id="login-visual-title">مدیریت حضور<br>و سوابق آموزشی</h2>
        <p>ثبت و پیگیری تأخیرها، نمرات و پروندهٔ دانش‌آموزان</p>
      </div>
    </aside>
  </div>`;
}
function doneLoading(error=''){
  app.innerHTML='<main class="login-main" id="main-content"><section class="login-card">'+branding()+'<div class="notice'+(error?' error':'')+'" role="status">'+e(error||'در حال دریافت اطلاعات…')+'</div>'+(error?'<div class="form-actions">'+button('تلاش دوباره','refresh','data-action="retry"','primary')+button('بازگشت به ورود','logout','data-action="logout"')+'</div>':'')+'</section></main>';
}
function nav(key){
  const count=['appeals','myAppeals'].includes(key)?appealsFor(key==='myAppeals').filter(a=>a.status==='pending'&&!a.delay_cancelled).length:0;
  return '<button type="button" class="nav-item'+(state.page===key?' active':'')+'" data-page="'+key+'"'+(state.page===key?' aria-current="page"':'')+'>'+icon(pageIcons[key])+e(pageNames[key])+(key==='inbox'?'<span class="nav-count" id="inbox-unread"'+(state.data.inbox.unread?'':' hidden')+'>'+fa(state.data.inbox.unread)+'</span>':
    count?'<span class="nav-count">'+fa(count)+'</span>':'')+'</button>';
}
function navigation(){
  const pages=allowed();
  const groups=[
    ['امور دانش‌آموزان',['dashboard','students','records','delays','appeals','parentRequests','myDelays','myAppeals']],
    ['آموزش و مدیریت',['teaching','ledger','coursework','reports','followup','educators','staff','manage']],
    ['حساب کاربری',['inbox','profile']]
  ];
  return '<nav aria-label="بخش‌های سامانه">'+groups.map(([title,keys])=>{
    const items=keys.filter(key=>pages.includes(key));
    return items.length?'<div class="nav-group"><p class="nav-label">'+title+'</p>'+items.map(nav).join('')+'</div>':'';
  }).join('')+'</nav>';
}
function inboxLabel(count){
  return count?'اعلان‌ها، '+fa(count)+' پیام خوانده‌نشده':'اعلان‌ها';
}
function render(){
  if(!state.data){login();return;}
  const pageLabel=pageNames[state.page];
  const demoBadge=state.mode==='demo'?'<span class="badge demo-badge"><span class="dot"></span>نسخهٔ آزمایشی</span>':'';
  const switcher=state.mode==='demo'?'<div class="nav-group"><p class="nav-label">تغییر نقش آزمایشی</p><select id="demo-role" aria-label="نقش آزمایشی">'+Object.entries(roleNames).map(([id,title])=>'<option value="'+id+'"'+hasValue(isStudentGate()?'gate':me().role,id)+'>'+e(title)+'</option>').join('')+'</select></div>':'';
  const inert=state.menu?' inert':'';
  const menuToggle='data-action="menu" aria-label="باز کردن منو" aria-controls="sidebar" aria-expanded="'+state.menu+'"';
  const unread=state.data.inbox.unread;
  const inboxShortcut='<button type="button" class="btn icon inbox-shortcut" data-page="inbox" aria-label="'+e(inboxLabel(unread))+'"'+(state.page==='inbox'?' aria-current="page"':'')+'>'+icon('bell')+'<span class="unread-dot"'+(unread?'':' hidden')+'></span></button>';
  const logout='<button class="nav-item" type="button" data-action="logout">'+icon('logout')+'خروج از حساب</button>';
  app.innerHTML='<div class="layout'+(state.menu?' menu-open':'')+'">'+
    '<button id="screen-mask" type="button" data-action="menu" tabindex="-1" aria-label="بستن منو"></button>'+
    '<aside id="sidebar" class="sidebar'+(state.menu?' open':'')+'" aria-label="منوی سامانه">'+branding()+
      button('','close','data-action="menu" aria-label="بستن منو"','icon sidebar-close')+navigation()+switcher+
      '<div class="sidebar-bottom"><div class="school-term">'+tile('calendar')+'<div><strong>سال تحصیلی</strong><small>'+classYear()+'</small></div></div>'+logout+'</div></aside>'+
    '<header class="topbar"'+inert+'><div class="crumb">'+button('','menu',menuToggle,'icon mobile-toggle')+
      '<span class="crumb-role muted">'+e(roleLabel())+'</span>'+icon('left')+'<span class="crumb-page">'+e(pageLabel)+'</span></div>'+
      '<div class="top-actions">'+demoBadge+'<span class="top-date">'+icon('calendar')+e(showDate(today(),'long'))+'</span>'+inboxShortcut+
      '<span class="top-divider"></span><details class="identity"><summary aria-label="منوی حساب کاربری">'+avatar(me())+
      '<span class="identity-label"><strong>'+e(me().full_name)+'</strong><small>'+e(roleLabel())+'</small></span>'+icon('down')+
      '</summary><div class="account-menu">'+nav('profile')+logout+'</div></details></div></header>'+
    '<main class="main" id="main-content" tabindex="-1"'+inert+'>'+({
    dashboard,students,records:recordsPage,delays:()=>delays(false),appeals:()=>appeals(false),myDelays:()=>delays(true),myAppeals:()=>appeals(true),reports,staff,followup:followupPage,parentRequests:parentRequestsPage,inbox:inboxPage,manage,profile,educators:educatorsPage,teaching:myTeachingPage,ledger:ledgerPage,coursework:courseworkPage
  }[state.page]())+'</main></div>';
}
function headline(title,description='',actions=''){
  return '<div class="page-heading"><div><h1>'+e(title)+'</h1>'+(description?'<p>'+e(description)+'</p>':'')+'</div>'+(actions?'<div class="page-actions">'+actions+'</div>':'')+'</div>';
}
function empty(text,columns){
  const content='<div class="empty">'+icon('list')+e(text)+'</div>';
  return columns?'<tr><td colspan="'+columns+'">'+content+'</td></tr>':content;
}
function card(title,sub,content,control=''){
  return '<section class="card"><div class="card-head"><div><h2>'+e(title)+'</h2>'+(sub?'<p>'+e(sub)+'</p>':'')+'</div>'+control+'</div>'+content+'</section>';
}
function table(headers,body){
  return '<div class="table-wrap" tabindex="0" role="region" aria-label="جدول '+e(headers[0])+'"><table><thead><tr>'+headers.map(title=>'<th scope="col">'+e(title)+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>';
}
function studentCell(person,sub=''){
  return '<div class="student-cell">'+avatar(person)+'<div><strong>'+e(person?.full_name??'—')+'</strong>'+(sub?'<small>'+e(sub)+'</small>':'')+'</div></div>';
}
function classNames(includePrevious=false){
  const names=allStudents().map(p=>p.class_name);
  if(includePrevious) for(const moves of state.data.classHistory.values()) names.push(...moves.map(move=>move.previous_class));
  return [...new Set(names)].filter(Boolean).sort((a,b)=>a.localeCompare(b,'fa',{numeric:true}));
}
function peopleFilter(withDate=false){
  const classes=classNames(state.page==='reports'||state.page==='delays');
  return '<div class="filters"><label class="search">'+icon('search')+'<input type="search" id="search-people" aria-label="جست‌وجوی دانش‌آموز" placeholder="'+(isAdmin()?'جست‌وجوی نام، کد ملی یا کلاس':'جست‌وجوی نام یا کلاس')+'" value="'+e(state.query)+'"></label><select id="class-filter" aria-label="فیلتر کلاس"><option value="">همهٔ کلاس‌ها</option>'+classes.map(c=>'<option value="'+e(c)+'"'+hasValue(state.className,c)+'>'+e(c)+'</option>').join('')+'</select>'+(withDate?button(state.filterDate?showDate(state.filterDate):'همهٔ تاریخ‌ها','calendar','data-action="filter-date"')+(state.filterDate?button('','close','data-action="reset-date" aria-label="پاک کردن فیلتر تاریخ"','icon'):''):'')+'</div>';
}
function filteredStudents(){
  return allStudents().filter(p=>(!state.className||p.class_name===state.className)&&matches(p,state.query));
}
function selectedDelays(){
  const people=new Map(allStudents().map(person=>[person.id,person]));
  return state.data.delays.filter(delay=>{
    const person=people.get(delay.student_id);
    if(!person||(state.filterDate&&delay.date_on!==state.filterDate)) return false;
    const name=studentClassOn(person,delay.date_on,state.data.classHistory.get(person.id));
    return (!state.className||name===state.className)&&matchesInClass(person,state.query,name);
  }).sort((left,right)=>compareStudentNames(people.get(left.student_id),people.get(right.student_id)));
}
function paging(count){
  const pages=Math.max(1,Math.ceil(count/limit));
  state.pageIndex=Math.min(state.pageIndex,pages-1);
  const first=count?state.pageIndex*limit+1:0;
  const last=Math.min(count,(state.pageIndex+1)*limit);
  return '<div class="table-footer"><span>'+fa(first)+' تا '+fa(last)+' از '+fa(count)+' مورد</span><div class="paging">'+button('','right','data-action="prev" aria-label="صفحهٔ قبل"'+(!state.pageIndex?' disabled':''),'icon compact')+button('','left','data-action="next" aria-label="صفحهٔ بعد"'+(state.pageIndex>=pages-1?' disabled':''),'icon compact')+'</div></div>';
}
function paginated(list){
  const footer=paging(list.length);
  return [list.slice(state.pageIndex*limit,(state.pageIndex+1)*limit),footer];
}
function delayTable(records,withStudent=true,withAppeal=false,withManagement=false){
  const headers=[...(withStudent?['دانش‌آموز','کلاس']:[]),'تاریخ تأخیر','ثبت‌کننده','وضعیت',...(withAppeal||withManagement?['عملیات']:[])];
  return table(headers,records.map(row=>{
    const person=student(row.student_id);
    const id='data-id="'+e(row.id)+'"';
    const management=withManagement?[
      ...(canManageDelay(row)?[button('اصلاح','calendar','data-action="edit-delay" '+id,'compact'),button('لغو','close','data-action="cancel-delay" '+id,'compact')]:[]),
      ...(row.has_history?[button('سابقهٔ تغییر','report','data-action="delay-history" '+id,'compact ghost')]:[])
    ].join(''):'';
    const excuse=row.excused?badge('موجه','approved'):'';
    const detail=row.excuse_reason?'<small class="excuse-reason muted">علت موجه بودن '+e(row.excuse_reason)+'</small>':'';
    return '<tr>'+(withStudent?'<td>'+studentCell(person)+'</td><td>'+e(person?studentClassOn(person,row.date_on,state.data.classHistory.get(person.id)):'—')+'</td>':'')+'<td><span class="ltr">'+e(showDate(row.date_on))+'</span>'+(row.note?'<br><small class="muted">'+e(row.note)+'</small>':'')+'</td><td>'+e(row.recorder_name)+'</td><td><div class="delay-status">'+showStatus(row.status)+excuse+'</div>'+detail+'</td>'+(withAppeal?'<td>'+(row.status==='active'?button('ثبت اعتراض','message','data-action="new-appeal" data-id="'+e(row.id)+'"','compact soft'):'—')+'</td>':'')+(withManagement?'<td><div class="form-actions">'+(management||'—')+'</div></td>':'')+'</tr>';
  }).join('')||empty('سابقه‌ای برای نمایش وجود ندارد.',headers.length));
}
function dashboard(){
  const {delays,students:people}=state.data;
  const personal=!canRecord();
  const appeals=appealsFor(personal);
  const date=today(), month=monthStart(date), current=active(delays);
  const countToday=current.filter(d=>d.date_on===date).length;
  const countMonth=current.filter(d=>d.date_on>=month).length;
  const waiting=appeals.filter(a=>a.status==='pending'&&!a.delay_cancelled).length;
  const stats=personal?[
    ['همهٔ تأخیرها',current.length,'clock','peach','از ابتدای ثبت'],['تأخیرهای این ماه',countMonth,'calendar','blue',showDate(date,'month')],['اعتراض‌های باز',waiting,'message','mint','در انتظار بررسی'],['اعتراض‌های پذیرفته',appeals.filter(a=>a.status==='approved').length,'check','','از ابتدای ثبت']
  ]:[
    ['کل دانش‌آموزان',people.length,'users','','دانش‌آموزان ثبت‌شده'],['تأخیرهای امروز',countToday,'clock','peach','در روز جاری'],['تأخیرهای این ماه',countMonth,'calendar','blue',showDate(date,'month')],['اعتراض‌های باز',waiting,'message','mint','در انتظار بررسی']
  ];
  const actions=personal?button('ثبت اعتراض','message','data-action="new-appeal"','primary'):
    button('ثبت تأخیر جدید','plus','data-action="new-delay"','primary')+button('چاپ گزارش','print','data-action="print"');
  const quick=personal?[['clock','مشاهدهٔ تأخیرها','تاریخ و وضعیت هر تأخیر','data-page="myDelays"'],['message','ثبت اعتراض','انتخاب تاریخ از سوابق تأخیر','data-action="new-appeal"'],['user','پروفایل من','مشاهده اطلاعات و تغییر رمز','data-page="profile"']]:
    [['plusUser',isAdmin()?'ثبت گروهی دانش‌آموزان':'ثبت تأخیر دانش‌آموز',isAdmin()?'ورود فهرست دانش‌آموزان، عکس و نمرات':'انتخاب دانش‌آموز و تاریخ',isAdmin()?'data-page="manage"':'data-action="new-delay"'],['users','جست‌وجوی دانش‌آموز','جست‌وجو با نام یا کلاس','data-page="students"'],['print','گزارش و چاپ','فهرست دانش‌آموزان و تاریخ‌های تأخیر','data-page="reports"']];
  const intro=personal?'تأخیرهای خود را ببینید و وضعیت اعتراض‌ها را پیگیری کنید.':'وضعیت تأخیرها، اعتراض‌ها و پرونده‌های دانش‌آموزان را بررسی کنید.';
  const statHTML='<section class="stats" aria-label="خلاصهٔ وضعیت">'+stats.map(([name,value,i,color,note])=>'<article class="stat"><div class="stat-top">'+tile(i,color)+'<span>'+e(name)+'</span></div><strong>'+fa(value)+'</strong><small>'+e(note)+'</small></article>').join('')+'</section>';
  const quickHTML='<div class="quick-grid">'+quick.map(([i,title,sub,attrs],index)=>'<button type="button" class="quick-row" '+attrs+'>'+tile(i,['','blue','peach'][index])+'<span><strong>'+e(title)+'</strong><small>'+e(sub)+'</small></span>'+icon('left')+'</button>').join('')+'</div>';
  return headline('پیشخوان',personal?'خلاصهٔ وضعیت حضور و اعتراض‌های شما':'خلاصهٔ وضعیت حضور و تأخیر دانش‌آموزان',actions)+
    '<section class="hero"><img class="hero-art" src="'+dashboardArt+'" alt=""><div class="hero-copy"><span class="hero-tag">'+icon('cap')+school+'</span><h2>'+e(personal?'سلام، '+me().full_name:'به پیشخوان مدرسه خوش آمدید')+'</h2><p>'+intro+'</p></div></section>'+statHTML+
    '<div class="insights">'+card('روند تأخیرها','تعداد تأخیرهای ثبت‌شده در هر روز',chart(current),'<span class="chart-range">۷ روز اخیر</span>')+card('دسترسی سریع','',quickHTML)+'</div>'+
    (isAdmin()?'<div class="followup-preview">'+followupPreview()+'</div>':'')+
    '<div class="dashboard-recent'+(personal?'':' with-students')+'">'+
    card('آخرین تأخیرهای ثبت‌شده','',delayTable(delays.slice(0,5),!personal,false),button('مشاهدهٔ همه','left',personal?'data-page="myDelays"':'data-page="delays"','ghost compact'))+'</div>';
}
function chart(records){
  const date=today();
  const days=Array.from({length:7},(_,i)=>shift(date,-i));
  const counts=days.map(day=>records.filter(d=>d.date_on===day).length);
  const max=Math.max(4,Math.ceil(Math.max(...counts)/4)*4);
  const desc=days.map((day,index)=>showDate(day,'weekday')+' '+fa(counts[index])).join('، ');
  return '<div class="chart-area" role="img" aria-label="'+e(desc)+'"><div class="chart-y" aria-hidden="true">'+Array.from({length:5},(_,i)=>'<span>'+fa(max*(4-i)/4)+'</span>').join('')+'</div><div class="plot" aria-hidden="true">'+days.map((day,i)=>'<div class="bar'+(i===0?' today':'')+'" style="--height:'+100*counts[i]/max+'%" title="'+e(showDate(day,'long')+'، '+fa(counts[i])+' تأخیر')+'"></div>').join('')+'</div><div class="chart-x" aria-hidden="true">'+days.map(day=>'<span>'+e(showDate(day,'weekday'))+'</span>').join('')+'</div></div>';
}

function students(){
  return headline('دانش‌آموزان','جست‌وجو و مشاهدهٔ پروندهٔ دانش‌آموزان',button('چاپ فهرست','print','data-action="print"')+(isAdmin()?button('ثبت گروهی دانش‌آموزان','plusUser','data-page="manage"','primary'):''))+
    '<section class="card">'+peopleFilter()+'<div id="list-results">'+peopleResults()+'</div></section>';
}
function peopleResults(){
  const [people,footer]=paginated(filteredStudents());
  const headers=['دانش‌آموز','کلاس',...(isAdmin()?['کد ملی']:[]),'تعداد تأخیر','عملیات'];
  return table(headers,people.map(person=>{
    const id=e(person.id);
    return '<tr><td>'+studentCell(person)+'</td><td>'+e(person.class_name)+'</td>'+(isAdmin()?'<td><span class="ltr">'+fa(person.username)+'</span></td>':'')+'<td>'+badge(fa(active(rowsFor(person.id)).length)+' تأخیر')+'</td><td><div class="form-actions">'+button('مشاهدهٔ پرونده','left','data-action="person" data-id="'+id+'"','ghost compact')+(person.id!==me().id?button('ثبت تأخیر','plus','data-action="new-delay" data-id="'+id+'"','soft compact'):'')+'</div></td></tr>';
  }).join('')||empty('دانش‌آموزی با این مشخصات پیدا نشد.',headers.length))+footer;
}
function recordsPage(){
  return headline(pageNames.records,'یک دانش‌آموز را جست‌وجو کنید و پروندهٔ او را باز کنید.')+
    '<section class="card">'+peopleFilter()+'<div id="list-results">'+recordResults()+'</div></section>';
}
function recordResults(){
  const [people,footer]=paginated(filteredStudents());
  const headers=['دانش‌آموز','کلاس',...(isAdmin()?['کد ملی']:[]),'عملیات'];
  return table(headers,people.map(person=>'<tr><td>'+studentCell(person)+'</td><td>'+e(person.class_name)+'</td>'+
    (isAdmin()?'<td><span class="ltr">'+fa(person.username)+'</span></td>':'')+'<td>'+recordButton(person.id)+'</td></tr>').join('')||
    empty('دانش‌آموزی با این مشخصات پیدا نشد.',headers.length))+footer;
}
function recordButton(id){
  return button('مشاهدهٔ اطلاعات','file','data-action="student-record" data-id="'+e(id)+'"','compact');
}
function parentRequestsPage(){
  const search='<div class="filters"><label class="search">'+icon('search')+
    '<input type="search" id="search-people" aria-label="نام و نام خانوادگی دانش‌آموز" placeholder="جست‌وجوی نام و نام خانوادگی" value="'+e(state.query)+'"></label></div>';
  return headline(pageNames.parentRequests,'دانش‌آموز را پیدا کنید و درخواست مراجعهٔ ولی به مدرسه را برای او بفرستید.')+
    '<section class="card">'+search+'<div id="list-results">'+parentRequestResults()+'</div></section>';
}
function parentRequestResults(){
  if(!state.query.trim()) return empty('برای ثبت درخواست، نام دانش‌آموز را جست‌وجو کنید.');
  const headers=['دانش‌آموز','کلاس','عملیات'];
  const [people,footer]=paginated(allStudents().filter(person=>person.id!==me().id&&matches({full_name:person.full_name},state.query)));
  return table(headers,people.map(person=>'<tr><td>'+studentCell(person)+'</td><td>'+e(person.class_name)+'</td><td>'+
    button('درخواست حضور اولیا','message','data-action="request-parent" data-id="'+e(person.id)+'"','compact')+
    '</td></tr>').join('')||empty('دانش‌آموزی با این نام پیدا نشد.',headers.length))+footer;
}
function delays(own){
  const actions=own?button('ثبت اعتراض','message','data-action="new-appeal"','primary'):
    button('چاپ گزارش','print','data-action="print"')+button('ثبت تأخیر جدید','plus','data-action="new-delay"','primary');
  return headline(own?pageNames.myDelays:pageNames.delays,own?'تاریخ‌های ثبت‌شده و وضعیت اعتراض هر تأخیر':'تاریخ، ثبت‌کننده و وضعیت تأخیر دانش‌آموزان',actions)+
    '<section class="card">'+(!own?peopleFilter(true):'')+'<div id="list-results">'+delayResults(own)+'</div></section>';
}
function delayResults(own){
  const [records,footer]=paginated(own?rowsFor(me().id):selectedDelays());
  return delayTable(records,!own,own,!own&&canRecord())+footer;
}
function reportFilters(){
  const {start,end}=state.reportRange;
  const presets={week:'این هفته',month:'این ماه',all:'همهٔ تاریخ‌ها'};
  const isPreset=mode=>{
    const range=reportPeriod(mode);
    return range.start===start&&range.end===end;
  };
  return '<div class="filters report-filters"><div class="tabs" role="group" aria-label="بازه‌های آماده">'+Object.entries(presets).map(([mode,label])=>
    button(label,'','data-action="report-period" data-id="'+mode+'" aria-pressed="'+isPreset(mode)+'"','compact')).join('')+'</div><div class="form-actions" role="group" aria-label="بازهٔ دلخواه">'+
    button(start?'از '+showDate(start):'از تاریخ','calendar','data-action="report-date" data-id="start"','compact')+
    button(end?'تا '+showDate(end):'تا تاریخ','calendar','data-action="report-date" data-id="end"','compact')+'</div>'+
    '<select id="report-excuse" aria-label="نوع تأخیر">'+Object.entries(reportExcuses).map(([value,label])=>
      '<option value="'+value+'"'+hasValue(state.reportExcuse,value)+'>'+e(label)+'</option>').join('')+'</select></div>';
}
function reports(){
  const actions=(isAdmin()?button('خروجی اکسل','file','data-action="export-report"'):'')+
    button('چاپ فهرست','print','data-action="print"','primary');
  return headline(pageNames.reports,'گزارش تأخیر هر کلاس در بازهٔ انتخاب‌شده',actions)+
    '<section class="card">'+peopleFilter()+reportFilters()+'<div id="list-results">'+reportResults()+'</div></section>';
}
function currentReport(){
  const {start,end}=state.page==='reports'?state.reportRange:{start:state.filterDate,end:state.filterDate};
  const excuse=state.page==='reports'?state.reportExcuse:'all';
  const people=state.page==='students'?filteredStudents():allStudents();
  const rows=buildReportRows(people,state.data.delays,start,end,{classMoves:state.data.classHistory,excuse,
    include:(person,name)=>(!state.className||name===state.className)&&(state.page==='students'||matchesInClass(person,state.query,name))});

  const dateLabel=start&&start===end?showDate(start):[
    start?'از '+showDate(start):'',end?'تا '+showDate(end):''
  ].filter(Boolean).join(' ');
  const period=[dateLabel||'همهٔ تاریخ‌ها',excuse!=='all'?reportExcuses[excuse]:'',state.query?'جست‌وجو «'+state.query+'»':''].filter(Boolean).join(' · ');
  const reference=end||start||rows.flatMap(row=>row.dates.slice(-1)).sort().at(-1)||today();
  return {rows,period,year:classYear(reference)};
}
function reportTable(rows){
  const dateCount=Math.max(1,...rows.map(row=>row.dates.length));
  const headers=['دانش‌آموز','کلاس','موجه','غیرموجه','تعداد تأخیر',...Array.from({length:dateCount},(_,i)=>'تاریخ '+fa(i+1))];
  return table(headers,rows.map(({person,dates,excused})=>
    '<tr><td>'+studentCell(person)+'</td><td>'+e(person.class_name)+'</td><td>'+fa(excused)+'</td><td>'+fa(dates.length-excused)+'</td><td>'+fa(dates.length)+'</td>'+
      Array.from({length:dateCount},(_,i)=>'<td class="report-date">'+(dates[i]?'<span class="ltr">'+e(reportDate(dates[i]))+'</span>':'')+'</td>').join('')+'</tr>').join('')||
    empty('دانش‌آموزی برای نمایش وجود ندارد.',headers.length));
}
function reportResults(){
  const {rows}=currentReport();
  const [page,footer]=paginated(rows);
  const summary='<div class="report-summary">'+fa(new Set(rows.map(row=>row.person.id)).size)+' دانش‌آموز · '+fa(rows.reduce((sum,row)=>sum+row.dates.length,0))+' تأخیر در بازهٔ انتخاب‌شده</div>';
  return summary+reportTable(page)+footer;
}
async function printReport(){
  const {rows,period,year}=currentReport();
  if(!rows.length){notify('دانش‌آموزی برای چاپ پیدا نشد.','error');return;}
  document.querySelector('#print-area').innerHTML=printLedger(rows,period,year);
  if(document.fonts) await document.fonts.ready;
  window.print();
}
async function exportReport(){
  if(!isAdmin()) return;
  const {rows,period}=currentReport();
  if(!rows.length){notify('دانش‌آموزی برای خروجی پیدا نشد.','error');return;}
  await downloadReport(rows,period);
}
function appealsFor(own){
  return state.data.appeals.filter(appeal=>own?ownsAppeal(appeal):!ownsAppeal(appeal));
}
function appeals(own){
  const list=appealsFor(own).filter(a=>state.appealFilter==='all'||(a.delay_cancelled?'cancelled':a.status)===state.appealFilter);
  const filters='<div class="tabs" aria-label="وضعیت اعتراض">'+Object.entries({all:'همه',pending:'در انتظار بررسی',approved:'پذیرفته‌شده',rejected:'ردشده',cancelled:'لغوشده'}).map(([key,title])=>button(title,'','data-action="appeal-filter" data-id="'+key+'" aria-pressed="'+(state.appealFilter===key)+'"','compact')).join('')+'</div>';
  const cards=list.map(a=>{
    const name=own?'اعتراض به تأخیر':student(a.student_id)?.full_name??'—';
    return '<article class="card appeal-card"><div class="appeal-head"><div><h2>'+e(name)+'</h2><small>تاریخ تأخیر <span class="ltr">'+e(showDate(a.date_on))+'</span></small></div>'+showStatus(a.delay_cancelled?'cancelled':a.status)+'</div><p>'+e(a.reason)+'</p>'+
      (a.response?'<div class="appeal-response"><strong>پاسخ بررسی</strong><p>'+e(a.response)+'</p></div>':'')+
      (!own&&a.status==='pending'&&!a.delay_cancelled?'<div class="form-actions" style="margin-top:10px">'+button('بررسی اعتراض','check','data-action="review" data-id="'+e(a.id)+'"','soft')+'</div>':'')+'</article>';
  }).join('');
  return headline(own?pageNames.myAppeals:pageNames.appeals,own?'ثبت اعتراض روی یکی از تاریخ‌های تأخیر و مشاهدهٔ نتیجه':'مشاهدهٔ درخواست‌ها و ثبت نتیجهٔ بررسی',own?button('ثبت اعتراض','message','data-action="new-appeal"','primary'):'')+filters+'<div class="appeal-list">'+(cards||'<section class="card">'+empty('اعتراضی در این وضعیت وجود ندارد.')+'</section>')+'</div>';
}
function followupTable(rows){
  return table(['دانش‌آموز','کلاس فعلی','تعداد تأخیر','پرونده'],rows.map(({person,count})=>
    '<tr><td>'+studentCell(person)+'</td><td>'+e(person.class_name)+'</td><td>'+fa(count)+'</td><td>'+
    button('مشاهدهٔ پرونده','left','data-action="person" data-id="'+e(person.id)+'"','compact ghost')+'</td></tr>').join('')||
    empty('دانش‌آموزی به حد هشدار نرسیده است.',4));
}
function followupTitle(settings){
  return 'از '+fa(settings.threshold)+' تأخیر غیرموجه به بالا در '+(settings.period==='week'?'این هفته':'این ماه');
}
function followupPreview(){
  const settings=state.data.followup.settings;
  const rows=followupRows(allStudents(),state.data.delays,settings);
  return card('تأخیرهای پرتکرار',followupTitle(settings),followupTable(rows.slice(0,5)),
    button('فهرست پیگیری','left','data-page="followup"','ghost compact'));
}
function followupResults(){
  const [rows,footer]=paginated(followupRows(allStudents(),state.data.delays,state.data.followup.settings));
  return followupTable(rows)+footer;
}
function followupPage(){
  const controls=button('تنظیم هشدار','settings','data-action="followup-settings"','primary');
  return headline(pageNames.followup,followupTitle(state.data.followup.settings),controls)+
    card('فهرست پیگیری','','<div id="list-results">'+followupResults()+'</div>');
}
function inboxEntries(){
  const {items}=state.data.inbox;
  return items.map(item=>'<article class="card appeal-card inbox-item'+(item.read_at?'':' unread')+'"><div><h2>'+e(notificationTitles[item.kind])+'</h2>'+
    (isClassroomNotification(item.kind)?'<p>'+e([item.sender_name,item.subject,item.class_name].filter(Boolean).join(' · '))+'</p><p class="muted">تاریخ ':
      item.kind==='parent_requested'?'<p>'+e(parentRequestMessage)+'</p><p class="muted">تاریخ درخواست ':
      '<p class="muted">تاریخ تأخیر ')+'<span class="ltr">'+e(showDate(item.date_on))+'</span></p></div>'+
    '<div class="form-actions">'+(!item.read_at?badge('خوانده‌نشده','pending'):'')+
    button('مشاهده','left','data-action="open-notification" data-id="'+e(item.id)+'"','compact ghost')+'</div></article>').join('')||
    '<section class="card">'+empty('اعلانی وجود ندارد.')+'</section>';
}
function inboxPage(){
  return headline(pageNames.inbox,'اعلان‌های مربوط به حساب شما',
    button('تازه‌سازی','refresh','data-action="refresh-inbox"')+
    button('خواندن همه','check','data-action="mark-inbox" id="mark-inbox"'+(state.data.inbox.unread?'':' disabled')))+
    '<div id="inbox-entries" class="appeal-list">'+inboxEntries()+'</div>';
}
async function refreshInbox(markRead=false,item=null){
  if(!state.data) return;
  const load=state.loadId;
  const seq=++inboxSequence;
  const result=await backend().inbox(markRead,item);
  if(load!==state.loadId||seq!==inboxSequence||!state.data) return;
  const previous=state.data.inbox;
  if(previous.unread===result.unread&&previous.items.length===result.items.length&&
    previous.items.every((old,index)=>old.id===result.items[index].id&&old.read_at===result.items[index].read_at)) return;
  state.data.inbox=result;
  const counter=document.querySelector('#inbox-unread');
  if(counter){counter.hidden=!result.unread;counter.textContent=fa(result.unread);}
  const shortcut=document.querySelector('.inbox-shortcut');
  if(shortcut){
    shortcut.setAttribute('aria-label',inboxLabel(result.unread));
    shortcut.querySelector('.unread-dot').hidden=!result.unread;
  }
  const items=document.querySelector('#inbox-entries');
  if(items){
    const focus=document.activeElement?.dataset;
    items.innerHTML=inboxEntries();
    if(focus?.action==='open-notification') items.querySelector('[data-id="'+CSS.escape(focus.id)+'"]')?.focus();
  }
  const mark=document.querySelector('#mark-inbox');
  if(mark) mark.disabled=!result.unread;
}
function staff(){
  const rows=state.data.staff.map(person=>{
    const date=person.gate_assigned_at||person.created_at;
    return '<tr><td>'+studentCell(person)+'</td><td><span class="ltr">'+e(person.username)+'</span></td><td>'+e(person.class_name||'—')+'</td><td>'+e(showDate(date.slice(0,10)))+'</td><td>'+badge(person.role==='student'?'دانش‌آموز و نماینده':'نمایندهٔ درب مدرسه')+'</td><td>'+button('لغو دسترسی','close','data-action="revoke-gate" data-id="'+e(person.id)+'"','compact')+'</td></tr>';
  }).join('');
  return headline(pageNames.staff,'انتخاب نماینده از دانش‌آموزان ثبت‌شده',button('افزودن نماینده','plusUser','data-action="add-gate"','primary'))+
    card('فهرست نمایندگان','',table(['نام و نام خانوادگی','نام کاربری','کلاس','تاریخ ثبت','نقش','عملیات'],rows||empty('هنوز نماینده‌ای ثبت نشده است.',6)));
}
const educator=id=>state.data.educators?.staff?.find(person=>person.id===id);
const educatorAssignments=id=>(state.data.educators?.assignments??[]).filter(row=>row.staff_id===id);
function educatorsPage(){
  const directory=state.data.educators;
  const heading=headline(pageNames.educators,'',button('ورود اطلاعات از اکسل','upload','data-action="staff-import"'));
  if(directory.error) return heading+'<p class="notice error" role="alert">'+e(directory.error)+'</p>';
  const rows=directory.staff.map(person=>{
    const id=e(person.id);
    const role=person.role==='admin'&&person.deputy?'مدیر و معاون':roleNames[person.role];
    const password=person.role==='admin'?'—':button(person.password_pending?'تعیین رمز اولیه':'مدیریت رمز عبور','key','data-action="staff-password" data-id="'+id+'"','compact');
    return '<tr><td>'+studentCell(person)+'</td><td><bdi dir="ltr">'+e(person.username)+'</bdi></td><td>'+e(role)+'</td>'+
      '<td>'+button('پروندهٔ دبیر','user','data-action="staff-details" data-id="'+id+'"','compact')+'</td>'+
      '<td>'+button('تخصیص کلاس و درس','cap','data-action="teacher-assignment" data-id="'+id+'"','compact')+'</td><td>'+password+'</td></tr>';
  }).join('');
  return heading+card('فهرست دبیران و معاونان','',table(['نام و نام خانوادگی','نام کاربری','نقش','مشخصات','تدریس','رمز عبور'],rows||empty('هنوز حسابی در فهرست ثبت نشده است.',6)));
}
function assignmentTable(id,editable=false){
  const headers=['کلاس','درس'];
  if(editable) headers.push('عملیات');
  const rows=educatorAssignments(id).map(row=>'<tr><td>'+e(row.class_name)+'</td><td>'+e(row.subject)+'</td>'+
    (editable?'<td>'+(row.archived_at?badge('بایگانی‌شده'):button('حذف تخصیص','close','data-action="remove-teacher-assignment" data-id="'+e(row.id)+'"','compact'))+'</td>':'')+'</tr>').join('');
  return table(headers,rows||empty('هنوز کلاسی یا درسی تخصیص داده نشده است.',headers.length));
}
function myTeachingPage(){
  const error=state.data.educators?.error;
  return headline(pageNames.teaching,'',button(pageNames.ledger,'file','data-page="ledger"'))+
    (error?'<p class="notice error" role="alert">'+e(error)+'</p>':card('تخصیص‌های تدریس','',assignmentTable(me().id)));
}
function staffInformation(person){
  const info={'تاریخ تولد':null,...person.details,'کد ملی':person.national_id??person.details?.['کد ملی'],
    'کد پرسنلی':person.personnel_code??person.details?.['کد پرسنلی'],'معاون':person.deputy?'بله':'خیر','ارزیاب':person.evaluator?'بله':'خیر'};
  return table(['مشخصه','مقدار'],Object.entries(info).map(([label,value])=>'<tr><th scope="row">'+e(label)+'</th><td><bdi>'+e(value??'—')+'</bdi></td></tr>').join(''));
}
function ledgerPage(){
  const heading=headline(pageNames.ledger);
  const error=state.data.educators?.error;
  if(error) return heading+'<p class="notice error" role="alert">'+e(error)+'</p>';
  const assignments=educatorAssignments(me().id);
  if(!assignments.length) return heading+card('کلاس و درس','',empty('هنوز کلاسی و درسی به شما تخصیص داده نشده است.'));
  const selection=state.ledger;
  const date=selection?.date??today();
  const options=assignments.map(row=>'<option value="'+e(row.id)+'"'+hasValue(selection?.assignment,row.id)+'>'+
    e(row.class_name+' · '+row.subject+(row.archived_at?' (بایگانی‌شده)':''))+'</option>').join('');
  return heading+card('انتخاب دفتر','','<div class="filters"><label class="field">کلاس و درس<select id="ledger-assignment">'+
    '<option value="">کلاس و درس را انتخاب کنید</option>'+options+'</select></label>'+
    button(showDate(date,'long'),'calendar','data-action="ledger-date" aria-label="انتخاب تاریخ دفتر"')+
    (selection?.error?button('بارگیری دوباره','refresh','data-action="reload-ledger"'):'')+'</div>')+
    (selection?.loading?'<p class="notice" role="status">در حال دریافت دفتر…</p>':selection?.error?
      '<p class="notice error" role="alert">'+e(selection.error)+'</p>':selection?.result?ledgerEntries(selection.result):'');
}
function ledgerEntries(result){
  const disabled=result.archived?' disabled':'';
  const rows=result.rows.map(row=>{
    const id=e(row.id), name=e(row.full_name);
    const options=Object.entries(attendanceLabels).map(([value,label])=>'<option value="'+value+'"'+hasValue(row.attendance,value)+'>'+e(label)+'</option>').join('');
    return '<tr><th scope="row">'+name+'</th><td><select name="attendance-'+id+'" aria-label="حضور '+name+'"'+disabled+
      '><option value="">ثبت نشده</option>'+options+'</select></td><td><input type="text" dir="ltr" inputmode="decimal" size="5" maxlength="5" data-grade name="score-'+id+'" value="'+e(displayScore(row.score))+
      '" aria-label="نمرهٔ '+name+'"'+disabled+'></td><td><textarea rows="2" name="note-'+id+'" maxlength="300" aria-label="یادداشت '+name+'"'+disabled+'>'+e(row.note)+'</textarea></td>'+
      (result.archived?'':'<td>'+button('ارسال اعلان','message','data-action="teacher-notice" data-id="'+id+'" aria-label="ارسال اعلان به '+name+'"','compact')+'</td>')+'</tr>';
  }).join('');
  const headers=['نام دانش‌آموز','حضور و غیاب','نمره از ۲۰','یادداشت'];
  if(!result.archived) headers.push('اعلان');
  const bulk=!result.archived&&result.rows.length?'<div class="form-actions">'+
    button('ثبت حاضر برای همه','check','data-action="bulk-presence" data-id="all"','compact')+
    button('ثبت حاضر برای افرادی که غایب ثبت نشده است','check','data-action="bulk-presence" data-id="except-absent"','compact')+'</div>':'';
  return card('ثبت جلسه','',
    '<form data-form="ledger-save" class="stack"><label class="field">موضوع جلسه<textarea name="topic" rows="2" maxlength="500"'+disabled+'>'+e(result.topic)+'</textarea></label>'+
    bulk+table(headers,rows||empty('برای این تاریخ دانش‌آموزی در دفتر نمایش داده نمی‌شود.',headers.length))+
    '<div data-form-message hidden></div>'+(result.archived?'<p class="notice">این دفتر بایگانی شده و فقط خواندنی است.</p>':
      '<div class="form-actions">'+submit('ذخیرهٔ دفتر','check')+
      button('بارگیری دوباره','refresh','data-action="reload-ledger"')+'</div>')+'</form>');
}
function courseworkPage(){
  const data=state.data.coursework;
  const heading=headline(pageNames.coursework,'',
    (data?.teachers?.length?button('ارسال اعلان به دبیر','message','data-action="student-notice"','primary'):'')+
    button('تازه‌سازی','refresh','data-action="refresh-coursework"'));
  if(data?.error) return heading+'<p class="notice error" role="alert">'+e(data.error)+'</p>';
  const rows=(data?.entries??[]).map(row=>'<tr><td><bdi dir="ltr">'+e(showDate(row.date_on))+'</bdi></td><td>'+e(row.subject)+'</td><td>'+e(row.teacher_name)+
    '</td><td>'+e(row.class_name)+'</td><td>'+e(attendanceLabels[row.attendance]??'—')+'</td><td><bdi dir="ltr">'+e(row.score==null?'—':displayScore(row.score))+'</bdi></td></tr>').join('');
  return heading+card('سوابق دفتر دبیران','',table(['تاریخ','درس','دبیر','کلاس','حضور','نمره از ۲۰'],
    rows||empty('هنوز دبیران نمره یا وضعیت حضوری برای شما ثبت نکرده‌اند.',6)));
}
async function loadLedger(assignment,date){
  const current={assignment,date,result:null,error:'',loading:Boolean(assignment)};
  state.ledger=current;
  render();
  if(!assignment) return;
  try{
    const result=await backend().teachingLedger(assignment,date);
    current.result={...result,rows:[...result.rows].sort(compareStudentNames)};
  }
  catch(error){current.error=friendly(error);}
  current.loading=false;
  if(state.ledger===current&&state.page==='ledger') render();
}
function manage(){
  return headline('ثبت گروهی','ثبت دانش‌آموزان، عکس‌ها و نمرات از طریق فهرست')+
    '<div class="setting-grid">'+importCard('students','users','ثبت گروهی دانش‌آموزان','کد ملی، نام و نام خانوادگی و کلاس','کد ملی،نام و نام خانوادگی،کلاس\n۰۰۱۰۰۰۰۰۰۱،علی احمدی،دهم تجربی')+
    '<section class="card setting-card"><div class="setting-title">'+tile('image','blue')+'<div><h2>ثبت گروهی عکس‌ها</h2><p>نام هر فایل را برابر کد ملی ده‌رقمی دانش‌آموز قرار دهید.</p></div></div><form data-form="photos" class="stack"><label class="field">فایل‌های عکس<input type="file" name="files" accept="image/png,image/jpeg,image/webp" multiple required><small>JPEG، PNG یا WebP · حداکثر ۳ مگابایت برای هر فایل</small></label><div data-form-message hidden></div><div class="form-actions">'+submit('بارگذاری عکس‌ها','upload')+'</div></form></section>'+
    importCard('grades','file','ثبت گروهی نمرات','کد ملی، نام درس، نوبت و نمرهٔ ۰ تا ۲۰','کد ملی،درس،نوبت،نمره\n۰۰۱۰۰۰۰۰۰۱،ریاضی،نوبت اول،۱۸٫۵')+'</div>';
}
function importCard(kind,i,title,sub,example){
  return '<section class="card setting-card"><div class="setting-title">'+tile(i,kind==='grades'?'mint':'')+'<div><h2>'+title+'</h2><p>'+sub+'</p></div></div><form data-form="import" data-kind="'+kind+'" class="stack"><label class="field">فایل فهرست<input type="file" name="file" accept=".csv,.tsv,.txt,text/csv,text/plain"><small>فایل CSV، TSV یا متن با کدگذاری UTF-8 و حداکثر ۳۰۰ ردیف</small></label><label class="field">یا ورود مستقیم فهرست<textarea name="text" rows="4" '+(kind==='grades'?'data-grade-list ':'')+'placeholder="'+e(example)+'"></textarea></label><div data-form-message hidden></div><div class="form-actions">'+submit(kind==='students'?'ثبت دانش‌آموزان':'ثبت نمرات','upload')+'</div></form></section>';
}
function profile(){
  const person=educator(me().id);
  return headline(pageNames.profile,'اطلاعات حساب کاربری و تغییر رمز عبور')+'<div class="setting-grid"><section class="card setting-card"><div class="setting-title">'+avatar(me(),true)+'<div><h2>'+e(me().full_name)+'</h2><p>'+e(roleLabel())+'</p></div></div>'+table(['مشخصه','مقدار'],'<tr><td>نام کاربری</td><td><span class="ltr">'+e(me().username)+'</span></td></tr>'+(me().class_name?'<tr><td>کلاس</td><td>'+e(me().class_name)+'</td></tr>':''))+'</section><section class="card setting-card"><div class="setting-title">'+tile('key')+'<div><h2>تغییر رمز عبور</h2></div></div><form data-form="password" class="stack"><label class="field">رمز عبور فعلی<input type="password" name="old" dir="ltr" autocomplete="current-password" required maxlength="72"></label><label class="field">رمز عبور جدید<input type="password" name="new_password" dir="ltr" autocomplete="new-password" minlength="8" maxlength="72" required><small>حداقل ۸ نویسه</small></label><label class="field">تکرار رمز عبور جدید<input type="password" name="confirm" dir="ltr" autocomplete="new-password" required maxlength="72"></label><div data-form-message hidden></div><div class="form-actions">'+submit('ذخیرهٔ رمز عبور','key')+'</div></form></section></div>'+
    (person?card('مشخصات شغلی و فردی','',staffInformation(person)):'');
}
function updateList(){
  const result=document.querySelector('#list-results');
  const fn={students:peopleResults,records:recordResults,parentRequests:parentRequestResults,delays:()=>delayResults(false),myDelays:()=>delayResults(true),reports:reportResults,followup:followupResults}[state.page];
  if(result&&fn){result.innerHTML=fn();return;}
  render();
}
function setPage(page){
  if(!allowed().includes(page)) return;
  if(state.page!==page) resetFilters();
  state.page=page;state.menu=false;render();
  document.querySelector('#main-content')?.focus();
  window.scrollTo(0,0);
}

function openModal(type,data={}){
  const wasOpen=dialog.open;
  if(!wasOpen) focusAfterModal=document.activeElement;
  state.modal={type,...data};
  renderModal();
  if(wasOpen) dialog.querySelector('[data-action="close"]')?.focus();
  else dialog.showModal();
}
function closeModal(){
  if(dialog.open) dialog.close();
}
dialog.addEventListener('cancel',event=>{if(state.modal?.saving) event.preventDefault();});
dialog.addEventListener('close',()=>{
  state.modal=null;
  if(focusAfterModal?.isConnected) focusAfterModal.focus();
});
function modalFrame(title,body){
  return '<header class="modal-head"><h2 id="modal-title">'+e(title)+'</h2>'+button('','close','data-action="close" aria-label="بستن پنجره"','icon')+'</header><div class="modal-body">'+body+'</div>';
}
function calendar(visible,selected){
  const {blanks,days}=calendarDays(visible);
  const title=e(showDate(visible,'month'));
  return '<div class="calendar"><div class="calendar-head">'+button('','right','data-action="month-prev" aria-label="ماه قبل"','icon compact')+'<strong>'+title+'</strong>'+
    button('','left','data-action="month-next" aria-label="ماه بعد"'+(monthStart(visible)>=monthStart(today())?' disabled':''),'icon compact')+'</div><div class="calendar-grid">'+['ش','ی','د','س','چ','پ','ج'].map(c=>'<small aria-hidden="true">'+c+'</small>').join('')+'<span></span>'.repeat(blanks)+days.map(day=>'<button type="button" data-action="pick-day" data-id="'+day+'" aria-label="'+e(showDate(day,'long'))+'" aria-pressed="'+selected.has(day)+'"'+(day>today()?' disabled':'')+'>'+fa(dayParts(day).day)+'</button>').join('')+'</div></div>';
}
function delaySelection(){
  return state.modal.type==='editDelay'?state.modal.selection:state.modal.selections[state.modal.mode];
}
function delayPeopleOptions(selection){
  const choices=allStudents().filter(person=>person.id!==me().id&&matches(person,selection.query)).slice(0,10);
  return choices.map(person=>{
    const chosen=selection.people.has(person.id);
    return button(person.full_name+' · '+person.class_name,chosen?'check':'user',
      'data-action="select-delay-person" data-id="'+e(person.id)+'" aria-pressed="'+chosen+'"',chosen?'compact soft':'compact');
  }).join('')||'<span class="muted">دانش‌آموزی پیدا نشد.</span>';
}
function delayPeople(selection,multiple){
  const people=[...selection.people].map(student).filter(Boolean);
  if(!multiple&&people.length){
    const person=people[0];
    return '<section class="delay-group"><h3>دانش‌آموز</h3><div class="form-actions">'+avatar(person)+'<strong>'+e(person.full_name)+'</strong><span class="muted">'+e(person.class_name)+'</span>'+button('تغییر دانش‌آموز','users','data-action="clear-delay-person"','compact')+'</div></section>';
  }
  const chosen=people.length?'<ul class="delay-chips" aria-label="دانش‌آموزان انتخاب‌شده">'+people.map(person=>
    '<li>'+button(person.full_name,'close','data-action="remove-delay-person" data-id="'+e(person.id)+'" aria-label="'+e('حذف '+person.full_name)+'"','compact soft')+'</li>').join('')+'</ul>':'';
  const label=multiple?'دانش‌آموزان':'دانش‌آموز';
  return '<section class="delay-group"><label class="field">'+label+'<input type="search" id="delay-people-search" placeholder="نام یا کلاس را بنویسید" value="'+e(selection.query)+'"></label>'+chosen+
    '<div id="delay-person-results" class="person-options">'+delayPeopleOptions(selection)+'</div></section>';
}
function delayDates(selection,multiple){
  const days=[...selection.dates].sort();
  const chosen=multiple&&days.length?'<ul class="delay-chips" aria-label="تاریخ‌های انتخاب‌شده">'+days.map(day=>
    '<li>'+button(showDate(day),'close','data-action="remove-delay-day" data-id="'+day+'" aria-label="'+e('حذف '+showDate(day,'long'))+'"','compact soft')+'</li>').join('')+'</ul>':'';
  const label=multiple?'تاریخ‌های تأخیر':'تاریخ تأخیر';
  const calendarLabel=multiple?(selection.calendar?'بستن تقویم':'باز کردن تقویم'):(days.length?showDate(days[0],'long'):'انتخاب تاریخ');
  return '<section class="delay-group"><h3>'+label+'</h3>'+chosen+
    button(calendarLabel,'calendar','data-action="toggle-calendar" aria-expanded="'+selection.calendar+'"','compact')+
    (selection.calendar?calendar(selection.visible,selection.dates):'')+'</section>';
}
function excuseFields(selection){
  return '<section class="delay-group"><div class="tabs">'+button('تأخیر موجه',selection.excused?'check':'',
    'data-action="toggle-excuse" aria-pressed="'+selection.excused+'"','compact')+'</div>'+
    (selection.excused?'<label class="field">علت موجه بودن<textarea name="excuse_reason" rows="2" maxlength="400" required>'+
      e(selection.excuseReason)+'</textarea></label>':'')+'</section>';
}
function delayModal(){
  const m=state.modal;
  const selection=delaySelection();
  const multipleDates=m.mode==='dates';
  const modes='<div class="tabs delay-modes" role="group" aria-label="روش ثبت تأخیر">'+Object.entries(delayModes).map(([mode,label])=>
    button(label,mode==='dates'?'calendar':'users','data-action="delay-mode" data-id="'+mode+'" aria-pressed="'+(m.mode===mode)+'"','compact')).join('')+'</div>';
  const people=delayPeople(selection,!multipleDates);
  const dates=delayDates(selection,multipleDates);
  const count=Math.max(selection.people.size,selection.dates.size);
  const label=count>1?'ثبت '+fa(count)+' تأخیر':'ثبت تأخیر';
  return modalFrame('ثبت تأخیر جدید',modes+'<form data-form="delay"><fieldset class="stack delay-fields">'+(multipleDates?people+dates:dates+people)+excuseFields(selection)+
    '<label class="field">یادداشت (اختیاری)<textarea name="note" rows="2" maxlength="400">'+e(selection.note)+'</textarea></label>'+
    '<div data-form-message hidden></div><div class="form-actions">'+submit(label,'check')+'</div></fieldset></form>');
}
function appealModal(){
  const items=rowsFor(me().id).filter(d=>d.status==='active');
  if(!items.length) return modalFrame('ثبت اعتراض',empty('تأخیر ثبت‌شده‌ای برای اعتراض وجود ندارد.'));
  return modalFrame('ثبت اعتراض','<form data-form="appeal" class="stack"><label class="field">تاریخ تأخیر<select name="delay_id" required><option value="">تاریخ را انتخاب کنید</option>'+items.map(d=>'<option value="'+e(d.id)+'"'+hasValue(d.id,state.modal.delayId)+'>'+e(showDate(d.date_on,'long'))+'</option>').join('')+'</select></label><label class="field">دلیل اعتراض<textarea name="reason" rows="4" minlength="5" maxlength="800" required></textarea></label><div data-form-message hidden></div><div class="form-actions">'+submit('ارسال اعتراض','message')+'</div></form>');
}
function reviewModal(){
  const appeal=state.data.appeals.find(a=>a.id===state.modal.id);
  return modalFrame('بررسی اعتراض','<form data-form="review" class="stack"><p class="notice">'+e(student(appeal.student_id)?.full_name??'')+' · '+e(showDate(appeal.date_on))+'<br>'+e(appeal.reason)+'</p><label class="field">نتیجه<select name="status" required><option value="">نتیجه را انتخاب کنید</option><option value="approved">پذیرش اعتراض و کسر تأخیر از گزارش</option><option value="rejected">رد اعتراض و حفظ تأخیر</option></select></label><label class="field">پاسخ به دانش‌آموز<textarea name="response" rows="4" minlength="2" maxlength="800" required></textarea></label><div data-form-message hidden></div><div class="form-actions">'+submit('ثبت نتیجه','check')+'</div></form>');
}
function gateModal(){
  const person=student(state.modal.studentId);
  if(person){
    const assigned=Boolean(person.gate_assigned_at);
    return modalFrame('افزودن نمایندهٔ درب مدرسه','<form data-form="gate-assign" class="stack"><div class="setting-title">'+avatar(person,true)+'<div><h3>'+e(person.full_name)+'</h3><p>'+e(person.class_name)+' · کد ملی <span class="ltr">'+e(fa(person.username))+'</span></p></div></div>'+
      (assigned?'<p class="notice" role="status">این دانش‌آموز قبلاً نماینده شده است.</p>':'<p class="muted">دسترسی نماینده به حساب فعلی این دانش‌آموز اضافه می‌شود.</p>')+
      '<div data-form-message hidden></div><div class="form-actions">'+(!assigned?submit('ثبت به‌عنوان نماینده','check'):'')+button('جست‌وجوی دوباره','search','data-action="gate-reset"')+'</div></form>');
  }
  return modalFrame('افزودن نمایندهٔ درب مدرسه','<form data-form="gate-search" class="stack"><label class="field">کد ملی دانش‌آموز<input name="national_id" dir="ltr" type="text" inputmode="numeric" autocomplete="off" required maxlength="10"><small>کد ملی ده‌رقمی دانش‌آموز ثبت‌شده را وارد کنید.</small></label><div data-form-message hidden></div><div class="form-actions">'+submit('جست‌وجوی دانش‌آموز','search')+'</div></form>');
}
function personModal(){
  const {id,tab,grades,gradesError}=state.modal;
  const p=student(id);
  const records=rowsFor(id);
  const profileInfo='<div class="setting-title">'+avatar(p,true)+'<div><h3>'+e(p.full_name)+'</h3><p>'+e(p.class_name)+(isAdmin()?' · کد ملی '+fa(p.username):'')+'</p><div style="margin-top:5px">'+badge(fa(active(records).length)+' تأخیر')+'</div></div></div>';
  const tabs='<div class="tabs">'+button('تاریخ‌های تأخیر','clock','data-action="person-tab" data-id="delays" aria-pressed="'+(tab==='delays')+'"','compact')+(isAdmin()?button('نمرات','file','data-action="person-tab" data-id="grades" aria-pressed="'+(tab==='grades')+'"','compact'):'')+'</div>';
  let details=delayTable(records,false,false,canRecord());
  if(tab==='grades'){
    details=gradesError?'<div class="notice error">'+e(gradesError)+'</div>':!grades?'<div class="notice" role="status">در حال دریافت نمرات…</div>':
      table(['درس','نوبت','نمره'],grades.map(g=>'<tr><td>'+e(g.subject)+'</td><td>'+e(g.term)+'</td><td>'+e(displayScore(g.score))+'</td></tr>').join('')||empty('هنوز نمره‌ای ثبت نشده است.',3));
  }
  const transfer=isAdmin()?button('جابه‌جایی کلاس','users','data-action="move-class" data-id="'+e(id)+'"','compact'):'';
  return modalFrame('پروندهٔ دانش‌آموز',profileInfo+'<div class="tabs">'+recordButton(id)+transfer+'</div>'+tabs+details);
}
function recordFields(title,fields,values){
  return '<section class="record-section"><h3>'+e(title)+'</h3><dl>'+fields.map(([key,label,ltr])=>{
    const value=values[key];
    const display=value?(ltr?'<bdi dir="ltr">'+e(fa(value))+'</bdi>':e(value)):'<span class="muted">ثبت نشده</span>';
    return '<div><dt>'+e(label)+'</dt><dd>'+display+'</dd></div>';
  }).join('')+'</dl></section>';
}
function studentRecordModal(){
  const {id,record,error,editing}=state.modal;
  const person=student(id);
  const identity='<div class="setting-title">'+avatar(person,true)+'<div><h3>'+e(person.full_name)+'</h3></div></div>';
  if(error) return modalFrame(pageNames.records,identity+'<p class="notice error" role="alert">'+e(error)+'</p>'+
    '<div class="form-actions">'+button('تلاش دوباره','refresh','data-action="student-record" data-id="'+e(id)+'"')+'</div>');
  if(!record) return modalFrame(pageNames.records,identity+'<p class="notice" role="status">در حال دریافت پرونده…</p>');
  const values={...record.details,class_name:record.class_name,national_id:record.national_id};
  const schoolFields=[['class_name','کلاس فعلی'],['grade','پایه'],['track','رشته'],['enrollment','وضعیت ثبت‌نام']];
  if(!isAdmin()) return modalFrame(pageNames.records,identity+recordFields('اطلاعات تحصیلی',schoolFields,values));
  const birthEditor=editing?'<form class="stack" data-form="birth-date"><label class="field">تاریخ تولد شمسی<input name="birth_date" dir="ltr" placeholder="۱۳۸۹/۰۶/۱۵" autocomplete="off" minlength="10" maxlength="10" value="'+e(values.birth_date??'')+'" required><small>سال/ماه/روز</small></label><div data-form-message hidden></div><div class="form-actions">'+submit('ذخیرهٔ تاریخ تولد','check')+button('انصراف','','data-action="edit-birth-date"')+'</div></form>':
    '<div class="form-actions">'+button(values.birth_date?'ویرایش تاریخ تولد':'ثبت تاریخ تولد','calendar','data-action="edit-birth-date"','compact')+'</div>';
  return modalFrame(pageNames.records,identity+'<div class="stack">'+
    recordFields('مشخصات فردی',[
      ['given_name','نام'],['family_name','نام خانوادگی'],['national_id','کد ملی',true],['student_code','کد دانش‌آموز',true],
      ['birth_date','تاریخ تولد',true],['birth_place','محل تولد'],['birth_certificate','سریال شناسنامه']
    ],values)+birthEditor+
    recordFields('اطلاعات تحصیلی',[...schoolFields,['class_at_import','کلاس در فایل اکسل'],['groups','گروه‌ها'],['admin_tags','برچسب‌های اداری']],values)+
    recordFields('اطلاعات خانواده و تماس',[
      ['father_phone','تلفن پدر',true],['mother_phone','تلفن مادر',true],['student_phone','تلفن دانش‌آموز',true],['other_phones','سایر شماره‌ها'],
      ['father_education','تحصیلات پدر'],['mother_education','تحصیلات مادر'],['father_job','شغل پدر'],['mother_job','شغل مادر'],
      ['father_work','محل کار پدر'],['address','نشانی'],['postal_code','کد پستی',true]
    ],values)+recordFields('وضعیت‌ها در فایل اکسل',[
      ['photo_status','وضعیت تصویر'],['app_status','نصب اپلیکیشن'],['dedicated_access','دسترسی اختصاصی'],
      ['completeness','تکمیل اطلاعات'],['source_updated_at','آخرین ویرایش'],['source_editor','ویرایش‌کننده']
    ],values)+'</div>');
}
function delayChangeEditor(){
  const modal=state.modal;
  const original=modal.original;
  const person=student(original.student_id);
  const correcting=modal.type==='editDelay';
  const originalEntry='<p class="notice">ثبت فعلی '+e(person?.full_name??'')+' · <span class="ltr">'+e(showDate(original.date_on))+'</span></p>';
  const details=correcting?delayPeople(modal.selection,false)+delayDates(modal.selection,false)+excuseFields(modal.selection):
    '<p class="muted">این ردیف با وضعیت «لغوشده» در سابقه می‌ماند و از گزارش حذف می‌شود.</p>';
  return modalFrame(correcting?'اصلاح تأخیر':'لغو تأخیر','<form data-form="update-delay" class="stack">'+originalEntry+details+
    '<label class="field">دلیل '+(correcting?'اصلاح':'لغو')+'<textarea name="change_reason" rows="3" minlength="3" maxlength="400" required>'+e(modal.reason)+'</textarea></label><div data-form-message hidden></div>'+
    '<div class="form-actions">'+submit(correcting?'ذخیرهٔ اصلاح':'تأیید لغو',correcting?'check':'close')+'</div></form>');
}
function delayHistoryModal(){
  const {entries,error}=state.modal;
  let content='<p role="status">در حال دریافت سابقه…</p>';
  if(error) content='<p role="alert" class="notice error">'+e(error)+'</p>';
  else if(entries) content=entries.map(entry=>{
    const describe=item=>e(item.full_name)+' · <span class="ltr">'+e(showDate(item.date_on))+'</span>'+
      (item.excuse_reason?' · موجه، '+e(item.excuse_reason):'');
    const date=new Intl.DateTimeFormat('fa-IR-u-ca-persian',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Tehran'}).format(new Date(entry.changed_at));
    const title={correct:'اصلاح تأخیر',cancel:'لغو تأخیر',excuse:'تغییر وضعیت موجه بودن'}[entry.action];
    return '<article class="audit-entry"><h3>'+e(title)+'</h3><small>'+e(entry.changed_by_name)+' · '+e(date)+'</small>'+
      '<p>ثبت قبلی '+describe(entry.before_entry)+'</p>'+(entry.after_entry?'<p>ثبت پس از تغییر '+describe(entry.after_entry)+'</p>':'')+'<p>دلیل '+e(entry.reason)+'</p></article>';
  }).join('')||'<p class="muted">سابقهٔ تغییری وجود ندارد.</p>';
  return modalFrame('سابقهٔ تغییر تأخیر',content);
}
function revokeGateModal(){
  const {person}=state.modal;
  const detail=person.role==='student'?'حساب و سوابق دانش‌آموزی او حفظ می‌شود.':'دسترسی این حساب به وظایف درب مدرسه پایان می‌یابد.';
  return modalFrame('لغو دسترسی نماینده','<form data-form="revoke-gate" class="stack"><p>دسترسی نمایندگی '+e(person.full_name)+' لغو شود؟</p><p class="muted">'+detail+'</p><div data-form-message hidden></div><div class="form-actions">'+submit('تأیید لغو دسترسی','check')+button('انصراف','','data-action="close"')+'</div></form>');
}
function reportDateModal(){
  const {field,visible,selected}=state.modal;
  return modalFrame(field==='start'?'انتخاب تاریخ شروع':'انتخاب تاریخ پایان',calendar(visible,new Set([selected]))+
    '<p class="notice error" id="report-date-error" role="alert" hidden></p><div class="form-actions report-date-actions">'+button('پاک کردن تاریخ','close','data-action="clear-report-date"','compact')+'</div>');
}
function inboxDelayModal(){
  const {delay,appeal,kind}=state.modal;
  const answer=appeal?.response?'<p class="notice">پاسخ بررسی '+e(appeal.response)+'</p>':'';
  return modalFrame(notificationTitles[kind],delayTable([delay],false)+answer);
}
function parentRequestModal(){
  const person=student(state.modal.id);
  return modalFrame(pageNames.parentRequests,'<form data-form="parent-request" class="stack">'+
    '<p>این اعلان برای '+e(person.full_name)+'، کلاس '+e(person.class_name)+' ارسال می‌شود.</p>'+
    '<p class="notice">'+e(parentRequestMessage)+'</p><div data-form-message hidden></div>'+
    '<div class="form-actions">'+submit('ارسال اعلان به دانش‌آموز','message')+button('انصراف','','data-action="close"')+'</div></form>');
}
function inboxParentModal(){
  return modalFrame(pageNames.parentRequests,'<div class="stack"><p>'+e(parentRequestMessage)+'</p>'+
    '<p class="muted">تاریخ درخواست <span class="ltr">'+e(showDate(state.modal.item.date_on))+'</span></p></div>');
}
function classroomNoticeModal(){
  const {item}=state.modal;
  const message=item.message??(item.kind==='lesson_absence'?'وضعیت حضور شما در این جلسه «غایب» ثبت شد.':'ورود شما به این جلسه با تأخیر ثبت شد.');
  return modalFrame(notificationTitles[item.kind],'<div class="stack"><p>'+
    e([item.sender_name,item.subject,item.class_name,showDate(item.date_on)].filter(Boolean).join(' · '))+
    '</p><p class="notice">'+message.split('\n').map(e).join('<br>')+'</p></div>');
}
function classroomComposeModal(){
  const {target}=state.modal;
  const recipients=target?'<p>برای '+e(target.full_name)+' · '+e(showDate(target.date))+'</p>':
    '<label class="field">دبیر و درس<select name="assignment" required><option value="">انتخاب دبیر</option>'+
    (state.data.coursework?.teachers??[]).map(row=>'<option value="'+e(row.id)+'">'+e(row.teacher_name+' · '+row.subject)+'</option>').join('')+
    '</select></label>';
  return modalFrame(target?'ارسال اعلان به دانش‌آموز':'ارسال اعلان به دبیر',
    '<form data-form="classroom-message" class="stack">'+recipients+
    '<label class="field">متن اعلان<textarea name="message" rows="4" maxlength="800" required></textarea></label>'+
    '<div data-form-message hidden></div><div class="form-actions">'+submit('ارسال اعلان','message')+'</div></form>');
}
function followupSettingsModal(){
  const {period,threshold}=state.data.followup.settings;
  return modalFrame('تنظیم هشدار تأخیر','<form data-form="followup-settings" class="stack">'+
    '<label class="field">بازه<select name="period" required><option value="week"'+hasValue(period,'week')+'>هفته، از شنبه</option><option value="month"'+hasValue(period,'month')+'>ماه شمسی</option></select></label>'+
    '<label class="field">حد هشدار<input name="threshold" dir="ltr" type="text" inputmode="numeric" maxlength="2" value="'+e(fa(threshold))+'" required><small>از ۱ تا ۳۱ تأخیر</small></label>'+
    '<div data-form-message hidden></div><div class="form-actions">'+submit('ذخیرهٔ تنظیم','check')+'</div></form>');
}
function classMoveModal(){
  const m=state.modal;
  const person=student(m.id);
  const history=(state.data.classHistory.get(m.id)??[]).slice().reverse();
  const options=classNames().filter(name=>name!==person.class_name).map(name=>'<option value="'+e(name)+'"></option>').join('');
  const previous=history.length?'<section class="stack"><h3>سوابق جابه‌جایی</h3>'+table(['از کلاس','به کلاس','تاریخ جابه‌جایی'],history.map(move=>
    '<tr><td>'+e(move.previous_class)+'</td><td>'+e(move.new_class)+'</td><td><span class="ltr">'+e(showDate(move.effective_on))+'</span></td></tr>').join(''))+'</section>':'';
  return modalFrame('جابه‌جایی کلاس','<form data-form="class-move" class="stack"><p class="notice">'+e(person.full_name)+' · کلاس فعلی '+e(person.class_name)+'</p>'+
    '<label class="field">کلاس مقصد<input name="class_name" list="available-classes" maxlength="80" value="'+e(m.className??'')+'" required></label><datalist id="available-classes">'+options+'</datalist>'+
    '<div><h3>تاریخ جابه‌جایی</h3>'+button(showDate(m.selected,'long'),'calendar','data-action="toggle-move-calendar" aria-expanded="'+m.calendar+'"','compact')+
    (m.calendar?calendar(m.visible,new Set([m.selected])):'')+'</div>'+
    '<div data-form-message hidden></div><div class="form-actions">'+submit('ثبت جابه‌جایی','check')+'</div>'+previous+'</form>');
}
function teacherAssignmentModal(){
  const {id}=state.modal;
  const person=educator(id);
  const classes=state.data.educators.classes;
  const options=classes.map(name=>'<option value="'+e(name)+'">'+e(name)+'</option>').join('');
  const form=classes.length?'<form data-form="teacher-assignment" class="stack"><label class="field">کلاس<select name="class_name" required>'+
    '<option value="">کلاس را انتخاب کنید</option>'+options+'</select></label><label class="field">درس<input name="subject" maxlength="100" required></label>'+
    '<div data-form-message hidden></div><div class="form-actions">'+submit('ثبت تخصیص','check')+'</div></form>':
    '<p class="notice">برای تخصیص، ابتدا باید دانش‌آموزی در یکی از کلاس‌ها ثبت شده باشد.</p>';
  return modalFrame('تخصیص کلاس و درس','<div class="stack"><h3>'+e(person.full_name)+'</h3>'+form+assignmentTable(id,true)+'</div>');
}
function staffPasswordModal(){
  const modal=state.modal;
  const person=educator(modal.id);
  const name='<p class="notice">'+e(person.full_name)+' · <bdi dir="ltr">'+e(person.username)+'</bdi></p>';
  const current=modal.password?'<label class="field">رمز تنظیم‌شدهٔ مدیر<input id="staff-current-password" readonly dir="ltr" autocomplete="off" value="'+e(modal.password)+'"></label>':
    modal.lookedUp?'<p class="notice" role="status">رمز قابل نمایشی برای این حساب وجود ندارد. می‌توانید رمز تازه‌ای تعیین کنید.</p>':'';
  const lookup=modal.loading?'<p role="status">در حال دریافت رمز…</p>':
    button(modal.password?'پنهان کردن رمز':'نمایش رمز','key','data-action="show-staff-password"');
  return modalFrame('مدیریت رمز عبور','<div class="stack">'+name+current+'<div class="form-actions">'+lookup+'</div>'+
    '<form data-form="set-staff-password" class="stack"><label class="field">رمز عبور تازه<input name="password" type="password" dir="ltr" minlength="8" maxlength="72" autocomplete="new-password" required></label>'+
    '<label class="field">تکرار رمز عبور تازه<input name="confirm" type="password" dir="ltr" maxlength="72" autocomplete="new-password" required></label>'+
    '<div data-form-message hidden></div><div class="form-actions">'+submit('ذخیرهٔ رمز عبور','check')+
    button('ساخت رمز پیشنهادی','refresh','data-action="suggest-staff-password"')+'</div></form></div>');
}
function staffDetailsModal(){
  const person=educator(state.modal.id);
  return modalFrame('پروندهٔ دبیر','<div class="stack"><h3>'+e(person.full_name)+'</h3>'+staffInformation(person)+'</div>');
}
function staffImportModal(){
  return modalFrame('ورود اطلاعات از اکسل','<form data-form="staff-import" class="stack">'+
    '<label class="field">فایل اکسل دبیران<input name="workbook" type="file" accept=".xlsx" required>'+
    '<small>ستون «کد معلم (نام کاربری)» باید با نام کاربری حساب‌های ثبت‌شده یکسان باشد.</small></label>'+
    '<div data-form-message hidden></div><div class="form-actions">'+submit('ثبت اطلاعات دبیران','upload')+'</div></form>');
}
function renderModal(){
  const methods={studentRecord:studentRecordModal,parentRequest:parentRequestModal,inboxParent:inboxParentModal,inboxDelay:inboxDelayModal,followupSettings:followupSettingsModal,classMove:classMoveModal,editDelay:delayChangeEditor,cancelDelay:delayChangeEditor,history:delayHistoryModal,revokeGate:revokeGateModal,reportDate:reportDateModal,delay:delayModal,appeal:appealModal,review:reviewModal,gate:gateModal,person:personModal,teacherAssignment:teacherAssignmentModal,staffPassword:staffPasswordModal,staffDetails:staffDetailsModal,staffImport:staffImportModal,
    classroomNotice:classroomNoticeModal,classroomCompose:classroomComposeModal,
    ledgerDate:()=>modalFrame('انتخاب تاریخ دفتر',calendar(state.modal.visible,new Set([state.modal.selected]))),
    date:()=>modalFrame('فیلتر تاریخ گزارش',calendar(state.modal.visible,new Set([state.modal.selected])))};
  dialog.innerHTML=methods[state.modal.type]();
}

function feedback(form,message,kind='error'){
  const element=form.querySelector('[data-form-message]');
  element.hidden=!message;
  element.className='notice '+kind;
  element.textContent=message;
  element.setAttribute('role',kind==='error'?'alert':'status');
}
function stringifyErrors(result){
  const base=fa(result.added)+' ردیف ثبت شد؛ '+fa(result.skipped)+' ردیف تکراری بود؛ '+fa(result.errors.length)+' خطا.';
  return base+(result.errors.length?'\n'+result.errors.map(item=>'ردیف '+fa(item.row)+' '+(item.username?'('+fa(item.username)+') ':'')+live.errorMessage(new Error(item.error))).join('\n'):'');
}
async function importSubmit(form,data){
  const file=data.get('file');
  if(file.size>1048576) throw new Error('حجم فایل فهرست نباید بیش از یک مگابایت باشد.');
  const source=file.size?await file.text():data.get('text');
  const kind=form.dataset.kind;
  const rows=importRows(source,kind);
  if(!rows.length||rows.length>300) throw new Error('KH2_INVALID_LIST');
  const result={added:0,skipped:0,errors:[]};
  const chunkSize=kind==='students'?20:100;
  for(let start=0;start<rows.length;start+=chunkSize){
    feedback(form,'در حال ثبت ردیف '+fa(start+1)+' از '+fa(rows.length),'');
    try{
      const part=await backend().act('import_'+kind,rows.slice(start,start+chunkSize));
      result.added+=part.added;
      result.skipped+=part.skipped;
      result.errors.push(...part.errors.map(item=>({...item,row:item.row+start})));
    }catch(error){
      if(!start) throw error;
      await fetchData().catch(()=>{});
      feedback(form,stringifyErrors(result)+'\n'+friendly(error)+' برای ادامه دوباره فهرست را ارسال کنید.');
      return;
    }
  }
  await fetchData();
  feedback(form,stringifyErrors(result),result.errors.length?'error':'ok');
  if(!result.errors.length) form.reset();
}
async function photosSubmit(form,data){
  const files=data.getAll('files').filter(file=>file.size);
  const seen=new Set(),errors=[];
  let done=0;
  for(const [index,file] of files.entries()){
    feedback(form,'در حال بارگذاری عکس '+fa(index+1)+' از '+fa(files.length),'');
    const username=digits(file.name.replace(/\.[^.]+$/,''));
    const person=allStudents().find(p=>p.username===username);
    try{
      if(!person) throw new Error('KH2_STUDENT_MISSING');
      if(seen.has(username)) throw new Error('برای این کد ملی بیش از یک فایل انتخاب شده است.');
      await backend().putPhoto(person.id,file);
      seen.add(username);
      done++;
    }catch(error){errors.push(file.name+' · '+friendly(error));}
  }
  await fetchData();
  void fetchPhotos();
  feedback(form,fa(done)+' عکس ثبت شد.'+(errors.length?'\n'+errors.join('\n'):''),errors.length?'error':'ok');
  if(!errors.length) form.reset();
}
function friendly(error){
  return /[\u0600-\u06ff]/.test(error.message??'')?error.message:live.errorMessage(error);
}
function excuseFromForm(data){
  if(!data.has('excuse_reason')) return null;
  const text=data.get('excuse_reason').trim();
  if(!text) throw new Error('KH2_INVALID_EXCUSE_REASON');
  return text;
}
async function writeModal(action,payload,message){
  await backend().act(action,payload);
  closeModal();
  notify(message);
  try {await reload();}
  catch(error){notify(friendly(error),'error');}
}
async function saveAndReloadModal(request,message){
  const modal=state.modal;
  modal.saving=true;
  try{
    await request;
    if(state.modal===modal) closeModal();
    notify(message);
    try {await reload();}
    catch(error){notify(message+' '+friendly(error),'error');}
  }finally{modal.saving=false;}
}
const forms={
  'login-form':async (form,data)=>{
    await live.signIn(data.get('username'),data.get('password'));
    state.mode='live';
    try {await reload();}
    catch(error){
      if(error.status===401||error.status===403){
        await live.signOut();
        state.mode='login';throw error;
      }
      doneLoading(friendly(error));
    }
  },
  import:importSubmit,
  photos:photosSubmit,
  'teacher-assignment':async(form,data)=>{
    const modal=state.modal;
    if(!isAdmin()||modal?.type!=='teacherAssignment') return;
    await saveAndReloadModal(backend().teacherAssignment(modal.id,data.get('class_name'),data.get('subject')),'تخصیص کلاس و درس ثبت شد.');
  },
  'set-staff-password':async(form,data)=>{
    const modal=state.modal;
    if(!isAdmin()||modal?.type!=='staffPassword') return;
    const password=data.get('password');
    if(password!==data.get('confirm')) throw new Error('تکرار رمز عبور با رمز تازه یکسان نیست.');
    const size=new TextEncoder().encode(password).length;
    if(size<8||size>72) throw new Error('KH2_INVALID_STAFF_PASSWORD');
    modal.saving=true;
    try{
      await backend().setStaffPassword(modal.id,password);
      if(state.modal!==modal) return;
      educator(modal.id).password_pending=false;
      modal.password=null;
      modal.lookedUp=false;
      render();
      renderModal();
      feedback(dialog.querySelector('[data-form="set-staff-password"]'),'رمز عبور ذخیره شد.','ok');
      dialog.querySelector('[data-action="show-staff-password"]').focus();
    }finally{modal.saving=false;}
  },
  'staff-import':async(form,data)=>{
    const modal=state.modal;
    if(!isAdmin()||modal?.type!=='staffImport') return;
    const file=data.get('workbook');
    if(!file?.size||file.size>2*1024*1024) throw new Error('فایل اکسل باید حداکثر ۲ مگابایت باشد.');
    modal.saving=true;
    try{
      const [xlsx,buffer]=await Promise.all([loadSheetJS(),file.arrayBuffer()]);
      const count=await backend().importStaffDetails(workbookStaffDetails(xlsx,buffer));
      form.reset();
      feedback(form,'اطلاعات '+fa(count)+' نفر ثبت شد.','ok');
      await reload();
    }finally{modal.saving=false;}
  },
  'ledger-save':async(form,data)=>{
    const selection=state.ledger;
    const result=selection?.result;
    if(!result||result.archived||selection.saving) return;
    const topic=data.get('topic').trim();
    const rows=result.rows.map(row=>({...row,attendance:data.get('attendance-'+row.id)||null,
      score:scoreValue(data.get('score-'+row.id)),note:data.get('note-'+row.id).trim()}));
    selection.saving=true;
    try{
      const revision=await backend().saveTeachingLedger(selection.assignment,selection.date,result.revision,topic,rows);
      if(state.ledger===selection){
        selection.result={...result,topic,rows,revision};
        feedback(form,'دفتر این تاریخ ذخیره شد.','ok');
      }
    }finally{selection.saving=false;}
  },
  'classroom-message':async(form,data)=>{
    const modal=state.modal;
    if(modal?.type!=='classroomCompose') return;
    const target=modal.target;
    const message=data.get('message').trim();
    if(!message) throw new Error('KH2_INVALID_CLASSROOM_MESSAGE');
    modal.saving=true;
    try{
      await backend().sendClassroomMessage(target?.assignment??data.get('assignment'),target?.id??me().id,
        target?.date??modal.date,message,modal.request);
      if(state.modal===modal){closeModal();notify('اعلان ارسال شد.');}
    }finally{modal.saving=false;}
  },
  'parent-request':async()=>{
    const modal=state.modal;
    modal.saving=true;
    try{
      await backend().requestParent(modal.id,modal.requestId);
      if(state.modal===modal){
        closeModal();
        notify('درخواست حضور اولیا برای دانش‌آموز ارسال شد.');
      }
    }finally{modal.saving=false;}
  },
  'birth-date':async(form,data)=>{
    const modal=state.modal;
    const date=digits(data.get('birth_date')).trim();
    modal.saving=true;
    try{
      await backend().setBirthDate(modal.id,date);
      modal.record.details.birth_date=date;
      modal.editing=false;
      if(state.modal===modal){
        renderDelayAndFocus('[data-action="edit-birth-date"]');
        notify('تاریخ تولد ذخیره شد.');
      }
    }finally{modal.saving=false;}
  },
  password:async(form,data)=>{
    if(data.get('new_password')!==data.get('confirm')) throw new Error('تکرار رمز عبور با رمز جدید یکسان نیست.');
    if(new TextEncoder().encode(data.get('new_password')).length>72) throw new Error('رمز عبور جدید بیش از حد طولانی است.');
    await backend().changePassword(me().username,data.get('old'),data.get('new_password'));
    form.reset();
    feedback(form,'رمز عبور تغییر کرد.','ok');
  },
  delay:async(form,data)=>{
    const modal=state.modal;
    const {people,dates}=delaySelection();
    if(!people.size) throw new Error('حداقل یک دانش‌آموز را انتخاب کنید.');
    if(!dates.size) throw new Error('حداقل یک تاریخ از تقویم انتخاب کنید.');
    const excuse=excuseFromForm(data);
    const fields=form.querySelector('fieldset');
    fields.disabled=true;
    modal.saving=true;
    try {
      const {added,skipped}=await backend().registerDelays([...people],[...dates],data.get('note'),excuse);
      if(state.modal===modal) closeModal();
      const result=fa(added)+' تأخیر ثبت شد.'+(skipped?' '+fa(skipped)+' مورد قبلاً ثبت شده بود.':'');
      notify(result);
      try {await reload();}
      catch(error){notify(result+' '+friendly(error),'error');}
    } finally {
      fields.disabled=false;
      modal.saving=false;
    }
  },
  'followup-settings':(form,data)=>{
    const threshold=digits(data.get('threshold')).trim();
    if(!/^\d{1,2}$/.test(threshold)) throw new Error('KH2_INVALID_FOLLOWUP');
    return saveAndReloadModal(backend().saveFollowup(data.get('period'),Number(threshold)),'تنظیم هشدار ذخیره شد.');
  },
  'class-move':(form,data)=>{
    const m=state.modal;
    return saveAndReloadModal(backend().moveStudent(m.id,data.get('class_name'),m.selected,m.expectedClass),'جابه‌جایی کلاس ثبت شد.');
  },
  'update-delay':(form,data)=>{
    const m=state.modal;
    const correcting=m.type==='editDelay';
    const pupil=correcting?[...m.selection.people][0]:null;
    const day=correcting?[...m.selection.dates][0]:null;
    if(correcting&&!pupil) throw new Error('دانش‌آموز را انتخاب کنید.');
    const request=backend().updateDelay(m.original.id,correcting?'correct':'cancel',data.get('change_reason'),pupil,day,excuseFromForm(data));
    return saveAndReloadModal(request,correcting?'تأخیر اصلاح شد.':'تأخیر لغو شد.');
  },
  'revoke-gate':()=>{
    const {person}=state.modal;
    return saveAndReloadModal(backend().revokeGate(person.id,person.gate_assigned_at),'دسترسی نماینده لغو شد.');
  },
  appeal:(form,data)=>writeModal('send_appeal',Object.fromEntries(data),'اعتراض شما ارسال شد.'),
  review:(form,data)=>writeModal('review_appeal',{...Object.fromEntries(data),appeal_id:state.modal.id},'نتیجهٔ اعتراض ثبت شد.'),
  'gate-search':(form,data)=>{
    const username=digits(data.get('national_id')).trim();
    if(!/^\d{10}$/.test(username)) throw new Error('KH2_INVALID_NATIONAL_ID');
    const person=allStudents().find(p=>p.username===username);
    if(!person) throw new Error('KH2_STUDENT_MISSING');
    state.modal.studentId=person.id;
    renderModal();
    dialog.querySelector('button[type="submit"], [data-action="gate-reset"]')?.focus();
  },
  'gate-assign':()=>{
    const person=student(state.modal.studentId);
    return writeModal('add_gate',{username:person.username},'دانش‌آموز به‌عنوان نماینده ثبت شد.');
  }
};
document.addEventListener('submit',async event=>{
  const form=event.target;
  const run=forms[form.dataset.form??form.id];
  if(!run) return;
  event.preventDefault();
  if(state.modal?.saving&&dialog.contains(form)) return;
  const submitter=event.submitter??form.querySelector('[type=submit]');
  if(submitter?.disabled) return;
  if(submitter) submitter.disabled=true;
  feedback(form,'');
  try{await run(form,new FormData(form));}
  catch(error){feedback(form,friendly(error));}
  finally{if(submitter) submitter.disabled=false;}
});

async function enterDemo(role='admin'){
  if(state.mode==='live') await live.signOut();
  demo.selectDemoRole(role);
  state.mode='demo';state.page='dashboard';state.photos={};state.ledger=null;
  resetFilters();await reload();
}
function leave(){
  if(state.mode==='live') void live.signOut();
  state.loadId++;state.mode='login';state.page='dashboard';state.data=null;state.photos={};state.ledger=null;
  clearTimeout(refreshTimer);resetFilters();closeModal();
  document.querySelector('#print-area').replaceChildren();login();
}
function changeModalDate(offset){
  const selection=['delay','editDelay'].includes(state.modal.type)?delaySelection():state.modal;
  const first=monthStart(selection.visible);
  selection.visible=offset<0?shift(first,-1):shift(first,calendarDays(first).days.length);
  renderModal();
  dialog.querySelector('[data-action="month-'+(offset<0?'prev':'next')+'"]:not(:disabled),[data-action="pick-day"]:not(:disabled)')?.focus();
}
async function selectPersonTab(tab){
  const modal=state.modal;
  modal.tab=tab;renderModal();
  dialog.querySelector('[data-id="'+tab+'"]')?.focus();
  if(tab!=='grades'||modal.grades) return;
  try{
    modal.gradesError='';
    modal.grades=await backend().gradesFor(modal.id);
  }catch(error){modal.gradesError=friendly(error);}
  if(state.modal===modal&&modal.tab==='grades'){
    renderModal();dialog.querySelector('[data-id="grades"]')?.focus();
  }
}
function openDelay(studentId){
  const selection=()=>({people:new Set(studentId?[studentId]:[]),dates:new Set(),visible:today(),calendar:true,query:'',note:'',excused:false,excuseReason:''});
  openModal('delay',{mode:'dates',selections:{dates:selection(),students:selection()}});
}
function toggleSelection(set,value){
  if(set.has(value)) set.delete(value);
  else set.add(value);
}
function renderDelayAndFocus(selector){
  renderModal();
  dialog.querySelector(selector)?.focus();
}
function openDelayChange(type,id){
  const original=state.data.delays.find(delay=>delay.id===id);
  if(!original||!canManageDelay(original)) return;
  const selection={people:new Set([original.student_id]),dates:new Set([original.date_on]),visible:original.date_on,
    calendar:false,query:'',excused:Boolean(original.excused),excuseReason:original.excuse_reason??''};
  openModal(type,{original,selection,reason:''});
}
async function openDelayHistory(id){
  if(!isAdmin()) return;
  openModal('history');
  const modal=state.modal;
  try{modal.entries=await backend().delayHistory(id);}
  catch(error){modal.error=friendly(error);}
  if(state.modal===modal) renderDelayAndFocus('[data-action="close"]');
}
async function openStudentRecord(id){
  if(!canRecord()||!student(id)) return;
  openModal('studentRecord',{id});
  const modal=state.modal;
  try{modal.record=await backend().studentRecord(id);}
  catch(error){modal.error=friendly(error);}
  if(state.modal===modal) renderDelayAndFocus('[data-action="close"]');
}
function selectReportDate(field,value){
  const range={...state.reportRange,[field]:value};
  if(range.start&&range.end&&range.start>range.end){
    const feedback=dialog.querySelector('#report-date-error');
    feedback.hidden=false;
    feedback.textContent='تاریخ شروع باید پیش از تاریخ پایان یا برابر با آن باشد.';
    return;
  }
  state.reportRange=range;
  state.pageIndex=0;
  closeModal();
  render();
  document.querySelector('[data-action="report-date"][data-id="'+field+'"]')?.focus();
}
const actions={
  demo:()=>enterDemo(),
  logout:leave,
  retry:start,
  'request-parent':id=>{
    if(canRecord()&&id!==me().id&&student(id)) openModal('parentRequest',{id,requestId:crypto.randomUUID()});
  },
  'student-record':openStudentRecord,
  'teacher-assignment':id=>{if(isAdmin()&&educator(id)) openModal('teacherAssignment',{id});},
  'remove-teacher-assignment':async id=>{
    const modal=state.modal;
    if(!isAdmin()||modal?.type!=='teacherAssignment'||!educatorAssignments(modal.id).some(row=>row.id===id)) return;
    await saveAndReloadModal(backend().teacherAssignment(modal.id,null,null,id),'تخصیص حذف شد.');
  },
  'staff-password':id=>{
    const person=isAdmin()&&educator(id);
    if(person&&person.role!=='admin') openModal('staffPassword',{id});
  },
  'show-staff-password':async()=>{
    const modal=state.modal;
    if(!isAdmin()||modal?.type!=='staffPassword') return;
    if(modal.password){modal.password=null;modal.lookedUp=false;renderModal();return;}
    modal.loading=true;
    renderModal();
    try{
      const result=await backend().staffPassword(modal.id);
      modal.password=result.password;
      modal.lookedUp=true;
    }finally{
      modal.loading=false;
      if(state.modal===modal){
        renderModal();
        dialog.querySelector('#staff-current-password,[data-action="show-staff-password"]')?.focus();
      }
    }
  },
  'suggest-staff-password':()=>{
    if(!isAdmin()||state.modal?.type!=='staffPassword') return;
    const password=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
    const form=dialog.querySelector('[data-form="set-staff-password"]');
    form.elements.password.value=password;
    form.elements.confirm.value=password;
    form.querySelector('button[type="submit"]').focus();
  },
  'staff-details':id=>{if(isAdmin()&&educator(id)) openModal('staffDetails',{id});},
  'staff-import':()=>{if(isAdmin()) openModal('staffImport');},
  'ledger-date':()=>{
    const date=state.ledger?.date??today();
    openModal('ledgerDate',{selected:date,visible:date});
  },
  'reload-ledger':()=>loadLedger(state.ledger.assignment,state.ledger.date),
  'bulk-presence':mode=>{
    const ledger=state.ledger;
    if(ledger?.saving||!ledger?.result||ledger.result.archived) return;
    const form=document.querySelector('[data-form="ledger-save"]');
    for(const field of form.querySelectorAll('select[name^="attendance-"]')){
      if(mode==='all'||field.value!=='absent') field.value='present';
    }
    form.requestSubmit(form.querySelector('[type="submit"]'));
  },
  'teacher-notice':id=>{
    const ledger=state.ledger;
    const person=ledger?.result?.rows.find(row=>row.id===id);
    if(person&&!ledger.result.archived){
      openModal('classroomCompose',{target:{id,full_name:person.full_name,assignment:ledger.assignment,date:ledger.date},request:crypto.randomUUID()});
    }
  },
  'student-notice':()=>{
    if(isStudent()&&state.data.coursework?.teachers?.length) openModal('classroomCompose',{date:today(),request:crypto.randomUUID()});
  },
  'refresh-coursework':()=>reload(),
  'edit-birth-date':()=>{
    const modal=state.modal;
    if(!isAdmin()||modal?.type!=='studentRecord'||!modal.record) return;
    modal.editing=!modal.editing;
    renderDelayAndFocus(modal.editing?'[name="birth_date"]':'[data-action="edit-birth-date"]');
  },
  menu:()=>setMenu(!state.menu),
  'followup-settings':()=>{if(isAdmin()) openModal('followupSettings');},
  'move-class':id=>{
    const person=isAdmin()&&student(id);
    if(person) openModal('classMove',{id,expectedClass:person.class_name,selected:today(),visible:today(),calendar:false});
  },
  'toggle-move-calendar':()=>{
    state.modal.calendar=!state.modal.calendar;
    renderDelayAndFocus('[data-action="toggle-move-calendar"]');
  },
  'refresh-inbox':()=>refreshInbox(),
  'mark-inbox':()=>refreshInbox(true),
  'open-notification':async id=>{
    const item=state.data.inbox.items.find(entry=>entry.id===id);
    if(!item) return;
    await refreshInbox(false,id);
    if(item.kind==='parent_requested'){
      openModal('inboxParent',{item});
      return;
    }
    if(isClassroomNotification(item.kind)){
      openModal('classroomNotice',{item});
      return;
    }
    if(!await fetchData()) return;
    if(item.kind==='appeal_added'){
      if(!canRecord()){render();return;}
      setPage('appeals');
      const appeal=appealsFor(false).find(entry=>entry.delay_id===item.delay_id&&entry.status==='pending'&&!entry.delay_cancelled);
      if(appeal) openModal('review',{id:appeal.id});
      return;
    }
    const delay=rowsFor(me().id).find(entry=>entry.id===item.delay_id);
    if(!delay){render();return;}
    const appeal=appealsFor(true).find(entry=>entry.delay_id===delay.id);
    openModal('inboxDelay',{delay,appeal,kind:item.kind});
  },
  print:printReport,
  'export-report':exportReport,
  'report-period':mode=>{
    state.reportRange=reportPeriod(mode);
    state.pageIndex=0;
    render();
    document.querySelector('[data-action="report-period"][aria-pressed="true"]')?.focus();
  },
  'report-date':field=>openModal('reportDate',{field,visible:state.reportRange[field]||today(),selected:state.reportRange[field]}),
  'clear-report-date':()=>selectReportDate(state.modal.field,''),
  'edit-delay':id=>openDelayChange('editDelay',id),
  'cancel-delay':id=>openDelayChange('cancelDelay',id),
  'delay-history':openDelayHistory,
  'revoke-gate':id=>{
    const person=isAdmin()&&state.data.staff.find(member=>member.id===id);
    if(person) openModal('revokeGate',{person});
  },
  prev:()=>{state.pageIndex--;updateList();document.querySelector('#list-results .paging button:not(:disabled)')?.focus();},
  next:()=>{state.pageIndex++;updateList();document.querySelector('#list-results .paging button:last-child:not(:disabled), #list-results .paging button:first-child:not(:disabled)')?.focus();},
  'filter-date':()=>openModal('date',{visible:state.filterDate||today(),selected:state.filterDate}),
  'reset-date':()=>{state.filterDate='';state.pageIndex=0;render();},
  'new-delay':openDelay,
  'new-appeal':id=>openModal('appeal',{delayId:id}),
  'add-gate':()=>openModal('gate'),
  'gate-reset':()=>{state.modal.studentId=null;renderModal();dialog.querySelector('[name=national_id]')?.focus();},
  'appeal-filter':id=>{state.appealFilter=id;render();document.querySelector('[data-action="appeal-filter"][aria-pressed=true]')?.focus();},
  'person-tab':selectPersonTab,
  person:id=>openModal('person',{id,tab:'delays'}),
  review:id=>openModal('review',{id}),
  close:closeModal,
  'delay-mode':mode=>{
    state.modal.mode=mode;
    renderDelayAndFocus('[data-action="delay-mode"][aria-pressed="true"]');
  },
  'toggle-excuse':()=>{
    const selection=delaySelection();
    selection.excused=!selection.excused;
    renderDelayAndFocus(selection.excused?'[name="excuse_reason"]':'[data-action="toggle-excuse"]');
  },
  'toggle-calendar':()=>{
    const selection=delaySelection();
    selection.calendar=!selection.calendar;
    renderDelayAndFocus('[data-action="toggle-calendar"]');
  },
  'month-prev':()=>changeModalDate(-1),
  'month-next':()=>changeModalDate(1),
  'pick-day':id=>{
    if(state.modal.type==='ledgerDate'){
      closeModal();
      return loadLedger(state.ledger?.assignment??'',id);
    }
    if(state.modal.type==='classMove'){
      state.modal.selected=id;
      state.modal.calendar=false;
      renderDelayAndFocus('[data-action="toggle-move-calendar"]');
      return;
    }
    if(state.modal.type==='reportDate'){selectReportDate(state.modal.field,id);return;}
    if(state.modal.type==='editDelay'){
      const selection=delaySelection();
      selection.dates=new Set([id]);
      selection.calendar=false;
      renderDelayAndFocus('[data-action="toggle-calendar"]');
      return;
    }
    if(state.modal.type==='date'){state.filterDate=id;state.pageIndex=0;closeModal();render();document.querySelector('[data-action="filter-date"]')?.focus();return;}
    const selection=delaySelection();
    if(state.modal.mode==='dates'){
      toggleSelection(selection.dates,id);
      renderDelayAndFocus('[data-action="pick-day"][data-id="'+id+'"]');
    }else{
      selection.dates=new Set([id]);
      selection.calendar=false;
      renderDelayAndFocus('#delay-people-search');
    }
  },
  'remove-delay-day':id=>{delaySelection().dates.delete(id);renderDelayAndFocus('[data-action="toggle-calendar"]');},
  'clear-delay-person':()=>{
    const selection=delaySelection();
    selection.people.clear();
    selection.query='';
    renderDelayAndFocus('#delay-people-search');
  },
  'remove-delay-person':id=>{delaySelection().people.delete(id);renderDelayAndFocus('#delay-people-search');},
  'select-delay-person':id=>{
    const selection=delaySelection();
    if(state.modal.type==='delay'&&state.modal.mode==='students'){
      toggleSelection(selection.people,id);
      renderDelayAndFocus('[data-action="select-delay-person"][data-id="'+CSS.escape(id)+'"]');
    }else{
      if(state.modal.type==='editDelay'){
        const original=state.modal.original;
        selection.excused=id===original.student_id&&Boolean(original.excused);
        selection.excuseReason=id===original.student_id?original.excuse_reason??'':'';
      }
      selection.people=new Set([id]);
      renderDelayAndFocus('[data-action="toggle-calendar"]');
    }
  }

};
document.addEventListener('click',async event=>{
  const control=event.target.closest('button');
  if(!control||control.disabled||(state.modal?.saving&&dialog.contains(control))) return;
  if(control.dataset.page){
    setPage(control.dataset.page);
    if(control.dataset.page==='inbox') void refreshInbox().catch(()=>{});
    return;
  }
  const run=actions[control.dataset.action];
  if(!run) return;
  try{await run(control.dataset.id);}
  catch(error){notify(friendly(error),'error');}
});
document.addEventListener('input',event=>{
  const field=event.target;
  if(field.matches('[data-grade],[data-grade-list]')){
    const formatted=field.hasAttribute('data-grade')?displayScore(field.value):localizeGradeList(field.value);
    if(formatted!==field.value){
      const {selectionStart,selectionEnd}=field;
      field.value=formatted;
      field.setSelectionRange(selectionStart,selectionEnd);
    }
  }else if(event.target.id==='search-people'){
    state.query=event.target.value;state.pageIndex=0;updateList();
  }else if(event.target.id==='delay-people-search'){
    const selection=delaySelection();
    selection.query=event.target.value;
    dialog.querySelector('#delay-person-results').innerHTML=delayPeopleOptions(selection);
  }else if(event.target.name==='class_name'&&state.modal?.type==='classMove') state.modal.className=event.target.value;
  else if(event.target.name==='note'&&state.modal?.type==='delay') delaySelection().note=event.target.value;
  else if(event.target.name==='excuse_reason'&&['delay','editDelay'].includes(state.modal?.type)) delaySelection().excuseReason=event.target.value;
  else if(event.target.name==='change_reason'&&['editDelay','cancelDelay'].includes(state.modal?.type)) state.modal.reason=event.target.value;
});
document.addEventListener('change',async event=>{
  if(event.target.id==='class-filter'){state.className=event.target.value;state.pageIndex=0;updateList();}
  if(event.target.id==='report-excuse'){state.reportExcuse=event.target.value;state.pageIndex=0;updateList();}
  if(event.target.id==='ledger-assignment') await loadLedger(event.target.value,state.ledger?.date??today());
  if(event.target.id==='demo-role') await enterDemo(event.target.value);
});
function setMenu(open){
  state.menu=open&&mobileLayout.matches;
  render();
  document.querySelector(state.menu?'.sidebar-close':mobileLayout.matches?'.mobile-toggle':'#main-content')?.focus();
}
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&state.menu&&!dialog.open) setMenu(false);
});
mobileLayout.addEventListener('change',()=>{if(state.menu) setMenu(false);});
window.addEventListener('afterprint',()=>document.querySelector('#print-area').replaceChildren());
async function start(){
  if(!live.hasSession()){login();return;}
  state.mode='live';doneLoading();
  try{await reload();}
  catch(error){
    if(error.status===401||error.status===403){leave();login(friendly(error));}
    else doneLoading(friendly(error));
  }
}
function pollInbox(){
  if(state.mode==='live'&&state.data&&!document.hidden) void refreshInbox().catch(()=>{});
}
document.addEventListener('visibilitychange',pollInbox);
setInterval(pollInbox,45000);
void start();
