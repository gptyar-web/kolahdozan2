import {active,matches} from './domain.js?v=delay-management';
import {reportPeriod} from './report.js?v=parent-requests';

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
    .sort((a,b)=>b.count-a.count||a.person.full_name.localeCompare(b.person.full_name,'fa'));
}

export const parentRequestMessage='لطفاً همراه یکی از اولیای خود به دفتر مدرسه مراجعه کنید.';

export const notificationTitles={
  delay_added:'تأخیر ثبت شد',
  appeal_added:'اعتراض تازه برای بررسی',
  appeal_approved:'اعتراض شما پذیرفته شد',
  appeal_rejected:'اعتراض شما رد شد',
  parent_requested:'درخواست حضور اولیا'
};

export function matchesInClass(person,query,className){
  return matches({...person,class_name:className},query);
}
