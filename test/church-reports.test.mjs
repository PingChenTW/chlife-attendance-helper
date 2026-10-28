import test from 'node:test';
import assert from 'node:assert/strict';
import { ChurchReportAdapter } from '../src/church-reports.mjs';
import { ReportService } from '../src/reports.mjs';

const now=()=>new Date('2026-10-28T05:00:00Z');
function fixture() {
  const groups=Array.from({length:8},(_,i)=>({id:100+i,level:2,name:'第'+(i+1)+'大組',children:[{id:200+i,level:3,name:(i+1)+'11區'}]}));
  const meetings=['sunday','gospel','home-in','home-out','reading','group'].map((key,i)=>({key,id:i+1}));
  const base={mode:'demo',churchId:49,calls:[],async metadata(){return{church:'測試召會',scopes:[],meetings,childMeetings:[{key:'children-sunday',id:1},{key:'children-group',id:8}]};},async reportCounts(_,scopes){return scopes.map(s=>({scope:s.key,sunday:9,gospel:9,'home-in':9,'home-out':9,reading:9,group:9,'children-sunday':0,'children-group':0}));},async request(path){
    if(path.startsWith('/admin/church-tree'))return[{id:49,level:1,name:'測試召會',children:groups}];
    const p=new URL(path,'https://example.test').searchParams;this.calls.push(p);const children=p.has('role');const ids=p.has('lv2_ids')?p.get('lv2_ids').split(',').map(Number):groups.map(g=>g.id);
    const small=p.get('church_level')==='3',value=children?0:small?(this.largerDistricts?11:9):10;
    const rows=ids.map(id=>({node_id:small?id+100:id,node_name:groups.find(g=>g.id===id).name,row_kind:'node',attendance:Object.fromEntries([1,2,3,4,5,6,8].map(key=>[key,value]))}));
    return{meetings:[1,2,3,4,5,6,8].map(id=>({id})),rows,totals:{attendance:Object.fromEntries([1,2,3,4,5,6,8].map(key=>[key,children?0:ids.length*value]))}};
  }};
  const adapter=new ChurchReportAdapter(base,{defaultGroupId:106});
  const service=new ReportService([{key:'primary',label:'本大組',adapter}],{now,baselines:{2026:{49:{2:Object.fromEntries(groups.map(g=>[g.id,20]))}}}});
  return{base,adapter,service};
}
test('eight groups plus church are read-only report choices and default to own group',async()=>{
  const{service}=fixture();const result=await service.weekly({week:'2026-W44'});
  assert.equal(result.group.key,'l2:106');assert.equal(result.groups.length,9);assert.equal(result.groups.at(-1).key,'church');
  assert.equal(result.totals.baseline,20);assert.equal(result.totals.sunday,10);assert.equal(result.totals.sundayRatio,50);
  assert.equal(result.rows.length,2);assert.equal(result.rows[1].sunday,1); // official total includes direct/other records
  const other=await service.weekly({week:'2026-W44',group:'l2:100'});assert.equal(other.group.key,'l2:100');
  await assert.rejects(service.weekly({week:'2026-W44',group:'l2:999'}),/權限/);
});
test('church view groups by big group, recomputes sums and uses group baseline configuration',async()=>{
  const{service}=fixture();const r=await service.weekly({week:'2026-W44',group:'church'});
  assert.equal(r.rowLevel,2);assert.equal(r.rows.length,8);assert.equal(r.totals.sunday,80);assert.equal(r.totals.baseline,160);assert.equal(r.totals.sundayRatio,50);assert.equal(r.totals.homeTotal,160);
});
test('partial upstream report visibility cannot enable whole-church reporting',async()=>{
  const{base}=fixture(),original=base.request.bind(base);
  base.request=async path=>{const r=await original(path);if(!Array.isArray(r)){const small=new URL(path,'https://example.test').searchParams.get('church_level')==='3';r.rows=r.rows.filter(row=>row.node_id===(small?206:106));}return r;};
  const service=new ReportService([{key:'primary',label:'本大組',adapter:new ChurchReportAdapter(base,{defaultGroupId:106})}],{now});
  const r=await service.weekly({week:'2026-W44'});assert.equal(r.groups.length,1);assert.equal(r.groups.some(x=>x.key==='church'),false);
  await assert.rejects(service.weekly({week:'2026-W44',group:'church'}),/權限/);
});
test('whole church includes ungrouped attendance without duplicating group rows',async()=>{
  const{base,service}=fixture(),original=base.request.bind(base);
  base.request=async path=>{const r=await original(path),p=new URL(path,'https://example.test').searchParams;if(!Array.isArray(r) && !p.has('lv2_ids') && !p.has('role'))for(const key of Object.keys(r.totals.attendance))r.totals.attendance[key]+=3;return r;};
  const r=await service.weekly({week:'2026-W44',group:'church'});assert.equal(r.rows.length,9);assert.equal(r.rows.at(-1).label,'未分大組／其他');assert.equal(r.rows.at(-1).sunday,3);assert.equal(r.totals.sunday,83);assert.equal(r.totals.baseline,160);
});
test('report calls contain no names or write endpoint and incomplete general totals are rejected',async()=>{
  const{base,service}=fixture();await service.weekly({week:'2026-W44',group:'church'});
  assert.equal(base.calls.every(p=>p.get('scope_id')==='49'),true);
  const broken=fixture();broken.base.largerDistricts=true;
  await assert.rejects(broken.service.weekly({week:'2026-W44'}),/變動/);
  broken.base.largerDistricts=false;assert.equal((await broken.service.weekly({week:'2026-W44'})).totals.sunday,10);
});
test('nine choices share one aggregate snapshot and retain its original data timestamp',async()=>{
  const{base,service}=fixture();const first=await service.weekly({week:'2026-W44'});
  const results=await Promise.all(first.groups.map(group=>service.weekly({week:'2026-W44',group:group.key})));
  assert.equal(base.calls.length,7);assert.ok(results.every(r=>r.loadedAt===first.loadedAt));assert.ok(results.every(r=>r.cacheSeconds===60));
  const second=new ReportService([{key:'primary',label:'其他入口',adapter:new ChurchReportAdapter(base,{defaultGroupId:100})}],{now});
  const r=await second.weekly({week:'2026-W44'});assert.equal(r.group.key,'l2:100');assert.equal(base.calls.length,7);
});
test('explicit ended-node buckets replace retired districts without losing official attendance',async()=>{
  const{base,service}=fixture(),original=base.request.bind(base);
  base.request=async path=>{const r=await original(path);if(!Array.isArray(r) && new URL(path,'https://example.test').searchParams.get('church_level')==='3'){const retired=r.rows.find(x=>x.node_id===206);r.rows=r.rows.filter(x=>x.node_id!==206);r.rows.push({...retired,node_id:null,parent_id:106,row_kind:'ended_bucket',ended_nodes:[{node_id:206}]});}return r;};
  const r=await service.weekly({week:'2026-W44'});assert.equal(r.rows.some(x=>x.scope==='l3:206'),false);assert.equal(r.totals.sunday,10);assert.equal(r.rows[0].label,'直屬／其他未列小區');
});
