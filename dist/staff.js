import { digits,fa } from './domain.js?v=delay-management';

const teacherCodeHeaders=['کد معلم (نام کاربری)','کد معلم','نام کاربری','username'];
const privateHeader=/رمز|گذرواژه|password|passwd|secret/i;
const normalizeHeader=value=>String(value??'').replace(/[يى]/g,'ی').replace(/ك/g,'ک')
  .replace(/[\s\u200c\u200e\u200f\ufeff]+/g,' ').trim().toLowerCase();

export const attendanceLabels={present:'حاضر',absent:'غایب',late:'با تأخیر'};
export const displayScore=value=>fa(digits(value)).replace(/\./g,'٫');

export function scoreValue(value){
  const text=digits(value).trim().replace('٫','.');
  if(!text) return null;
  if(!/^\d+(?:\.\d{1,2})?$/.test(text)||Number(text)>20) throw new Error('KH2_INVALID_LEDGER');
  return Number(text);
}

export function workbookStaffDetails(xlsx,buffer){
  let book;
  try{book=xlsx.read(buffer,{type:'array',cellFormula:false,sheetRows:330});}
  catch{throw new Error('فایل اکسل قابل خواندن نیست.');}
  const people=Object.create(null);
  let matchingSheet=false;
  for(const name of book.SheetNames){
    const data=xlsx.utils.sheet_to_json(book.Sheets[name],{header:1,raw:false,defval:'',blankrows:false});
    const headerIndex=data.findIndex(line=>line.some(value=>teacherCodeHeaders.includes(normalizeHeader(value))));
    if(headerIndex<0) continue;
    matchingSheet=true;
    const headings=data[headerIndex].map(normalizeHeader);
    const usernameColumn=teacherCodeHeaders.map(header=>headings.indexOf(header)).find(index=>index>=0);
    for(const values of data.slice(headerIndex+1)){
      const username=digits(String(values[usernameColumn]??'')).trim().toLowerCase();
      if(!username) continue;
      if(!/^[a-z0-9][a-z0-9._-]{2,47}$/.test(username)||Object.hasOwn(people,username)){
        throw new Error('نام کاربری نامعتبر یا تکراری در فایل اکسل وجود دارد.');
      }
      people[username]=Object.fromEntries(headings.flatMap((heading,index)=>{
        const value=String(values[index]??'').trim();
        return heading&&value&&index!==usernameColumn&&!privateHeader.test(heading)?[[heading,value]]:[];
      }));
    }
  }
  if(!matchingSheet||!Object.keys(people).length) throw new Error('ستون «کد معلم (نام کاربری)» و دست‌کم یک ردیف داده لازم است.');
  if(Object.keys(people).length>300) throw new Error('KH2_INVALID_LIST');
  return people;
}
