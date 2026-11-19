const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
const persianDay = new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-latn', { year:'numeric', month:'numeric', day:'numeric', timeZone:'UTC' });
const persianLong = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { dateStyle:'full', timeZone:'UTC' });
const persianMonth = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month:'long', year:'numeric', timeZone:'UTC' });
const weekday = new Intl.DateTimeFormat('fa-IR', { weekday:'short', timeZone:'UTC' });
const tehranDate = new Intl.DateTimeFormat('en-CA', { year:'numeric', month:'2-digit', day:'2-digit', timeZone:'Asia/Tehran' });
export const school = 'دبیرستان شهید کلاهدوزان ۲';

export function digits(value) {
  return String(value ?? '').replace(/[۰-۹٠-٩]/g, char => Math.max(persianDigits.indexOf(char), arabicDigits.indexOf(char)));
}
export function fa(value) {
  return String(value ?? '').replace(/[0-9]/g, number => persianDigits[number]);
}
export function normalize(value) {
  return digits(value).replace(/[يى]/g,'ی').replace(/ك/g,'ک').replace(/[‌‍\s]+/g,' ').trim().toLowerCase();
}
const nameCollator = new Intl.Collator('fa', {sensitivity:'base',numeric:true});
export function compareStudentNames(left,right) {
  const leftName=normalize(left?.full_name);
  const rightName=normalize(right?.full_name);
  const leftFamily=normalize(left?.family_name)||leftName.split(' ').at(-1);
  const rightFamily=normalize(right?.family_name)||rightName.split(' ').at(-1);
  return nameCollator.compare(leftFamily,rightFamily)||nameCollator.compare(leftName,rightName)||
    String(left?.id??'').localeCompare(String(right?.id??''));
}
export function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
export function today() {
  return tehranDate.format(new Date());
}
export function shift(iso, offset) {
  const date = new Date(iso + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate()+offset);
  return date.toISOString().slice(0,10);
}
function asDate(iso) {
  return new Date(iso + 'T12:00:00Z');
}
export function dayParts(iso) {
  return Object.fromEntries(persianDay.formatToParts(asDate(iso)).filter(part=>part.type!=='literal').map(part=>[part.type,+part.value]));
}
export function showDate(iso, mode) {
  if (!iso) return '—';
  if (mode === 'long') return persianLong.format(asDate(iso));
  if (mode === 'month') return persianMonth.format(asDate(iso));
  if (mode === 'weekday') return weekday.format(asDate(iso));
  const date = dayParts(iso);
  return fa([date.year,String(date.month).padStart(2,'0'),String(date.day).padStart(2,'0')].join('/'));
}
export function monthStart(iso) {
  return shift(iso, 1-dayParts(iso).day);
}
export function calendarDays(iso) {
  const first=monthStart(iso);
  const month=dayParts(first).month;
  const blanks=(asDate(first).getUTCDay()+1)%7;
  const days=[];
  for(let date=first;dayParts(date).month===month;date=shift(date,1)) days.push(date);
  return {blanks,days,first};
}
export function active(delays) {
  return delays.filter(delay=>!delay.cancelled_at&&delay.status!=='approved'&&delay.status!=='cancelled');
}
export function matches(student, term) {
  const haystack=normalize([student.full_name,student.class_name,student.username].join(' '));
  return normalize(term).split(' ').every(word=>haystack.includes(word));
}
export function classYear(iso=today()) {
  const {year,month}=dayParts(iso);
  const first=month>=7?year:year-1;
  return fa(first+'–'+(first+1));
}

function separator(line) {
  const separators=[',','،',';','\t'];
  const counts=Object.fromEntries(separators.map(item=>[item,0]));
  let quoted=false;
  for(const char of line){
    if(char==='"') quoted=!quoted;
    if(!quoted && Object.hasOwn(counts,char)) counts[char]++;
  }
  return separators.sort((a,b)=>counts[b]-counts[a])[0];
}
export function localizeGradeList(value) {
  const delimiter=separator(value.replace(/^\uFEFF/,'').trimStart().split(/\r?\n/,1)[0]);
  let quoted=false,column=0;
  return [...value].map(char=>{
    if(char==='"') quoted=!quoted;
    if(!quoted&&char==='\n') column=0;
    else if(!quoted&&char===delimiter) column++;
    else if(column===3) return fa(digits(char)).replace('.','٫');
    return char;
  }).join('');
}
export function importRows(text, kind) {
  const input=String(text).replace(/^\uFEFF/,'').trim();
  if(!input) return [];
  const delimiter=separator(input.split(/\r?\n/,1)[0]);
  const rows=[];
  let row=[], value='', quoted=false;
  for(let i=0;i<input.length;i++){
    const char=input[i];
    if(char==='"'){
      if(quoted && input[i+1]==='"'){value+='"';i++;}
      else quoted=!quoted;
    }else if(!quoted && (char===delimiter || char==='\n')){
      row.push(value.trim()); value='';
      if(char==='\n'){rows.push(row);row=[];}
    }else if(char!=='\r') value+=char;
  }
  if(quoted) throw new Error('علامت نقل‌قول در فایل ورودی بسته نشده است.');
  row.push(value.trim()); rows.push(row);
  const data=rows.filter(item=>item.some(Boolean));
  if(/^(کد\s*ملی|national[ _]?id|username)$/i.test(normalize(data[0]?.[0]))) data.shift();
  return data.map(([username,first,second,third]) => kind==='grades'
    ? {username:digits(username),subject:first,term:second,score:digits(third).replace('٫','.')}
    : {username:digits(username),full_name:first,class_name:second});
}
