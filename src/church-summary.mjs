import { ensure } from './errors.mjs';

export const SUMMARY_FIELDS = ['sunday','baptismYear','newcomerSunday','gospel','home-out','home-in','collegeSunday','careerSunday','careerHome','childrenLife','childrenSundayPreschool','childrenSundayElementary','children-sunday','teensSunday','prayer','reading','morning','group'];
const NAMES = { sunday:'主日', gospel:'福音出訪', 'home-out':'家聚會出訪', 'home-in':'家聚會受訪', reading:'生命讀經', group:'小排', prayer:'禱告', morning:'晨興' };
const ROLES = ['學齡前','國小','國中','高中','中學','大學','青職'];
const count = value => Number.isSafeInteger(value) && value >= 0;
const valid = value => value === null || count(value);
const sum = values => values.every(count) ? values.reduce((a,b)=>a+b,0) : null;

function meetingIds(meta) {
  const catalog=meta.reportMeetings ?? [];
  return Object.fromEntries(Object.entries(NAMES).map(([key,name])=>{
    const matches=catalog.filter(meeting=>meeting.name===name && Number.isSafeInteger(meeting.id) && meeting.id>0);
    ensure(matches.length===1,502,'SUMMARY_MEETINGS','無法確認原網站總表聚會欄位。');
    return [key,matches[0].id];
  }));
}

export function parseChurchSummary(data, meta, ids) {
  ensure(Array.isArray(data?.rows) && Array.isArray(data.meetings) && Array.isArray(data.by_role) && data.totals?.attendance,502,'SUMMARY_SCHEMA','原網站總表資料格式不完整。');
  const childMeetings=data.meetings.filter(meeting=>meeting.name==='兒童主日' && Number.isSafeInteger(meeting.id) && meeting.id<0);
  ensure(childMeetings.length===1 && [...Object.values(ids),-45,-46].every(id=>data.meetings.some(meeting=>Number(meeting.id)===id)),502,'SUMMARY_SCHEMA','原網站總表聚會欄位不完整。');
  const childId=childMeetings[0].id, roleMap=new Map();
  for(const role of ROLES) {
    const matches=data.by_role.filter(item=>item.role===role);
    ensure(matches.length===1 && Array.isArray(matches[0].rows) && matches[0].totals?.attendance,502,'SUMMARY_ROLES','原網站分齡報表不完整，請重新讀取。');
    roleMap.set(role,matches[0]);
  }
  const number=(row,id)=>{const value=row?.attendance?.[String(id)];ensure(valid(value),502,'SUMMARY_COUNT','原網站總表人數格式已變更。');return value;};
  const life=row=>{ensure(valid(row?.life_count),502,'SUMMARY_COUNT','原網站總表人數格式已變更。');return row.life_count;};
  const zero={attendance:Object.fromEntries([...Object.values(ids),childId,-45,-46].map(id=>[id,0])),life_count:0};
  const roleRow=(role,id)=>{
    const item=roleMap.get(role); if(id===null)return item.totals;
    const rows=item.rows.filter(row=>row.row_kind==='node' && Number(row.node_id)===id && !row.node_deleted);
    ensure(rows.length<=1,502,'SUMMARY_SCHEMA','原網站分齡報表資料不完整。');
    // A role-filtered report explicitly omits nodes with no eligible people.
    return rows[0]??zero;
  };
  const values=(general,id)=>{
    const preschool=roleRow('學齡前',id), elementary=roleRow('國小',id), career=roleRow('青職',id);
    const childrenSundayPreschool=sum([number(preschool,ids.sunday),number(preschool,childId)]);
    const childrenSundayElementary=sum([number(elementary,ids.sunday),number(elementary,childId)]);
    return {...Object.fromEntries(Object.keys(NAMES).map(key=>[key,number(general,ids[key])])),baptismYear:number(general,-45),newcomerSunday:number(general,-46),
      collegeSunday:number(roleRow('大學',id),ids.sunday),careerSunday:number(career,ids.sunday),careerHome:sum([number(career,ids['home-out']),number(career,ids['home-in'])]),
      childrenLife:sum([life(preschool),life(elementary)]),childrenSundayPreschool,childrenSundayElementary,'children-sunday':sum([childrenSundayPreschool,childrenSundayElementary]),
      teensSunday:sum(['國中','高中','中學'].map(role=>number(roleRow(role,id),ids.sunday)))};
  };
  const rows=meta.reportGroups.map(group=>{
    const matches=data.rows.filter(row=>row.row_kind==='node' && Number(row.node_id)===group.id && !row.node_deleted);
    ensure(matches.length===1,502,'SUMMARY_SCHEMA','原網站大組總表資料不完整。');
    return {scope:group.key,label:group.label,...values(matches[0],group.id)};
  });
  const totals=values(data.totals,null), extra={scope:'other:church',label:'未分大組／其他'};
  for(const key of SUMMARY_FIELDS) {
    const subtotal=sum(rows.map(row=>row[key]));
    extra[key]=subtotal===null||totals[key]===null?null:totals[key]-subtotal;
    ensure(extra[key]===null||extra[key]>=0,409,'REPORT_MOVED','讀取時原網站總表已變動，請重新讀取。');
  }
  if(SUMMARY_FIELDS.some(key=>extra[key]===null||extra[key]>0))rows.push(extra);
  return {rows,totals,baptismEstimated:count(data.baptism_estimated)?data.baptism_estimated:0};
}

export async function loadChurchSummary(base, store, week, meta) {
  store.summarySnapshots ??= new Map(); store.summaryPending ??= new Map();
  const cached=store.summarySnapshots.get(week.key); if(cached&&cached.expires>Date.now())return cached;
  if(store.summaryPending.has(week.key))return store.summaryPending.get(week.key);
  const pending=(async()=>{
    const ids=meetingIds(meta);
    const params=new URLSearchParams({year:String(week.year),week:String(week.week),scope:'church',scope_id:String(base.churchId),church_level:'2',row_contract:'2',group_by_role:'1',split_children_sunday:'1',meetings:[...Object.values(ids),-45,-46].join(',')});
    ensure(Date.now()>=store.cooldown,429,'UPSTREAM_RATE_LIMIT','原網站報表查詢較頻繁，請稍後再重新讀取。');
    let data;try{data=await base.request('/admin/reports/weekly?'+params);}catch(error){if(error.code==='UPSTREAM_RATE_LIMIT')store.cooldown=Date.now()+(error.retryAfter??60)*1000;throw error;}
    ensure(Number(data.year)===week.year&&Number(data.week)===week.week,502,'SUMMARY_WEEK','原網站回傳的總表週次不符，請重新讀取。');
    const result={...parseChurchSummary(data,meta,ids),loadedAt:new Date().toISOString(),cacheSeconds:60,expires:Date.now()+60000};
    if(store.summarySnapshots.size>=3)store.summarySnapshots.delete(store.summarySnapshots.keys().next().value);
    store.summarySnapshots.set(week.key,result);return result;
  })();
  store.summaryPending.set(week.key,pending);
  try{return await pending;}finally{store.summaryPending.delete(week.key);}
}
