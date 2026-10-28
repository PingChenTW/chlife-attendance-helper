import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { configuredGroups } from '../src/group-links.mjs';
import { createApp } from '../src/server.mjs';
import { AttendanceService } from '../src/service.mjs';
import { DemoAdapter } from '../src/demo.mjs';
import { parseGroupContext, groupApiPath, groupHref, groupManifest } from '../public/group-context.js';
import { selectionKey } from '../public/selection.js';

const now=()=>new Date('2026-10-28T04:00:00Z');
const config={accounts:[{key:'shared',churchId:49,account:'fake',password:'test-only-secret'}],links:[{group:'7',source:'shared',groupId:100,allowWrites:true},{group:'1',source:'shared',groupId:101,allowWrites:true}]};
function fake() { const a=new DemoAdapter();a.churchId=49;const metadata=a.metadata.bind(a);a.metadata=async()=>{const m=await metadata();m.scopes=[...m.scopes.filter(s=>s.level===3).map(s=>({...s,path:'第七大組 / '+s.label,ids:{1:49,2:100,3:Number(s.key.split(':')[1])}})),{key:'l3:outside',level:3,label:'其他大組',path:'第一大組 / 其他區',ids:{1:49,2:101,3:999}}];return m;};return a; }
test('one account may back multiple isolated links; only configured group scopes are usable', async()=>{
  const a=fake();let creations=0;
  const groups=configuredGroups(JSON.stringify(config),{now,secret:'test-master-secret',adapterFactory:()=>{creations++;return a;}});
  assert.equal(creations,1);assert.equal(groups.size,2);
  const seven=groups.get('7'),one=groups.get('1');
  const m7=await seven.service.metadata(),m1=await one.service.metadata();
  assert.equal(m7.siteKey,'group-7');assert.equal(m7.scopes.length,2);assert.equal(m1.scopes.length,1);
  assert.equal(JSON.stringify(m7).includes('test-only-secret'),false);
  const query={week:'2026-W44',scope:m7.scopes[0].key,meeting:'sunday'};
  const roster=await seven.service.roster(query);
  const input={...query,snapshot:roster.snapshot,requestId:randomUUID(),changes:[{memberId:roster.members[0].id,attended:!roster.members[0].attended}]};
  await assert.rejects(one.service.submit(input),/小區/);assert.equal(a.writeCount,0);
  await assert.rejects(seven.service.roster({...query,scope:'l3:outside'}),/小區/);
  const result=await seven.service.submit(input);assert.equal(result.status,'confirmed');assert.equal(a.writeCount,1);
  const report=await seven.reports.weekly({week:query.week});assert.equal(report.rows.length,2);assert.equal(report.totals.baseline,null);
  await assert.rejects(seven.reports.weekly({week:query.week,group:'l2:101'}),/權限/);
});
test('snapshots are bound to the entrance even when upstream group scopes overlap', async()=>{
  const same={...config,links:config.links.map(x=>({...x,groupId:100}))};
  const groups=configuredGroups(JSON.stringify(same),{now,secret:'test-secret',adapterFactory:fake});
  const query={week:'2026-W44',scope:'l3:611',meeting:'sunday'};
  const r=await groups.get('7').service.roster(query);
  await assert.rejects(groups.get('1').service.submit({...query,snapshot:r.snapshot,requestId:randomUUID(),changes:[{memberId:r.members[0].id,attended:true}]}),/憑證/);
});
test('invalid registries fail closed; no credentials or missing group can select legacy service',()=>{
  assert.equal(configuredGroups().size,0);
  for(const value of ['not-json','[]',JSON.stringify({...config,links:[{...config.links[0],source:'missing'}]}),JSON.stringify({...config,links:[config.links[0],config.links[0]]}),JSON.stringify({...config,links:[{...config.links[0],group:'9'}]})])assert.throws(()=>configuredGroups(value,{adapterFactory:fake}));
});
test('HTTP prefixes dispatch to the isolated service, preserve legacy and deny other groups',async t=>{
  const primary=new AttendanceService(new DemoAdapter(),{now,allowWrites:true});
  const server=createApp({service:primary,groups:configuredGroups(JSON.stringify(config),{now,adapterFactory:fake})});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port;
  const original=await(await fetch(base+'/api/meta')).json();assert.equal(original.siteKey,undefined);
  const res=await fetch(base+'/api/groups/7/meta'),meta=await res.json();assert.equal(res.status,200);assert.equal(meta.siteKey,'group-7');assert.equal(meta.scopes.length,2);assert.equal(res.headers.get('cache-control'),'no-store');
  assert.equal((await fetch(base+'/api/groups/2/meta')).status,503);assert.equal((await fetch(base+'/api/groups/9/meta')).status,400);
  const rm=await(await fetch(base+'/api/groups/7/reports/meta')).json();assert.equal(rm.sources.length,1);
  const query={week:'2026-W44',scope:meta.scopes[0].key,meeting:'sunday'};
  const roster=await(await fetch(base+'/api/groups/7/roster?'+new URLSearchParams(query))).json();
  const payload={...query,snapshot:roster.snapshot,requestId:randomUUID(),changes:[{memberId:roster.members[0].id,attended:!roster.members[0].attended}]};
  const send=target=>fetch(base+target,{method:'POST',headers:{'Content-Type':'application/json','X-Attendance-Client':'1'},body:JSON.stringify(payload)});
  assert.equal((await send('/api/attendance')).status,400);
  const saved=await send('/api/groups/7/attendance');assert.equal(saved.status,200);assert.equal((await saved.json()).status,'confirmed');
  assert.equal((await fetch(base+'/api/groups/7/reports/weekly?week=2026-W44&group=l2:101')).status,403);
  const manifest=await(await fetch(base+'/manifest-group-7.webmanifest')).json();assert.equal(manifest.start_url,'./?group=7');
});
test('mobile links retain group through navigation, PWA launch and saved selections',()=>{
  const seven=parseGroupContext('?group=7');assert.equal(groupApiPath('/api/meta',seven),'/api/groups/7/meta');
  assert.equal(groupHref('./reports.html',seven),'./reports.html?group=7');assert.equal(groupHref('./',seven),'./?group=7');
  assert.equal(groupManifest({name:'test'},'7').start_url,'./?group=7');
  for(const query of ['?group=9','?group=7&group=6','?group=07','?group='])assert.throws(()=>groupApiPath('/api/meta',parseGroupContext(query)),/連結/);
  assert.equal(groupApiPath('/api/meta',parseGroupContext('')),'/api/meta');
  assert.notEqual(selectionKey({mode:'live',church:'church',siteKey:'group-7'},'l3:1'),selectionKey({mode:'live',church:'church'},'l3:1'));
});
