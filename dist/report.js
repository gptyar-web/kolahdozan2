import {active,classYear,dayParts,escape as e,fa,monthStart,school,shift,showDate,today} from './domain.js?v=delay-management';

const dateColumns=20;
const rowsPerPage=40;
let sheetJS;

export function reportPeriod(mode,day=today()){
  if(mode==='week'){
    const weekday=new Date(day+'T12:00:00Z').getUTCDay();
    return {start:shift(day,-((weekday+1)%7)),end:day};
  }
  return mode==='month'?{start:monthStart(day),end:day}:{start:'',end:''};
}

export function reportDate(iso,{monthFirst=false}={}){
  const {day,month}=dayParts(iso);
  return fa((monthFirst?[month,day]:[day,month]).map(value=>String(value).padStart(2,'0')).join('/'));
}

export function indexClassMoves(moves){
  const byStudent=new Map();
  for(const move of moves){
    if(!byStudent.has(move.student_id)) byStudent.set(move.student_id,[]);
    byStudent.get(move.student_id).push(move);
  }
  for(const moves of byStudent.values()) moves.sort((a,b)=>a.effective_on.localeCompare(b.effective_on));
  return byStudent;
}

export function studentClassOn(person,date,moves=[]){
  const change=moves.find(move=>move.effective_on>date);
  return change?.previous_class??moves.at(-1)?.new_class??person.class_name;
}

function reportClasses(person,moves,start,end){
  if(!start&&!end) return [person.class_name];
  const from=start||'1900-01-01';
  const to=end||today();
  return [studentClassOn(person,from,moves),...moves.filter(m=>m.effective_on>from&&m.effective_on<=to).map(m=>m.new_class)];
}

export function reportRows(people,delays,start='',end='',options={}){
  const {classMoves=new Map(),include=()=>true}=options;
  const byStudent=new Map();
  for(const delay of active(delays)){
    if((start&&delay.date_on<start)||(end&&delay.date_on>end)) continue;
    if(!byStudent.has(delay.student_id)) byStudent.set(delay.student_id,[]);
    byStudent.get(delay.student_id).push(delay.date_on);
  }
  return people.flatMap(person=>{
    const history=classMoves.get(person.id)??[];
    const groups=new Map(reportClasses(person,history,start,end).map(name=>[name,[]]));
    for(const date of byStudent.get(person.id)??[]){
      const name=studentClassOn(person,date,history);
      if(!groups.has(name)) groups.set(name,[]);
      groups.get(name).push(date);
    }
    return [...groups].filter(([name])=>include(person,name))
      .map(([name,dates])=>({person:{...person,class_name:name},dates:dates.sort()}));
  });
}

function classes(rows){
  const groups=new Map();
  for(const row of rows){
    const title=row.person.class_name||'بدون کلاس';
    if(!groups.has(title)) groups.set(title,[]);
    groups.get(title).push(row);
  }
  const collator=new Intl.Collator('fa',{numeric:true});
  return [...groups].sort(([a],[b])=>collator.compare(a,b));
}

function printClass(title,rows,period,year){
  const sheets=[];
  const maxDates=Math.max(...rows.map(row=>row.dates.length));
  for(let col=0;col<Math.max(1,maxDates);col+=dateColumns){
    for(let offset=0;offset<rows.length;offset+=rowsPerPage){
      const pageRows=rows.slice(offset,offset+rowsPerPage);
      const headerCells=Array.from({length:dateColumns},(_,i)=>'<th scope="col">'+fa(col+i+1)+'</th>').join('');
      const entries=Array.from({length:rowsPerPage},(_,i)=>{
        const row=pageRows[i];
        return '<tr><td class="ledger-name">'+e(row?.person.full_name)+'</td>'+
          Array.from({length:dateColumns},(_,j)=>'<td class="ledger-date" dir="ltr">'+(row?.dates[col+j]?reportDate(row.dates[col+j],{monthFirst:true}):'')+'</td>').join('')+'</tr>';
      }).join('');
      sheets.push('<section class="ledger-page"><table class="ledger"><colgroup><col class="ledger-name-col"><col span="'+dateColumns+'"></colgroup><thead>'+
        '<tr><th colspan="21" class="ledger-title"><strong>باسمه تعالی</strong><div><span>دفتر ثبت تأخیر دانش‌آموزان</span><span>'+e(school)+'</span><span>سال تحصیلی '+e(year)+'</span><span>کلاس '+e(fa(title))+'</span></div></th></tr>'+
        '<tr><th scope="row">جلسات</th>'+headerCells+'</tr>'+
        '<tr class="ledger-period"><th scope="row">تاریخ</th><td colspan="20">'+e(period)+'</td></tr>'+
        '<tr><th scope="col">نام و نام خانوادگی</th><th colspan="20" scope="colgroup">ماه / روز</th></tr></thead><tbody>'+entries+'</tbody></table></section>');
    }
  }
  return sheets.join('');
}

export function printLedger(rows,period,year=classYear()){
  const groups=classes(rows);
  if(!groups.length) return '<h1>فهرست تأخیرها</h1><p>دانش‌آموزی برای نمایش وجود ندارد.</p>';
  const cover=groups.length>1?'<section class="ledger-cover"><h1>لیست آموزشگاه جهت ثبت تأخیر دانش‌آموزان<br>'+e(school)+'</h1><p>سال تحصیلی '+e(year)+'</p><p>'+e(period)+'</p></section>':'';
  return cover+groups.map(([title,students])=>printClass(title,students,period,year)).join('');
}

function loadSheetJS(){
  if(window.XLSX) return Promise.resolve(window.XLSX);
  if(!sheetJS){
    sheetJS=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=new URL('./vendor/xlsx-0.20.3.min.js',import.meta.url).href;
      script.onload=()=>window.XLSX?resolve(window.XLSX):reject(new Error('KH2_XLSX_UNAVAILABLE'));
      script.onerror=()=>{script.remove();reject(new Error('KH2_XLSX_UNAVAILABLE'));};
      document.head.append(script);
    }).catch(error=>{sheetJS=null;throw error;});
  }
  return sheetJS;
}

export function reportWorkbook(xlsx,rows,period){
  const book=xlsx.utils.book_new();
  for(const [title,students] of classes(rows)){
    const maxDates=Math.max(1,...students.map(row=>row.dates.length));
    const columns=['نام و نام خانوادگی','کلاس','تعداد تأخیر',...Array.from({length:maxDates},(_,i)=>'تاریخ '+fa(i+1))];
    const data=[[school+' · '+period],columns,...students.map(({person,dates})=>[
      person.full_name,person.class_name,dates.length,...dates.map(reportDate)
    ])];
    const sheet=xlsx.utils.aoa_to_sheet(data);
    sheet['!cols']=[{wch:30},{wch:18},{wch:15},...Array.from({length:maxDates},()=>({wch:11}))];
    sheet['!merges']=[{s:{r:0,c:0},e:{r:0,c:columns.length-1}}];
    sheet['!autofilter']={ref:xlsx.utils.encode_range({s:{r:1,c:0},e:{r:data.length-1,c:columns.length-1}})};
    const safeTitle=title.replace(/[\\/?*\[\]:]/g,' ').trim().slice(0,22);
    xlsx.utils.book_append_sheet(book,sheet,safeTitle?'کلاس '+safeTitle:'کلاس',true);
  }
  book.Workbook={Views:[{RTL:true}]};
  return book;
}

export async function downloadReport(rows,period){
  const xlsx=await loadSheetJS();
  xlsx.writeFileXLSX(reportWorkbook(xlsx,rows,period),'school-delays-'+today()+'.xlsx',{compression:true});
}
