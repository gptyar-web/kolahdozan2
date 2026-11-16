import * as live from './api.js';
import * as demo from './demo.js';
import { icon } from './icons.js';
import { active,calendarDays,classYear,dayParts,digits,escape as e,fa,importRows,matches,monthStart,school,shift,showDate,today } from './domain.js';

const app=document.querySelector('#app');
const dialog=document.querySelector('#modal');
const toast=document.querySelector('#toast');
const roleNames={admin:'مدیر سامانه',gate:'نمایندهٔ درب مدرسه',student:'دانش‌آموز'};
const statusNames={active:'تأخیر ثبت‌شده',pending:'در انتظار بررسی',approved:'اعتراض پذیرفته شد',rejected:'اعتراض رد شد'};
const pageNames={dashboard:'پیشخوان',students:'دانش‌آموزان',delays:'ثبت و سوابق تأخیر',appeals:'اعتراض‌ها',reports:'گزارش و چاپ',staff:'نمایندگان درب مدرسه',manage:'ثبت گروهی',profile:'پروفایل من'};
const pageIcons={dashboard:'home',students:'users',delays:'clock',appeals:'message',reports:'report',staff:'shield',manage:'upload',profile:'user'};
const state={mode:'login',page:'dashboard',data:null,photos:{},query:'',className:'',filterDate:'',pageIndex:0,menu:false,modal:null,appealFilter:'all',loadId:0};
let toastTimer;
let refreshTimer;
let focusAfterModal;
const limit=8;
const logo='./assets/favicon.svg';
const art='./assets/school-clock.webp';
const backend=()=>state.mode==='demo'?demo:live;
const me=()=>state.data.me;
const isAdmin=()=>me().role==='admin';
const isStudent=()=>me().role==='student';
const allStudents=()=>state.data.students;
const student=id=>allStudents().find(p=>p.id===id);
const rowsFor=id=>state.data.delays.filter(row=>row.student_id===id);
const allowed=()=>isStudent()?['dashboard','delays','appeals','profile']:isAdmin()?['dashboard','students','delays','appeals','reports','staff','manage','profile']:['dashboard','students','delays','appeals','reports','profile'];
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
  Object.assign(state,{query:'',className:'',filterDate:'',pageIndex:0,appealFilter:'all',menu:false});
}
async function fetchData(){
  const id=++state.loadId;
  const data=await backend().overview();
  if(id!==state.loadId) return false;
  state.data=data;
  if(!allowed().includes(state.page)) state.page='dashboard';
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
  const count=key==='appeals'?state.data.appeals.filter(a=>a.status==='pending').length:0;
  return '<button type="button" class="nav-item'+(state.page===key?' active':'')+'" data-page="'+key+'"'+(state.page===key?' aria-current="page"':'')+'>'+icon(pageIcons[key])+e(key==='delays'&&isStudent()?'تأخیرهای من':pageNames[key])+(count?'<span class="nav-count">'+fa(count)+'</span>':'')+'</button>';
}
function render(){
  if(!state.data){login();return;}
  const pageLabel=state.page==='delays'&&isStudent()?'تأخیرهای من':pageNames[state.page];
  const demoBadge=state.mode==='demo'?'<span class="badge">نسخهٔ آزمایشی</span>':'';
  const switcher=state.mode==='demo'?'<div class="nav-group"><p class="nav-label">تغییر نقش آزمایشی</p><select id="demo-role" aria-label="نقش آزمایشی">'+Object.entries(roleNames).map(([id,title])=>'<option value="'+id+'"'+hasValue(me().role,id)+'>'+e(title)+'</option>').join('')+'</select></div>':'';
  app.innerHTML='<div class="layout'+(state.menu?' menu-open':'')+'"><button id="screen-mask" type="button" data-action="menu" aria-label="بستن منو"></button><aside id="sidebar" class="sidebar'+(state.menu?' open':'')+'" aria-label="منوی سامانه">'+branding()+'<nav><div class="nav-group"><p class="nav-label">منوی اصلی</p>'+allowed().filter(x=>!['staff','manage','profile'].includes(x)).map(nav).join('')+'</div><div class="nav-group"><p class="nav-label">'+(isAdmin()?'مدیریت سامانه':'حساب کاربری')+'</p>'+allowed().filter(x=>['staff','manage','profile'].includes(x)).map(nav).join('')+'</div></nav>'+switcher+'<div class="sidebar-bottom"><div class="school-term">'+tile('calendar')+'<div><strong>سال تحصیلی</strong><small>'+classYear()+'</small></div></div><button class="nav-item" type="button" data-action="logout">'+icon('logout')+'خروج از حساب</button></div></aside><header class="topbar"><div class="crumb">'+button('','menu','data-action="menu" aria-label="منو" aria-controls="sidebar" aria-expanded="'+state.menu+'"','icon mobile-toggle')+'<span class="muted">پنل '+e(roleNames[me().role])+'</span>'+icon('left')+'<span>'+e(pageLabel)+'</span></div><div class="top-actions">'+demoBadge+'<span class="top-date">'+icon('calendar')+e(showDate(today(),'long'))+'</span><span class="top-divider"></span><details class="identity"><summary aria-label="منوی حساب کاربری">'+avatar(me())+'<span class="identity-label"><strong>'+e(me().full_name)+'</strong><small>'+e(roleNames[me().role])+'</small></span>'+icon('down')+'</summary><div class="account-menu">'+nav('profile')+'<button class="nav-item" type="button" data-action="logout">'+icon('logout')+'خروج از حساب</button></div></details></div></header><main class="main" id="main-content" tabindex="-1">'+({
    dashboard,students,delays,appeals,reports,staff,manage,profile
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
function delayTable(records,withStudent=true,withAppeal=false){
  const headers=[...(withStudent?['دانش‌آموز','کلاس']:[]),'تاریخ تأخیر','ثبت‌کننده','وضعیت',...(withAppeal?['عملیات']:[])];
  return table(headers,records.map(row=>{
    const person=student(row.student_id);
    return '<tr>'+(withStudent?'<td>'+studentCell(person)+'</td><td>'+e(person?.class_name??'—')+'</td>':'')+'<td><span class="ltr">'+e(showDate(row.date_on))+'</span>'+(row.note?'<br><small class="muted">'+e(row.note)+'</small>':'')+'</td><td>'+e(row.recorder_name)+'</td><td>'+showStatus(row.status)+'</td>'+(withAppeal?'<td>'+(row.status==='active'?button('ثبت اعتراض','message','data-action="new-appeal" data-id="'+e(row.id)+'"','compact soft'):'—')+'</td>':'')+'</tr>';
  }).join('')||empty('سابقه‌ای برای نمایش وجود ندارد.',headers.length));
}
function dashboard(){
  const {delays,appeals,students:people}=state.data;
  const date=today(), month=monthStart(date), current=active(delays);
  const countToday=current.filter(d=>d.date_on===date).length;
  const countMonth=current.filter(d=>d.date_on>=month).length;
  const waiting=appeals.filter(a=>a.status==='pending').length;
  const stats=isStudent()?[
    ['همهٔ تأخیرها',current.length,'clock','peach','از ابتدای ثبت'],['تأخیرهای این ماه',countMonth,'calendar','blue',showDate(date,'month')],['اعتراض‌های باز',waiting,'message','mint','در انتظار بررسی'],['اعتراض‌های پذیرفته',appeals.filter(a=>a.status==='approved').length,'check','','از ابتدای ثبت']
  ]:[
    ['کل دانش‌آموزان',people.length,'users','','دانش‌آموزان ثبت‌شده'],['تأخیرهای امروز',countToday,'clock','peach','در روز جاری'],['تأخیرهای این ماه',countMonth,'calendar','blue',showDate(date,'month')],['اعتراض‌های باز',waiting,'message','mint','در انتظار بررسی']
  ];
  const actions=isStudent()?button('ثبت اعتراض','message','data-action="new-appeal"','primary'):
    button('چاپ گزارش','print','data-action="print"')+button('ثبت تأخیر جدید','plus','data-action="new-delay"','primary');
  const quick=isStudent()?[['clock','مشاهدهٔ تأخیرها','تاریخ و وضعیت هر تأخیر','data-page="delays"'],['message','ثبت اعتراض','انتخاب تاریخ از سوابق تأخیر','data-action="new-appeal"'],['user','پروفایل من','مشاهده اطلاعات و تغییر رمز','data-page="profile"']]:
    [['plusUser',isAdmin()?'ثبت گروهی دانش‌آموزان':'ثبت تأخیر دانش‌آموز',isAdmin()?'ورود فهرست دانش‌آموزان، عکس و نمرات':'انتخاب دانش‌آموز و تاریخ',isAdmin()?'data-page="manage"':'data-action="new-delay"'],['users','جست‌وجوی دانش‌آموز','جست‌وجو با نام یا کلاس','data-page="students"'],['print','گزارش و چاپ','فهرست دانش‌آموزان و تاریخ‌های تأخیر','data-page="reports"']];
  const intro=isStudent()?'تأخیرهای خود را ببینید و وضعیت اعتراض‌ها را پیگیری کنید.':'وضعیت تأخیرها، اعتراض‌ها و پرونده‌های دانش‌آموزان را بررسی کنید.';
  const statHTML='<section class="stats" aria-label="خلاصهٔ وضعیت">'+stats.map(([name,value,i,color,note])=>'<article class="stat"><div class="stat-top"><span>'+e(name)+'</span>'+tile(i,color)+'</div><strong>'+fa(value)+'</strong><small>'+e(note)+'</small></article>').join('')+'</section>';
  const quickHTML='<div class="quick-grid">'+quick.map(([i,title,sub,attrs],index)=>'<button type="button" class="quick-row" '+attrs+'>'+tile(i,['','blue','peach'][index])+'<span><strong>'+e(title)+'</strong><small>'+e(sub)+'</small></span>'+icon('left')+'</button>').join('')+'</div>';
  return headline('پیشخوان',isStudent()?'خلاصهٔ وضعیت حضور و اعتراض‌های شما':'خلاصهٔ وضعیت حضور و تأخیر دانش‌آموزان',actions)+
    '<section class="hero"><img class="hero-art" src="'+art+'" alt=""><div class="hero-copy"><span class="hero-tag">'+icon('cap')+e(roleNames[me().role])+'</span><h2>'+e(isStudent()?'سلام، '+me().full_name:'به پیشخوان مدرسه خوش آمدید')+'</h2><p>'+intro+'</p></div></section>'+statHTML+
    '<div class="insights">'+card('روند تأخیرها','تعداد تأخیرهای ثبت‌شده در هر روز',chart(current),'<span class="chart-range">۷ روز اخیر</span>')+card('دسترسی سریع','',quickHTML)+'</div>'+
    card('آخرین تأخیرهای ثبت‌شده','',delayTable(delays.slice(0,5),!isStudent(),false),button('مشاهدهٔ همه','left','data-page="delays"','ghost compact'));
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
    return '<tr><td>'+studentCell(person)+'</td><td>'+e(person.class_name)+'</td>'+(isAdmin()?'<td><span class="ltr">'+fa(person.username)+'</span></td>':'')+'<td>'+badge(fa(active(rowsFor(person.id)).length)+' تأخیر')+'</td><td><div class="form-actions">'+button('مشاهدهٔ پرونده','left','data-action="person" data-id="'+id+'"','ghost compact')+button('ثبت تأخیر','plus','data-action="new-delay" data-id="'+id+'"','soft compact')+'</div></td></tr>';
  }).join('')||empty('دانش‌آموزی با این مشخصات پیدا نشد.',headers.length))+footer;
}
function delays(){
  const own=isStudent();
  const actions=own?button('ثبت اعتراض','message','data-action="new-appeal"','primary'):
    button('چاپ گزارش','print','data-action="print"')+button('ثبت تأخیر جدید','plus','data-action="new-delay"','primary');
  return headline(own?'تأخیرهای من':pageNames.delays,own?'تاریخ‌های ثبت‌شده و وضعیت اعتراض هر تأخیر':'تاریخ، ثبت‌کننده و وضعیت تأخیر دانش‌آموزان',actions)+
    '<section class="card">'+(!own?peopleFilter(true):'')+'<div id="list-results">'+delayResults()+'</div></section>';
}
function delayResults(){
  const [records,footer]=paginated(selectedDelays());
  return delayTable(records,!isStudent(),isStudent())+footer;
}
function reports(){
  return headline(pageNames.reports,'چاپ تاریخ‌های تأخیر روبه‌روی نام هر دانش‌آموز',button('چاپ فهرست','print','data-action="print"','primary'))+
    '<section class="card">'+peopleFilter(true)+'<div id="list-results">'+reportResults()+'</div></section>';
}
function reportRows(){
  const dates=new Map();
  for(const delay of active(selectedDelays())){
    if(!dates.has(delay.student_id)) dates.set(delay.student_id,[]);
    dates.get(delay.student_id).push(delay.date_on);
  }
  return filteredStudents().map(person=>({person,dates:dates.get(person.id)??[]}));
}
function reportTable(rows,printing){
  return table(['دانش‌آموز','کلاس','تعداد تأخیر','تاریخ‌های تأخیر'],rows.map(({person,dates})=>
    '<tr><td>'+(printing?e(person.full_name):studentCell(person))+'</td><td>'+e(person.class_name)+'</td><td>'+fa(dates.length)+'</td><td>'+(dates.length?dates.map(day=>'<span class="ltr">'+e(showDate(day))+'</span>').join('، '):'—')+'</td></tr>').join('')||empty('دانش‌آموزی برای نمایش وجود ندارد.',4));
}
function reportResults(){
  const [rows,footer]=paginated(reportRows());
  return reportTable(rows,false)+footer;
}
function printReport(){
  const metadata=[state.className||'همهٔ کلاس‌ها',state.filterDate?showDate(state.filterDate):'همهٔ تاریخ‌ها',state.query?'جست‌وجو «'+state.query+'»':''].filter(Boolean).join(' · ');
  document.querySelector('#print-area').innerHTML='<h1>فهرست تأخیرها | '+school+'</h1><p>'+e(metadata)+' · تاریخ چاپ '+e(showDate(today()))+'</p>'+reportTable(reportRows(),true);
  window.print();
}
function appeals(){
  const list=state.data.appeals.filter(a=>state.appealFilter==='all'||a.status===state.appealFilter);
  const filters='<div class="tabs" aria-label="وضعیت اعتراض">'+Object.entries({all:'همه',pending:'در انتظار بررسی',approved:'پذیرفته‌شده',rejected:'ردشده'}).map(([key,title])=>button(title,'','data-action="appeal-filter" data-id="'+key+'" aria-pressed="'+(state.appealFilter===key)+'"','compact')).join('')+'</div>';
  const cards=list.map(a=>{
    const name=isStudent()?'اعتراض به تأخیر':student(a.student_id)?.full_name??'—';
    return '<article class="card appeal-card"><div class="appeal-head"><div><h2>'+e(name)+'</h2><small>تاریخ تأخیر <span class="ltr">'+e(showDate(a.date_on))+'</span></small></div>'+showStatus(a.status)+'</div><p>'+e(a.reason)+'</p>'+
      (a.response?'<div class="appeal-response"><strong>پاسخ بررسی</strong><p>'+e(a.response)+'</p></div>':'')+
      (!isStudent()&&a.status==='pending'?'<div class="form-actions" style="margin-top:10px">'+button('بررسی اعتراض','check','data-action="review" data-id="'+e(a.id)+'"','soft')+'</div>':'')+'</article>';
  }).join('');
  return headline(pageNames.appeals,isStudent()?'ثبت اعتراض روی یکی از تاریخ‌های تأخیر و مشاهدهٔ نتیجه':'مشاهدهٔ درخواست‌ها و ثبت نتیجهٔ بررسی',isStudent()?button('ثبت اعتراض','message','data-action="new-appeal"','primary'):'')+filters+'<div class="appeal-list">'+(cards||'<section class="card">'+empty('اعتراضی در این وضعیت وجود ندارد.')+'</section>')+'</div>';
}
function staff(){
  const rows=state.data.staff.map(person=>'<tr><td>'+studentCell(person)+'</td><td><span class="ltr">'+e(person.username)+'</span></td><td>'+e(showDate(person.created_at.slice(0,10)))+'</td><td>'+badge('نمایندهٔ درب مدرسه')+'</td></tr>').join('');
  return headline(pageNames.staff,'حساب‌های نمایندگان ثبت‌کنندهٔ تأخیر',button('افزودن نماینده','plusUser','data-action="add-gate"','primary'))+
    card('فهرست نمایندگان','',table(['نام و نام خانوادگی','نام کاربری','تاریخ ثبت','نقش'],rows||empty('هنوز نماینده‌ای ثبت نشده است.',4)));
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
  return headline(pageNames.profile,'اطلاعات حساب کاربری و تغییر رمز عبور')+'<div class="setting-grid"><section class="card setting-card"><div class="setting-title">'+avatar(me(),true)+'<div><h2>'+e(me().full_name)+'</h2><p>'+e(roleNames[me().role])+'</p></div></div>'+table(['مشخصه','مقدار'],'<tr><td>نام کاربری</td><td><span class="ltr">'+e(me().username)+'</span></td></tr>'+(me().class_name?'<tr><td>کلاس</td><td>'+e(me().class_name)+'</td></tr>':''))+'</section><section class="card setting-card"><div class="setting-title">'+tile('key')+'<div><h2>تغییر رمز عبور</h2></div></div><form data-form="password" class="stack"><label class="field">رمز عبور فعلی<input type="password" name="old" dir="ltr" autocomplete="current-password" required maxlength="72"></label><label class="field">رمز عبور جدید<input type="password" name="new_password" dir="ltr" autocomplete="new-password" minlength="8" maxlength="72" required><small>حداقل ۸ نویسه</small></label><label class="field">تکرار رمز عبور جدید<input type="password" name="confirm" dir="ltr" autocomplete="new-password" required maxlength="72"></label><div data-form-message hidden></div><div class="form-actions">'+submit('ذخیرهٔ رمز عبور','key')+'</div></form></section></div>';
}
function updateList(){
  const result=document.querySelector('#list-results');
  const fn={students:peopleResults,delays:delayResults,reports:reportResults}[state.page];
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
  focusAfterModal=document.activeElement;
  state.modal={type,...data};
  renderModal();
  dialog.showModal();
}
function closeModal(){
  if(dialog.open) dialog.close();
}
dialog.addEventListener('close',()=>{
  state.modal=null;
  if(focusAfterModal?.isConnected) focusAfterModal.focus();
});
function modalFrame(title,body){
  return '<header class="modal-head"><h2 id="modal-title">'+e(title)+'</h2>'+button('','close','data-action="close" aria-label="بستن پنجره"','icon')+'</header><div class="modal-body">'+body+'</div>';
}
function calendar(){
  const {visible,selected}=state.modal;
  const {blanks,days}=calendarDays(visible);
  const title=e(showDate(visible,'month'));
  return '<div class="calendar"><div class="calendar-head">'+button('','right','data-action="month-prev" aria-label="ماه قبل"','icon compact')+'<strong>'+title+'</strong>'+
    button('','left','data-action="month-next" aria-label="ماه بعد"'+(monthStart(visible)>=monthStart(today())?' disabled':''),'icon compact')+'</div><div class="calendar-grid">'+['ش','ی','د','س','چ','پ','ج'].map(c=>'<small aria-hidden="true">'+c+'</small>').join('')+'<span></span>'.repeat(blanks)+days.map(day=>'<button type="button" data-action="pick-day" data-id="'+day+'" aria-label="'+e(showDate(day,'long'))+'" aria-pressed="'+(selected===day)+'"'+(day>today()?' disabled':'')+'>'+fa(dayParts(day).day)+'</button>').join('')+'</div></div>';
}
function delayModal(){
  const m=state.modal;
  const selected=student(m.studentId);
  const options=allStudents().filter(person=>matches(person,m.query??'')).slice(0,10);
  const people=selected?'<div class="form-actions">'+avatar(selected)+'<strong>'+e(selected.full_name)+'</strong><span class="muted">'+e(selected.class_name)+'</span>'+button('تغییر دانش‌آموز','users','data-action="clear-person"','compact')+'</div>':
    '<label class="field">دانش‌آموز<input type="search" id="delay-people-search" placeholder="نام یا کلاس را بنویسید" value="'+e(m.query??'')+'"></label><div id="delay-person-results" class="person-options">'+options.map(person=>button(person.full_name+' · '+person.class_name,'user','data-action="select-person" data-id="'+e(person.id)+'"','compact')).join('')+(options.length?'':'<span class="muted">دانش‌آموزی پیدا نشد.</span>')+'</div>';
  return modalFrame('ثبت تأخیر جدید','<form data-form="delay" class="stack">'+people+'<div><div class="field">تاریخ تأخیر</div>'+button(m.selected?showDate(m.selected,'long'):'انتخاب تاریخ','calendar','data-action="toggle-calendar" aria-expanded="'+m.calendar+'"')+(m.calendar?calendar():'')+'</div><label class="field">یادداشت (اختیاری)<textarea name="note" rows="2" maxlength="400">'+e(m.note??'')+'</textarea></label><div data-form-message hidden></div><div class="form-actions">'+submit('ثبت تأخیر','check')+'</div></form>');
}
function appealModal(){
  const items=state.data.delays.filter(d=>d.status==='active');
  if(!items.length) return modalFrame('ثبت اعتراض',empty('تأخیر ثبت‌شده‌ای برای اعتراض وجود ندارد.'));
  return modalFrame('ثبت اعتراض','<form data-form="appeal" class="stack"><label class="field">تاریخ تأخیر<select name="delay_id" required><option value="">تاریخ را انتخاب کنید</option>'+items.map(d=>'<option value="'+e(d.id)+'"'+hasValue(d.id,state.modal.delayId)+'>'+e(showDate(d.date_on,'long'))+'</option>').join('')+'</select></label><label class="field">دلیل اعتراض<textarea name="reason" rows="4" minlength="5" maxlength="800" required></textarea></label><div data-form-message hidden></div><div class="form-actions">'+submit('ارسال اعتراض','message')+'</div></form>');
}
function reviewModal(){
  const appeal=state.data.appeals.find(a=>a.id===state.modal.id);
  return modalFrame('بررسی اعتراض','<form data-form="review" class="stack"><p class="notice">'+e(student(appeal.student_id)?.full_name??'')+' · '+e(showDate(appeal.date_on))+'<br>'+e(appeal.reason)+'</p><label class="field">نتیجه<select name="status" required><option value="">نتیجه را انتخاب کنید</option><option value="approved">پذیرش اعتراض و کسر تأخیر از گزارش</option><option value="rejected">رد اعتراض و حفظ تأخیر</option></select></label><label class="field">پاسخ به دانش‌آموز<textarea name="response" rows="4" minlength="2" maxlength="800" required></textarea></label><div data-form-message hidden></div><div class="form-actions">'+submit('ثبت نتیجه','check')+'</div></form>');
}
function gateModal(){
  return modalFrame('افزودن نمایندهٔ درب مدرسه','<form data-form="gate" class="stack"><label class="field">نام و نام خانوادگی<input name="full_name" required minlength="2" maxlength="120"></label><label class="field">نام کاربری<input name="username" dir="ltr" required pattern="[A-Za-z0-9][A-Za-z0-9._\\-]{2,47}"><small>۳ تا ۴۸ حرف یا رقم انگلیسی، نقطه، خط تیره و زیرخط</small></label><label class="field">رمز عبور<input name="password" dir="ltr" type="password" autocomplete="new-password" required minlength="8" maxlength="72"></label><div data-form-message hidden></div><div class="form-actions">'+submit('ثبت نماینده','plusUser')+'</div></form>');
}
function personModal(){
  const {id,tab,grades,gradesError}=state.modal;
  const p=student(id);
  const records=rowsFor(id);
  const profileInfo='<div class="setting-title">'+avatar(p,true)+'<div><h3>'+e(p.full_name)+'</h3><p>'+e(p.class_name)+(isAdmin()?' · کد ملی '+fa(p.username):'')+'</p><div style="margin-top:5px">'+badge(fa(active(records).length)+' تأخیر')+'</div></div></div>';
  const tabs='<div class="tabs">'+button('تاریخ‌های تأخیر','clock','data-action="person-tab" data-id="delays" aria-pressed="'+(tab==='delays')+'"','compact')+(isAdmin()?button('نمرات','file','data-action="person-tab" data-id="grades" aria-pressed="'+(tab==='grades')+'"','compact'):'')+'</div>';
  let details=delayTable(records,false,false);
  if(tab==='grades'){
    details=gradesError?'<div class="notice error">'+e(gradesError)+'</div>':!grades?'<div class="notice" role="status">در حال دریافت نمرات…</div>':
      table(['درس','نوبت','نمره'],grades.map(g=>'<tr><td>'+e(g.subject)+'</td><td>'+e(g.term)+'</td><td>'+fa(g.score)+'</td></tr>').join('')||empty('هنوز نمره‌ای ثبت نشده است.',3));
  }
  return modalFrame('پروندهٔ دانش‌آموز',profileInfo+tabs+details);
}
function renderModal(){
  const methods={delay:delayModal,appeal:appealModal,review:reviewModal,gate:gateModal,person:personModal,date:()=>modalFrame('فیلتر تاریخ گزارش',calendar())};
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
    const m=state.modal;
    if(!m.studentId) throw new Error('ابتدا دانش‌آموز را انتخاب کنید.');
    if(!m.selected) throw new Error('تاریخ تأخیر را از تقویم انتخاب کنید.');
    await writeModal('register_delay',{student_id:m.studentId,date_on:m.selected,note:data.get('note')},'تأخیر دانش‌آموز ثبت شد.');
  },
  appeal:(form,data)=>writeModal('send_appeal',Object.fromEntries(data),'اعتراض شما ارسال شد.'),
  review:(form,data)=>writeModal('review_appeal',{...Object.fromEntries(data),appeal_id:state.modal.id},'نتیجهٔ اعتراض ثبت شد.'),
  gate:(form,data)=>writeModal('add_gate',{...Object.fromEntries(data),username:data.get('username').trim().toLowerCase()},'حساب نماینده ثبت شد.')
};
document.addEventListener('submit',async event=>{
  const form=event.target;
  const run=forms[form.dataset.form??form.id];
  if(!run) return;
  event.preventDefault();
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
  const first=monthStart(state.modal.visible);
  state.modal.visible=offset<0?shift(first,-1):shift(first,calendarDays(first).days.length);
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
const actions={
  demo:()=>enterDemo(),
  logout:leave,
  retry:start,
  menu:()=>{state.menu=!state.menu;render();document.querySelector(state.menu?'#sidebar .nav-item':'.mobile-toggle')?.focus();},
  print:printReport,
  prev:()=>{state.pageIndex--;updateList();document.querySelector('#list-results .paging button:not(:disabled)')?.focus();},
  next:()=>{state.pageIndex++;updateList();document.querySelector('#list-results .paging button:last-child:not(:disabled), #list-results .paging button:first-child:not(:disabled)')?.focus();},
  'filter-date':()=>openModal('date',{visible:state.filterDate||today(),selected:state.filterDate}),
  'reset-date':()=>{state.filterDate='';state.pageIndex=0;render();},
  'new-delay':id=>openModal('delay',{studentId:id,visible:today(),selected:'',calendar:true}),
  'new-appeal':id=>openModal('appeal',{delayId:id}),
  'add-gate':()=>openModal('gate'),
  'appeal-filter':id=>{state.appealFilter=id;render();document.querySelector('[data-action="appeal-filter"][aria-pressed=true]')?.focus();},
  'person-tab':selectPersonTab,
  person:id=>openModal('person',{id,tab:'delays'}),
  review:id=>openModal('review',{id}),
  close:closeModal,
  'toggle-calendar':()=>{
    state.modal.calendar=!state.modal.calendar;renderModal();dialog.querySelector('[data-action="toggle-calendar"]')?.focus();
  },
  'month-prev':()=>changeModalDate(-1),
  'month-next':()=>changeModalDate(1),
  'pick-day':id=>{
    if(state.modal.type==='date'){state.filterDate=id;state.pageIndex=0;closeModal();render();document.querySelector('[data-action="filter-date"]')?.focus();return;}
    state.modal.selected=id;state.modal.calendar=false;renderModal();dialog.querySelector('[data-action="toggle-calendar"]')?.focus();
  },
  'clear-person':()=>{state.modal.studentId='';state.modal.query='';renderModal();dialog.querySelector('#delay-people-search')?.focus();},
  'select-person':id=>{state.modal.studentId=id;renderModal();dialog.querySelector('[data-action="toggle-calendar"]')?.focus();}
};
document.addEventListener('click',async event=>{
  const control=event.target.closest('button');
  if(!control||control.disabled) return;
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
    state.modal.query=event.target.value;
    const options=allStudents().filter(p=>matches(p,state.modal.query)).slice(0,10);
    dialog.querySelector('#delay-person-results').innerHTML=options.map(p=>button(p.full_name+' · '+p.class_name,'user','data-action="select-person" data-id="'+e(p.id)+'"','compact')).join('')||(state.modal.query?'<span class="muted">دانش‌آموزی پیدا نشد.</span>':'');
  }else if(event.target.name==='note'&&state.modal?.type==='delay') state.modal.note=event.target.value;
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
