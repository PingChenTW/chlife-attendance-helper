import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnosticReporter, createConnectionClient } from '../public/connection.js';
const phone=()=>{const map=new Map();return{getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};};
test('diagnostic queue is bounded, rejects poisoned storage, expires, and never sends in practice', async () => {
  const storage=phone(),at=Date.parse('2026-11-09T04:00:00Z');let time=at,calls=0;
  const options={group:'6',storage,now:()=>time,fetchImpl:async()=>{calls++;throw Error('offline');}};
  const reporter=createDiagnosticReporter(options);for(let i=0;i<30;i++)reporter.record('roster','CLIENT_NETWORK',10);
  assert.equal(reporter.pending(),20);
  const disabled=createDiagnosticReporter({...options,enabled:false});disabled.record('metadata','CLIENT_TIMEOUT',90000);await disabled.flush();assert.equal(calls,0);
  time+=86400001;const expired=createDiagnosticReporter(options);assert.equal(expired.pending(),0);
  storage.setItem('attendance-diagnostics:v1',JSON.stringify([{group:'6',name:'DO_NOT_SEND'}]));
  const safe=createDiagnosticReporter(options);assert.equal(safe.pending(),0);await safe.flush();assert.equal(calls,0);
});
test('a successful response is usable while diagnostic delivery is stalled and HTML startup pages are classified', async () => {
  const reporter={record(){},flush:()=>new Promise(()=>{})};
  const working=createConnectionClient({reporter,fetchImpl:async()=>new Response('{"ok":true}')});
  assert.equal((await working('/health',{},'helper-connect')).ok,true);
  const rows=[],startup=createConnectionClient({reporter:{record:(...args)=>rows.push(args),flush:async()=>{}},fetchImpl:async()=>new Response('<html>starting</html>',{status:503})});
  await assert.rejects(startup('/health',{},'helper-connect'),/可能正在啟動/);assert.equal(rows[0][1],'HELPER_NON_JSON');
});
test('connection failures survive the tab reload, send only safe fields, and clear only after acknowledgment', async () => {
  const storage=phone(),sent=[];
  const first=createDiagnosticReporter({group:'6',storage,fetchImpl:async()=>{throw Error('offline');}});
  first.record('helper-connect','CLIENT_TIMEOUT',90000);await first.flush();assert.equal(first.pending(),1);
  const next=createDiagnosticReporter({group:'6',storage,fetchImpl:async(url,options)=>{sent.push(JSON.parse(options.body));return new Response('{}',{status:202});}});
  await next.flush();assert.equal(next.pending(),0);assert.equal(sent.length,1);assert.equal(sent[0].stage,'helper-connect');
  assert.deepEqual(Object.keys(sent[0]).sort(),['code','durationMs','eventId','group','occurredAt','stage']);
  assert.doesNotMatch(JSON.stringify(sent),/name|member|password|url|device|scope/);
});
test('readiness, source initialization and unknown POST outcomes have distinct messages without automatic resubmission', async () => {
  const recorded=[],calls=[];const reporter={record:(...args)=>recorded.push(args),flush:async()=>{}};
  const client=createConnectionClient({reporter,fetchImpl:async(url,options)=>{calls.push({url,method:options?.method??'GET'});throw Object.assign(Error('DO_NOT_SHOW'),{name:'TimeoutError'});}});
  await assert.rejects(client('/health',{},'helper-connect'),/點名服務.*連線逾時/);
  await assert.rejects(client('/api/attendance',{method:'POST'},'attendance'),/尚未確認.*請先重新讀取/);
  assert.equal(calls.length,2);assert.equal(calls.filter(call=>call.method==='POST').length,1);assert.equal(recorded.length,2);
  const source=createConnectionClient({reporter,fetchImpl:async()=>new Response(JSON.stringify({error:{code:'UPSTREAM_UNAVAILABLE',stage:'upstream-login',requestId:'12345678-1234-1234-1234-123456789012',message:'DO_NOT_SHOW'}}),{status:502})});
  await assert.rejects(source('/api/meta',{},'metadata'),/原網站登入.*12345678/);
});
