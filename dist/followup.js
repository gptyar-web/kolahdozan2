import {active,compareStudentNames,matches} from './domain.js?v=classroom-notices';
import {reportPeriod} from './report.js?v=classroom-notices';

export function followupRows(people,delays,settings,today){
  if(!settings) return [];
  const {start,end}=reportPeriod(settings.period,today);
  const counts=new Map();
  for(const delay of active(delays)){
    if(!delay.excused&&delay.date_on>=start&&delay.date_on<=end){
      counts.set(delay.student_id,(counts.get(delay.student_id)??0)+1);
    }
  }
  return people.map(person=>({person,count:counts.get(person.id)??0}))
    .filter(row=>row.count>=settings.threshold)
    .sort((a,b)=>b.count-a.count||compareStudentNames(a.person,b.person));
}

export const parentRequestMessage='لطفاً همراه یکی از اولیای خود به دفتر مدرسه مراجعه کنید.';

export const notificationTitles={
  delay_added:'تأخیر ثبت شد',
  appeal_added:'اعتراض تازه برای بررسی',
  appeal_approved:'اعتراض شما پذیرفته شد',
  appeal_rejected:'اعتراض شما رد شد',
  parent_requested:'درخواست حضور اولیا',
  teacher_message:'اعلان دبیر',
  student_message:'اعلان دانش‌آموز',
  lesson_absence:'غیبت در کلاس ثبت شد',
  lesson_late:'تأخیر در کلاس ثبت شد'
};
export const isClassroomNotification=kind=>['teacher_message','student_message','lesson_absence','lesson_late'].includes(kind);

export function matchesInClass(person,query,className){
  return matches({...person,class_name:className},query);
}
