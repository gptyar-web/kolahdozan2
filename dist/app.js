import * as live from './api.js?v=delay-management';
import * as demo from './demo.js?v=delay-management';
import { icon } from './icons.js';
import {downloadReport,printLedger,reportDate,reportPeriod,reportRows as buildReportRows} from './report.js?v=print-month-day';
import { active,calendarDays,classYear,dayParts,digits,escape as e,fa,importRows,matches,monthStart,school,shift,showDate,today } from './domain.js?v=delay-management';

const app=document.querySelector('#app');
const dialog=document.querySelector('#modal');
const toast=document.querySelector('#toast');
const roleNames={admin:'مدیر سامانه',gate:'نمایندهٔ درب مدرسه',student:'دانش‌آموز'};
const statusNames={active:'تأخیر ثبت‌شده',pending:'در انتظار بررسی',approved:'اعتراض پذیرفته شد',rejected:'اعتراض رد شد',cancelled:'لغوشده'};
const pageNames={dashboard:'پیشخوان',students:'دانش‌آموزان',delays:'ثبت و سوابق تأخیر',appeals:'اعتراض‌ها',myDelays:'تأخیرهای من',myAppeals:'اعتراض‌های من',reports:'گزارش و چاپ',staff:'نمایندگان درب مدرسه',manage:'ثبت گروهی',profile:'پروفایل من'};
const pageIcons={dashboard:'home',students:'users',delays:'clock',appeals:'message',myDelays:'clock',myAppeals:'message',reports:'report',staff:'shield',manage:'upload',profile:'user'};
const state={mode:'login',page:'dashboard',data:null,photos:{},query:'',className:'',filterDate:'',reportRange:reportPeriod('all'),pageIndex:0,menu:false,modal:null,appealFilter:'all',loadId:0};
let toastTimer;
let refreshTimer;
let focusAfterModal;
const limit=8;
const delayModes={dates:'یک دانش‌آموز، چند تاریخ',students:'یک تاریخ، چند دانش‌آموز'};
const logo=new URL('./assets/favicon.svg',import.meta.url).href;
const art=new URL('./assets/school-clock.webp',import.meta.url).href;
const backend=()=>state.mode==='demo'?demo:live;
const me=()=>state.data.me;
const isAdmin=()=>me().role==='admin';
const isStudent=()=>me().role==='student';
const isStudentGate=()=>isStudent()&&Boolean(me().gate_assigned_at);
const canRecord=()=>isAdmin()||(me().role==='gate'&&!me().gate_revoked_at)||isStudentGate();
const roleLabel=()=>isStudentGate()?'دانش‌آموز و نمایندهٔ درب مدرسه':me().gate_revoked_at?'نمایندهٔ سابق درب مدرسه':roleNames[me().role];
const ownsAppeal=appeal=>appeal.student_id===me().id;
const allStudents=()=>state.data.students;
const student=id=>allStudents().find(p=>p.id===id);
const rowsFor=id=>state.data.delays.filter(row=>row.student_id===id);
function allowed(){
  if(!canRecord()) return isStudent()?['dashboard','myDelays','myAppeals','profile']:['profile'];
  const pages=['dashboard','students','delays','appeals','reports'];
  if(isAdmin()) pages.push('staff','manage');
  if(isStudentGate()) pages.push('myDelays','myAppeals');
  return [...pages,'profile'];
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
  return '<div class="brand"><img src="'+logo+'" alt="" width="44" height="44"><div><strong>'+school+'</strong><small>سامانه مدیریت تأخیر دانش‌آموزان</small></div></div>';
}
function notify(message,kind=''){
  clearTimeout(toastTimer);
  toast.className=kind;
  toast.textContent=message;
  toastTimer=setTimeout(()=>{toast.textContent='';},4400);
}
function resetFilters(){
  Object.assign(state,{query:'',className:'',filterDate:'',reportRange:reportPeriod('all'),pageIndex:0,appealFilter:'all',menu:false});
}
async function fetchData(){
  const id=++state.loadId;
  const data=await backend().overview();
  if(id!==state.loadId) return false;
  state.data=data;
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
  app.innerHTML='<div class="login-page"><aside class="login-visual"><img src="'+art+'" alt=""><h1>'+school+'</h1><p>مدیریت تأخیر، مشاهده سوابق و پیگیری اعتراض‌ها</p></aside><main class="login-main" id="main-content"><section class="login-card">'+branding()+'<div><h2>ورود به سامانه</h2><p class="muted">نام کاربری و رمز عبور خود را وارد کنید.</p></div><form id="login-form"><label class="field">نام کاربری<input name="username" dir="ltr" autocomplete="username" required maxlength="48"></label><label class="field">رمز عبور<input name="password" dir="ltr" type="password" autocomplete="current-password" required maxlength="72"></label><div data-form-message'+(error?' class="notice error" role="alert"':' hidden')+'>'+e(error)+'</div>'+submit('ورود به سامانه','left')+'</form><div class="form-actions">'+button('مشاهدهٔ نسخهٔ آزمایشی','home','data-action="demo"','soft')+'</div></section></main></div>';
}
function doneLoading(error=''){
  app.innerHTML='<main class="login-main" id="main-content"><section class="login-card">'+branding()+'<div class="notice'+(error?' error':'')+'" role="status">'+e(error||'در حال دریافت اطلاعات…')+'</div>'+(error?'<div class="form-actions">'+button('تلاش دوباره','refresh','data-action="retry"','primary')+button('بازگشت به ورود','logout','data-action="logout"')+'</div>':'')+'</section></main>';
}
function nav(key){
  const count=['appeals','myAppeals'].includes(key)?appealsFor(key==='myAppeals').filter(a=>a.status==='pending'&&!a.delay_cancelled).length:0;
  return '<button type="button" class="nav-item'+(state.page===key?' active':'')+'" data-page="'+key+'"'+(state.page===key?' aria-current="page"':'')+'>'+icon(pageIcons[key])+e(pageNames[key])+(count?'<span class="nav-count">'+fa(count)+'</span>':'')+'</button>';
}
function render(){
  if(!state.data){login();return;}
  const pageLabel=pageNames[state.page];
  const demoBadge=state.mode==='demo'?'<span class="badge">نسخهٔ آزمایشی</span>':'';
  const switcher=state.mode==='demo'?'<div class="nav-group"><p class="nav-label">تغییر نقش آزمایشی</p><select id="demo-role" aria-label="نقش آزمایشی">'+Object.entries(roleNames).map(([id,title])=>'<option value="'+id+'"'+hasValue(isStudentGate()?'gate':me().role,id)+'>'+e(title)+'</option>').join('')+'</select></div>':'';
  app.innerHTML='<div class="layout'+(state.menu?' menu-open':'')+'"><button id="screen-mask" type="button" data-action="menu" aria-label="بستن منو"></button><aside id="sidebar" class="sidebar'+(state.menu?' open':'')+'" aria-label="منوی سامانه">'+branding()+'<nav><div class="nav-group"><p class="nav-label">منوی اصلی</p>'+allowed().filter(x=>!['staff','manage','myDelays','myAppeals','profile'].includes(x)).map(nav).join('')+'</div><div class="nav-group"><p class="nav-label">'+(isAdmin()?'مدیریت سامانه':'حساب کاربری')+'</p>'+allowed().filter(x=>['staff','manage','myDelays','myAppeals','profile'].includes(x)).map(nav).join('')+'</div></nav>'+switcher+'<div class="sidebar-bottom"><div class="school-term">'+tile('calendar')+'<div><strong>سال تحصیلی</strong><small>'+classYear()+'</small></div></div><button class="nav-item" type="button" data-action="logout">'+icon('logout')+'خروج از حساب</button></div></aside><header class="topbar"><div class="crumb">'+button('','menu','data-action="menu" aria-label="منو" aria-controls="sidebar" aria-expanded="'+state.menu+'"','icon mobile-toggle')+'<span class="muted">پنل '+e(roleLabel())+'</span>'+icon('left')+'<span>'+e(pageLabel)+'</span></div><div class="top-actions">'+demoBadge+'<span class="top-date">'+icon('calendar')+e(showDate(today(),'long'))+'</span><span class="top-divider"></span><details class="identity"><summary aria-label="منوی حساب کاربری">'+avatar(me())+'<span class="identity-label"><strong>'+e(me().full_name)+'</strong><small>'+e(roleLabel())+'</small></span>'+icon('down')+'</summary><div class="account-menu">'+nav('profile')+'<button class="nav-item" type="button" data-action="logout">'+icon('logout')+'خروج از حساب</button></div></details></div></header><main class="main" id="main-content" tabindex="-1">'+({
    dashboard,students,delays:()=>delays(false),appeals:()=>appeals(false),myDelays:()=>delays(true),myAppeals:()=>appeals(true),reports,staff,manage,profile
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
  return '<div class="table-wrap"><table><thead><tr>'+headers.map(title=>'<th scope="col">'+e(title)+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>';
}
function studentCell(person,sub=''){
  return '<div class="student-cell">'+avatar(person)+'<div><strong>'+e(person?.full_name??'—')+'</strong>'+(sub?'<small>'+e(sub)+'</small>':'')+'</div></div>';
}
function peopleFilter(withDate=false){
  const classes=[...new Set(allStudents().map(p=>p.class_name))].filter(Boolean).sort((a,b)=>a.localeCompare(b,'fa'));
  return '<div class="filters"><label class="search">'+icon('search')+'<input type="search" id="search-people" aria-label="جست‌وجوی دانش‌آموز" placeholder="'+(isAdmin()?'جست‌وجوی نام، کد ملی یا کلاس':'جست‌وجوی نام یا کلاس')+'" value="'+e(state.query)+'"></label><select id="class-filter" aria-label="فیلتر کلاس"><option value="">همهٔ کلاس‌ها</option>'+classes.map(c=>'<option value="'+e(c)+'"'+hasValue(state.className,c)+'>'+e(c)+'</option>').join('')+'</select>'+(withDate?button(state.filterDate?showDate(state.filterDate):'همهٔ تاریخ‌ها','calendar','data-action="filter-date"')+(state.filterDate?button('','close','data-action="reset-date" aria-label="پاک کردن فیلتر تاریخ"','icon'):''):'')+'</div>';
}
function filteredStudents(){
  return allStudents().filter(p=>(!state.className||p.class_name===state.className)&&matches(p,state.query));
}
function selectedDelays(){
  const ids=new Set(filteredStudents().map(p=>p.id));
  return state.data.delays.filter(d=>ids.has(d.student_id)&&(!state.filterDate||d.date_on===state.filterDate));
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
      ...(row.cancelled_at?[]:[button('اصلاح','calendar','data-action="edit-delay" '+id,'compact'),button('لغو','close','data-action="cancel-delay" '+id,'compact')]),
      ...(row.has_history?[button('سابقهٔ تغییر','report','data-action="delay-history" '+id,'compact ghost')]:[])
    ].join(''):'';
    return '<tr>'+(withStudent?'<td>'+studentCell(person)+'</td><td>'+e(person?.class_name??'—')+'</td>':'')+'<td><span class="ltr">'+e(showDate(row.date_on))+'</span>'+(row.note?'<br><small class="muted">'+e(row.note)+'</small>':'')+'</td><td>'+e(row.recorder_name)+'</td><td>'+showStatus(row.status)+'</td>'+(withAppeal?'<td>'+(row.status==='active'?button('ثبت اعتراض','message','data-action="new-appeal" data-id="'+e(row.id)+'"','compact soft'):'—')+'</td>':'')+(withManagement?'<td><div class="form-actions">'+(management||'—')+'</div></td>':'')+'</tr>';
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
    button('چاپ گزارش','print','data-action="print"')+button('ثبت تأخیر جدید','plus','data-action="new-delay"','primary');
  const quick=personal?[['clock','مشاهدهٔ تأخیرها','تاریخ و وضعیت هر تأخیر','data-page="myDelays"'],['message','ثبت اعتراض','انتخاب تاریخ از سوابق تأخیر','data-action="new-appeal"'],['user','پروفایل من','مشاهده اطلاعات و تغییر رمز','data-page="profile"']]:
    [['plusUser',isAdmin()?'ثبت گروهی دانش‌آموزان':'ثبت تأخیر دانش‌آموز',isAdmin()?'ورود فهرست دانش‌آموزان، عکس و نمرات':'انتخاب دانش‌آموز و تاریخ',isAdmin()?'data-page="manage"':'data-action="new-delay"'],['users','جست‌وجوی دانش‌آموز','جست‌وجو با نام یا کلاس','data-page="students"'],['print','گزارش و چاپ','فهرست دانش‌آموزان و تاریخ‌های تأخیر','data-page="reports"']];
  const intro=personal?'تأخیرهای خود را ببینید و وضعیت اعتراض‌ها را پیگیری کنید.':'وضعیت تأخیرها، اعتراض‌ها و پرونده‌های دانش‌آموزان را بررسی کنید.';
  const statHTML='<section class="stats" aria-label="خلاصهٔ وضعیت">'+stats.map(([name,value,i,color,note])=>'<article class="stat"><div class="stat-top"><span>'+e(name)+'</span>'+tile(i,color)+'</div><strong>'+fa(value)+'</strong><small>'+e(note)+'</small></article>').join('')+'</section>';
  const quickHTML='<div class="quick-grid">'+quick.map(([i,title,sub,attrs],index)=>'<button type="button" class="quick-row" '+attrs+'>'+tile(i,['','blue','peach'][index])+'<span><strong>'+e(title)+'</strong><small>'+e(sub)+'</small></span>'+icon('left')+'</button>').join('')+'</div>';
  return headline('پیشخوان',personal?'خلاصهٔ وضعیت حضور و اعتراض‌های شما':'خلاصهٔ وضعیت حضور و تأخیر دانش‌آموزان',actions)+
    '<section class="hero"><img class="hero-art" src="'+art+'" alt=""><div class="hero-copy"><span class="hero-tag">'+icon('cap')+e(roleLabel())+'</span><h2>'+e(personal?'سلام، '+me().full_name:'به پیشخوان مدرسه خوش آمدید')+'</h2><p>'+intro+'</p></div></section>'+statHTML+
    '<div class="insights">'+card('روند تأخیرها','تعداد تأخیرهای ثبت‌شده در هر روز',chart(current),'<span class="chart-range">۷ روز اخیر</span>')+card('دسترسی سریع','',quickHTML)+'</div>'+
    card('آخرین تأخیرهای ثبت‌شده','',delayTable(delays.slice(0,5),!personal,false),button('مشاهدهٔ همه','left',personal?'data-page="myDelays"':'data-page="delays"','ghost compact'));
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
function delays(own){
  const actions=own?button('ثبت اعتراض','message','data-action="new-appeal"','primary'):
    button('چاپ گزارش','print','data-action="print"')+button('ثبت تأخیر جدید','plus','data-action="new-delay"','primary');
  return headline(own?pageNames.myDelays:pageNames.delays,own?'تاریخ‌های ثبت‌شده و وضعیت اعتراض هر تأخیر':'تاریخ، ثبت‌کننده و وضعیت تأخیر دانش‌آموزان',actions)+
    '<section class="card">'+(!own?peopleFilter(true):'')+'<div id="list-results">'+delayResults(own)+'</div></section>';
}
function delayResults(own){
  const [records,footer]=paginated(own?rowsFor(me().id):selectedDelays());
  return delayTable(records,!own,own,!own&&isAdmin())+footer;
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
    button(end?'تا '+showDate(end):'تا تاریخ','calendar','data-action="report-date" data-id="end"','compact')+'</div></div>';
}
function reports(){
  const actions=(isAdmin()?button('خروجی اکسل','file','data-action="export-report"'):'')+
    button('چاپ فهرست','print','data-action="print"','primary');
  return headline(pageNames.reports,'گزارش تأخیر هر کلاس در بازهٔ انتخاب‌شده',actions)+
    '<section class="card">'+peopleFilter()+reportFilters()+'<div id="list-results">'+reportResults()+'</div></section>';
}
function currentReport(){
  const {start,end}=state.page==='reports'?state.reportRange:{start:state.filterDate,end:state.filterDate};
  const rows=buildReportRows(filteredStudents(),state.data.delays,start,end);
  const dateLabel=start&&start===end?showDate(start):[
    start?'از '+showDate(start):'',end?'تا '+showDate(end):''
  ].filter(Boolean).join(' ');
  const period=[dateLabel||'همهٔ تاریخ‌ها',state.query?'جست‌وجو «'+state.query+'»':''].filter(Boolean).join(' · ');
  const reference=end||start||rows.flatMap(row=>row.dates.slice(-1)).sort().at(-1)||today();
  return {rows,period,year:classYear(reference)};
}
function reportTable(rows){
  const dateCount=Math.max(1,...rows.map(row=>row.dates.length));
  const headers=['دانش‌آموز','کلاس','تعداد تأخیر',...Array.from({length:dateCount},(_,i)=>'تاریخ '+fa(i+1))];
  return table(headers,rows.map(({person,dates})=>
    '<tr><td>'+studentCell(person)+'</td><td>'+e(person.class_name)+'</td><td>'+fa(dates.length)+'</td>'+
      Array.from({length:dateCount},(_,i)=>'<td class="report-date">'+(dates[i]?'<span class="ltr">'+e(reportDate(dates[i]))+'</span>':'')+'</td>').join('')+'</tr>').join('')||
    empty('دانش‌آموزی برای نمایش وجود ندارد.',headers.length));
}
function reportResults(){
  const {rows}=currentReport();
  const [page,footer]=paginated(rows);
  const summary='<div class="report-summary">'+fa(rows.length)+' دانش‌آموز · '+fa(rows.reduce((sum,row)=>sum+row.dates.length,0))+' تأخیر در بازهٔ انتخاب‌شده</div>';
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
function staff(){
  const rows=state.data.staff.map(person=>{
    const date=person.gate_assigned_at||person.created_at;
    return '<tr><td>'+studentCell(person)+'</td><td><span class="ltr">'+e(person.username)+'</span></td><td>'+e(person.class_name||'—')+'</td><td>'+e(showDate(date.slice(0,10)))+'</td><td>'+badge(person.role==='student'?'دانش‌آموز و نماینده':'نمایندهٔ درب مدرسه')+'</td><td>'+button('لغو دسترسی','close','data-action="revoke-gate" data-id="'+e(person.id)+'"','compact')+'</td></tr>';
  }).join('');
  return headline(pageNames.staff,'انتخاب نماینده از دانش‌آموزان ثبت‌شده',button('افزودن نماینده','plusUser','data-action="add-gate"','primary'))+
    card('فهرست نمایندگان','',table(['نام و نام خانوادگی','نام کاربری','کلاس','تاریخ ثبت','نقش','عملیات'],rows||empty('هنوز نماینده‌ای ثبت نشده است.',6)));
}
function manage(){
  return headline('ثبت گروهی','ثبت دانش‌آموزان، عکس‌ها و نمرات از طریق فهرست')+
    '<div class="setting-grid">'+importCard('students','users','ثبت گروهی دانش‌آموزان','کد ملی، نام و نام خانوادگی و کلاس','کد ملی،نام و نام خانوادگی،کلاس\n۰۰۱۰۰۰۰۰۰۱،علی احمدی،دهم تجربی')+
    '<section class="card setting-card"><div class="setting-title">'+tile('image','blue')+'<div><h2>ثبت گروهی عکس‌ها</h2><p>نام هر فایل را برابر کد ملی ده‌رقمی دانش‌آموز قرار دهید.</p></div></div><form data-form="photos" class="stack"><label class="field">فایل‌های عکس<input type="file" name="files" accept="image/png,image/jpeg,image/webp" multiple required><small>JPEG، PNG یا WebP · حداکثر ۳ مگابایت برای هر فایل</small></label><div data-form-message hidden></div><div class="form-actions">'+submit('بارگذاری عکس‌ها','upload')+'</div></form></section>'+
    importCard('grades','file','ثبت گروهی نمرات','کد ملی، نام درس، نوبت و نمرهٔ ۰ تا ۲۰','کد ملی،درس،نوبت،نمره\n۰۰۱۰۰۰۰۰۰۱،ریاضی،نوبت اول،۱۸٫۵')+'</div>';
}
function importCard(kind,i,title,sub,example){
  return '<section class="card setting-card"><div class="setting-title">'+tile(i,kind==='grades'?'mint':'')+'<div><h2>'+title+'</h2><p>'+sub+'</p></div></div><form data-form="import" data-kind="'+kind+'" class="stack"><label class="field">فایل فهرست<input type="file" name="file" accept=".csv,.tsv,.txt,text/csv,text/plain"><small>فایل CSV، TSV یا متن با کدگذاری UTF-8 و حداکثر ۳۰۰ ردیف</small></label><label class="field">یا ورود مستقیم فهرست<textarea name="text" rows="4" placeholder="'+e(example)+'"></textarea></label><div data-form-message hidden></div><div class="form-actions">'+submit(kind==='students'?'ثبت دانش‌آموزان':'ثبت نمرات','upload')+'</div></form></section>';
}
function profile(){
  return headline(pageNames.profile,'اطلاعات حساب کاربری و تغییر رمز عبور')+'<div class="setting-grid"><section class="card setting-card"><div class="setting-title">'+avatar(me(),true)+'<div><h2>'+e(me().full_name)+'</h2><p>'+e(roleLabel())+'</p></div></div>'+table(['مشخصه','مقدار'],'<tr><td>نام کاربری</td><td><span class="ltr">'+e(me().username)+'</span></td></tr>'+(me().class_name?'<tr><td>کلاس</td><td>'+e(me().class_name)+'</td></tr>':''))+'</section><section class="card setting-card"><div class="setting-title">'+tile('key')+'<div><h2>تغییر رمز عبور</h2></div></div><form data-form="password" class="stack"><label class="field">رمز عبور فعلی<input type="password" name="old" dir="ltr" autocomplete="current-password" required maxlength="72"></label><label class="field">رمز عبور جدید<input type="password" name="new_password" dir="ltr" autocomplete="new-password" minlength="8" maxlength="72" required><small>حداقل ۸ نویسه</small></label><label class="field">تکرار رمز عبور جدید<input type="password" name="confirm" dir="ltr" autocomplete="new-password" required maxlength="72"></label><div data-form-message hidden></div><div class="form-actions">'+submit('ذخیرهٔ رمز عبور','key')+'</div></form></section></div>';
}
function updateList(){
  const result=document.querySelector('#list-results');
  const fn={students:peopleResults,delays:()=>delayResults(false),myDelays:()=>delayResults(true),reports:reportResults}[state.page];
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
  return modalFrame('ثبت تأخیر جدید',modes+'<form data-form="delay"><fieldset class="stack delay-fields">'+(multipleDates?people+dates:dates+people)+
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
  let details=delayTable(records,false,false,isAdmin());
  if(tab==='grades'){
    details=gradesError?'<div class="notice error">'+e(gradesError)+'</div>':!grades?'<div class="notice" role="status">در حال دریافت نمرات…</div>':
      table(['درس','نوبت','نمره'],grades.map(g=>'<tr><td>'+e(g.subject)+'</td><td>'+e(g.term)+'</td><td>'+fa(g.score)+'</td></tr>').join('')||empty('هنوز نمره‌ای ثبت نشده است.',3));
  }
  return modalFrame('پروندهٔ دانش‌آموز',profileInfo+tabs+details);
}
function delayChangeEditor(){
  const modal=state.modal;
  const original=modal.original;
  const person=student(original.student_id);
  const correcting=modal.type==='editDelay';
  const originalEntry='<p class="notice">ثبت فعلی '+e(person?.full_name??'')+' · <span class="ltr">'+e(showDate(original.date_on))+'</span></p>';
  const details=correcting?delayPeople(modal.selection,false)+delayDates(modal.selection,false):
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
    const describe=item=>e(item.full_name)+' · <span class="ltr">'+e(showDate(item.date_on))+'</span>';
    const date=new Intl.DateTimeFormat('fa-IR-u-ca-persian',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Tehran'}).format(new Date(entry.changed_at));
    return '<article class="audit-entry"><h3>'+e(entry.action==='correct'?'اصلاح تأخیر':'لغو تأخیر')+'</h3><small>'+e(entry.changed_by_name)+' · '+e(date)+'</small>'+
      '<p>ثبت قبلی '+describe(entry.before_entry)+'</p>'+(entry.after_entry?'<p>ثبت جایگزین '+describe(entry.after_entry)+'</p>':'')+'<p>دلیل '+e(entry.reason)+'</p></article>';
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
function renderModal(){
  const methods={editDelay:delayChangeEditor,cancelDelay:delayChangeEditor,history:delayHistoryModal,revokeGate:revokeGateModal,reportDate:reportDateModal,delay:delayModal,appeal:appealModal,review:reviewModal,gate:gateModal,person:personModal,date:()=>modalFrame('فیلتر تاریخ گزارش',calendar(state.modal.visible,new Set([state.modal.selected])))};
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
async function writeModal(action,payload,message){
  await backend().act(action,payload);
  closeModal();
  notify(message);
  try {await reload();}
  catch(error){notify(friendly(error),'error');}
}
async function saveAdminModal(request,message){
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
    const fields=form.querySelector('fieldset');
    fields.disabled=true;
    modal.saving=true;
    try {
      const {added,skipped}=await backend().registerDelays([...people],[...dates],data.get('note'));
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
  'update-delay':(form,data)=>{
    const m=state.modal;
    const correcting=m.type==='editDelay';
    const pupil=correcting?[...m.selection.people][0]:null;
    const day=correcting?[...m.selection.dates][0]:null;
    if(correcting&&!pupil) throw new Error('دانش‌آموز را انتخاب کنید.');
    const request=backend().updateDelay(m.original.id,correcting?'correct':'cancel',data.get('change_reason'),pupil,day);
    return saveAdminModal(request,correcting?'تأخیر اصلاح شد.':'تأخیر لغو شد.');
  },
  'revoke-gate':()=>{
    const {person}=state.modal;
    return saveAdminModal(backend().revokeGate(person.id,person.gate_assigned_at),'دسترسی نماینده لغو شد.');
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
  state.mode='demo';state.page='dashboard';state.photos={};
  resetFilters();await reload();
}
function leave(){
  if(state.mode==='live') void live.signOut();
  state.loadId++;state.mode='login';state.page='dashboard';state.data=null;state.photos={};
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
  const selection=()=>({people:new Set(studentId?[studentId]:[]),dates:new Set(),visible:today(),calendar:true,query:'',note:''});
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
  if(!isAdmin()) return;
  const original=state.data.delays.find(delay=>delay.id===id&&!delay.cancelled_at);
  if(!original) return;
  const selection={people:new Set([original.student_id]),dates:new Set([original.date_on]),visible:original.date_on,calendar:false,query:''};
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
  menu:()=>{state.menu=!state.menu;render();document.querySelector(state.menu?'#sidebar .nav-item':'.mobile-toggle')?.focus();},
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
  'toggle-calendar':()=>{
    const selection=delaySelection();
    selection.calendar=!selection.calendar;
    renderDelayAndFocus('[data-action="toggle-calendar"]');
  },
  'month-prev':()=>changeModalDate(-1),
  'month-next':()=>changeModalDate(1),
  'pick-day':id=>{
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
      selection.people=new Set([id]);
      renderDelayAndFocus('[data-action="toggle-calendar"]');
    }
  }

};
document.addEventListener('click',async event=>{
  const control=event.target.closest('button');
  if(!control||control.disabled||(state.modal?.saving&&dialog.contains(control))) return;
  if(control.dataset.page){setPage(control.dataset.page);return;}
  const run=actions[control.dataset.action];
  if(!run) return;
  try{await run(control.dataset.id);}
  catch(error){notify(friendly(error),'error');}
});
document.addEventListener('input',event=>{
  if(event.target.id==='search-people'){
    state.query=event.target.value;state.pageIndex=0;updateList();
  }else if(event.target.id==='delay-people-search'){
    const selection=delaySelection();
    selection.query=event.target.value;
    dialog.querySelector('#delay-person-results').innerHTML=delayPeopleOptions(selection);
  }else if(event.target.name==='note'&&state.modal?.type==='delay') delaySelection().note=event.target.value;
  else if(event.target.name==='change_reason'&&['editDelay','cancelDelay'].includes(state.modal?.type)) state.modal.reason=event.target.value;
});
document.addEventListener('change',async event=>{
  if(event.target.id==='class-filter'){state.className=event.target.value;state.pageIndex=0;updateList();}
  if(event.target.id==='demo-role') await enterDemo(event.target.value);
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&state.menu&&!dialog.open){state.menu=false;render();document.querySelector('.mobile-toggle')?.focus();}
});
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
void start();
