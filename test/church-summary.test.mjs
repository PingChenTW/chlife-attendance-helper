import test from 'node:test';
import assert from 'node:assert/strict';
import { ChurchReportAdapter } from '../src/church-reports.mjs';
import { ReportService } from '../src/reports.mjs';
import { SUMMARY_FIELDS } from '../src/church-summary.mjs';
import { reportColumns, reportCsv } from '../public/report-model.js';

const meetings=[{id:1,name:'主日',key:'sunday'},{id:2,name:'福音出訪',key:'gospel'},{id:3,name:'家聚會受訪',key:'home-in'},{id:4,name:'家聚會出訪',key:'home-out'},{id:5,name:'生命讀經',key:'reading'},{id:6,name:'小排',key:'group'},{id:7,name:'禱告',key:'prayer'},{id:8,name:'晨興'}];
const ids=[1,2,3,4,5,6,7,8,-1,-45,-46];
const attendance=values=>Object.fromEntries(ids.map(id=>[id,values[id]??0]));
const roles=['學齡前','國小','國中','高中','中學','大學','青職'];
const total=rows=>({attendance:Object.fromEntries(ids.map(id=>[id,rows.reduce((sum,row)=>sum+row.attendance[id],0)])),life_count:rows.reduce((sum,row)=>sum+row.life_count,0)});
function expanded(year,week) {
  const factor=week===43?2:1;
  const rows=Array.from({length:8},(_,i)=>({node_id:100+i,node_name:'第'+(i+1)+'大組',row_kind:'node',attendance:attendance({1:100*factor+i,2:2,3:30,4:20,5:40,6:50,7:60,8:70,[-1]:8,[-45]:10,[-46]:2}),life_count:160}));
  const by_role=roles.map(role=>{
    const values=role==='學齡前'?{1:2,[-1]:3}:role==='國小'?{1:4,[-1]:5}:role==='青職'?{1:10,3:3,4:4}:role==='大學'?{1:7}:role==='國中'?{1:2}:role==='高中'?{1:3}:{1:1};
    const counts=rows.map(row=>({node_id:row.node_id,row_kind:'node',attendance:attendance(values),life_count:role==='學齡前'?6:role==='國小'?10:20}));
    return {role,rows:counts,totals:total(counts)};
  });
  return {year,week,meetings:[...meetings,{id:-1,name:'兒童主日'},{id:-45,name:'今年受浸'},{id:-46,name:'新人主日'}],rows,totals:total(rows),by_role};
}
function fixture({now=()=>new Date('2026-11-04T04:00:00Z'),alter=()=>{},partial=false,baselines}={}) {
  const groups=Array.from({length:8},(_,i)=>({id:100+i,level:2,name:'第'+(i+1)+'大組',children:[{id:200+i,level:3,name:'測試小區'}]}));
  const base={mode:'demo',churchId:49,calls:[],async metadata(){return {church:'測試召會',scopes:[],meetings:meetings.filter(m=>m.key),reportMeetings:meetings,childMeetings:[{key:'children-sunday',id:1},{key:'children-group',id:9}]};},async request(path){
    if(path.startsWith('/admin/church-tree'))return [{id:49,level:1,name:'測試召會',children:groups}];
    const p=new URL(path,'https://example.test').searchParams;this.calls.push(p);
    const data=expanded(Number(p.get('year')),Number(p.get('week')));
    if(p.get('group_by_role')==='1')alter(data,p);
    else if(partial)data.rows=data.rows.filter(row=>row.node_id===106);
    return data;
  }};
  const adapter=new ChurchReportAdapter(base,{defaultGroupId:106});
  const service=new ReportService([{key:'primary',label:'本大組',adapter}],{now,baselines:baselines??{2026:{49:{2:Object.fromEntries(groups.map(g=>[g.id,200]))}}}});
  return {base,adapter,service};
}

test('full church summary retains all image columns, splits both child identities and includes prior week',async()=>{
  const {base,service}=fixture(), report=await service.summary({week:'2026-W44'}), row=report.rows[0];
  assert.equal(report.profile,'all-groups'); assert.equal(report.rows.length,8); assert.equal(report.rowLevel,2);
  assert.equal(row.childrenSundayPreschool,5); assert.equal(row.childrenSundayElementary,9); assert.equal(row['children-sunday'],14);
  assert.equal(row.childrenLife,16); assert.equal(row.teensSunday,6); assert.equal(row.collegeSunday,7); assert.equal(row.careerHome,7);
  assert.equal(row.baptismYear,10); assert.equal(row.newcomerSunday,2); assert.equal(row.prayer,60); assert.equal(row.morning,70);
  assert.equal(report.totals.sunday,828); assert.equal(report.totals.baseline,1600); assert.equal(report.totals.sundayRatio,828/1600*100);
  assert.equal(report.totals.careerHomeRatio,56/1600*100); assert.equal(report.previousWeek.key,'2026-W43'); assert.equal(report.previousTotals.sunday,1628);
  assert.ok(SUMMARY_FIELDS.every(key=>Object.hasOwn(report.totals,key)));
  const reads=base.calls.filter(p=>p.has('group_by_role')); assert.equal(reads.length,2);
  assert.ok(reads.every(p=>p.get('scope_id')==='49'&&p.get('church_level')==='2'&&p.get('split_children_sunday')==='1'&&p.get('meetings').includes('-45')));
});

test('missing role or requested count fails explicitly; an explicit unknown is not zero',async()=>{
  await assert.rejects(fixture({alter:data=>{data.by_role=data.by_role.filter(row=>row.role!=='國小');}}).service.summary({week:'2026-W44'}),/分齡/);
  await assert.rejects(fixture({alter:data=>{delete data.by_role[0].rows[0].attendance[-1];}}).service.summary({week:'2026-W44'}),/格式/);
  const {service}=fixture({alter:data=>{data.by_role[0].rows[0].attendance[-1]=null;data.by_role[0].totals.attendance[-1]=null;}});
  const report=await service.summary({week:'2026-W44'}); assert.equal(report.rows[0].childrenSundayPreschool,null); assert.equal(report.totals['children-sunday'],null);
});

test('official ungrouped values remain in an extra row and totals without altering baselines',async()=>{
  const {service}=fixture({alter:data=>{data.totals.attendance[1]+=3;data.by_role[0].totals.attendance[-1]+=1;data.by_role[0].totals.life_count+=1;}});
  const report=await service.summary({week:'2026-W44'}), extra=report.rows.at(-1);
  assert.equal(extra.label,'未分大組／其他'); assert.equal(extra.baseline,null); assert.equal(extra.sunday,3); assert.equal(extra['children-sunday'],1);
  assert.equal(report.totals.sunday,831); assert.equal(report.totals.baseline,1600); assert.equal(report.totals['children-sunday'],113);
});

test('partial permission, duplicate group and incomplete response cannot produce a full-church success',async()=>{
  const partial=fixture({partial:true}); await assert.rejects(partial.service.summary({week:'2026-W44'}),/權限/);
  assert.equal(partial.base.calls.filter(p=>p.has('group_by_role')).length,0);
  await assert.rejects(fixture({alter:data=>data.rows.push({...data.rows[0]})}).service.summary({week:'2026-W44'}),/不完整/);
  await assert.rejects(fixture({alter:data=>{data.by_role[0].totals.attendance[-1]=-1;}}).service.summary({week:'2026-W44'}),/格式/);
});

test('same authorized source shares one bounded summary snapshot across concurrent entrances',async()=>{
  const {base,service}=fixture(); const results=await Promise.all(Array.from({length:5},()=>service.summary({week:'2026-W44'})));
  assert.equal(base.calls.filter(p=>p.has('group_by_role')).length,2);
  const other=new ReportService([{key:'primary',label:'另一入口',adapter:new ChurchReportAdapter(base,{defaultGroupId:100})}],{now:()=>new Date('2026-11-04T04:00:00Z')});
  await other.summary({week:'2026-W44'}); assert.equal(base.calls.filter(p=>p.has('group_by_role')).length,2);
  assert.ok(results.every(report=>report.loadedAt===results[0].loadedAt));
});

test('previous comparison uses its own ISO year and baseline while requests remain current/previous only',async()=>{
  const {service}=fixture({now:()=>new Date('2027-01-06T04:00:00Z'),baselines:{2027:{49:{2:Object.fromEntries(Array.from({length:8},(_,i)=>[100+i,300]))}},2026:{49:{2:Object.fromEntries(Array.from({length:8},(_,i)=>[100+i,200]))}}}});
  const report=await service.summary({week:'2027-W01'}); assert.equal(report.totals.baseline,2400); assert.equal(report.previousWeek.key,'2026-W53'); assert.equal(report.previousTotals.baseline,1600);
  await assert.rejects(service.summary({week:'2026-W53',source:'unconfigured'}),/來源/);
  await assert.rejects(service.summary({week:'2026-W52'}),/只能/);
});

test('full summary CSV uses split child columns, integer ratios and the comparison row',async()=>{
  const report=await fixture().service.summary({week:'2026-W44'}), csv=reportCsv(report), columns=reportColumns(report);
  assert.ok(columns.some(([key])=>key==='childrenSundayPreschool')); assert.ok(columns.some(([key])=>key==='childrenSundayElementary'));
  assert.ok(csv.includes('兒童主日－學齡前')); assert.ok(csv.includes('兒童主日－小學')); assert.ok(csv.includes('兒童主日－合計'));
  assert.ok(csv.includes('52%')); assert.ok(csv.includes('上週')); assert.ok(csv.includes('今年受浸')); assert.ok(csv.includes('晨興'));
});
