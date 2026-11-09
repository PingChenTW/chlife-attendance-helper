import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/server.mjs';
import { DemoAdapter } from '../src/demo.mjs';
import { AttendanceService } from '../src/service.mjs';
import { UsageStatistics } from '../src/usage.mjs';
import { AppError } from '../src/errors.mjs';
import { createRequestTrace, diagnosticScope, traceStage } from '../src/diagnostics.mjs';

test('parallel stage traces stay isolated and never expose arbitrary error details or query data', async () => {
  const logs=[];
  const run=group=>diagnosticScope(createRequestTrace('/api/groups/'+group+'/meta?secret=DO_NOT_LOG','6',event=>logs.push(event)),()=>traceStage('upstream-login',async()=>{await Promise.resolve();throw new AppError(502,'UPSTREAM_UNAVAILABLE','DO_NOT_LOG');}));
  await Promise.allSettled([run('6'),run('7')]);
  const failures=logs.filter(row=>row.event==='error');
  assert.equal(failures.length,2); assert.deepEqual(failures.map(row=>row.group).sort(),['6','7']);
  assert.notEqual(failures[0].requestId,failures[1].requestId);
  assert.ok(failures.every(row=>row.stage==='upstream-login'&&row.durationMs>=0&&row.code==='UPSTREAM_UNAVAILABLE'));
  assert.doesNotMatch(JSON.stringify(logs),/DO_NOT_LOG|secret|stack|password|account|memberId/);
  await diagnosticScope(createRequestTrace('/api/meta','6',()=>{throw Error('logger unavailable');}),()=>traceStage('initialize',async()=>42));
});

test('initialization failure is counted, returns a safe stage/reference, and health works through existing CORS', async t => {
  const adapter=new DemoAdapter(), usage=new UsageStatistics({groups:['6']}), logs=[];
  adapter.metadata=()=>traceStage('upstream-login',async()=>{throw new AppError(502,'UPSTREAM_UNAVAILABLE','原網站暫時無法連線');});
  const service=new AttendanceService(adapter),server=createApp({service,defaultGroup:'6',groups:new Map([['6',{service}]]),usage,allowedOrigins:['https://example.github.io'],logDiagnostic:event=>logs.push(event)});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port;
  const health=await fetch(base+'/health',{headers:{Origin:'https://example.github.io'}});
  assert.equal(health.status,200);assert.equal(health.headers.get('access-control-allow-origin'),'https://example.github.io');
  const response=await fetch(base+'/api/groups/6/meta'),body=await response.json();
  assert.equal(response.status,502);assert.equal(body.error.stage,'upstream-login');assert.match(body.error.requestId,/^[a-f0-9-]{36}$/);
  assert.equal(response.headers.get('x-request-id'),body.error.requestId);
  const totals=usage.summary({period:'today',group:'6'}).totals;
  assert.equal(totals.failures,1);assert.equal(totals.metadataFailures,1);assert.equal(totals.metadataReads,0);
  assert.ok(logs.some(row=>row.event==='request-error'&&row.operation==='metadata'));
  assert.doesNotMatch(JSON.stringify(logs),/原網站暫時|roster|members|token/);
});

test('client diagnostic reports are bounded, deduplicated, and cannot store names or arbitrary stages', async t => {
  const service=new AttendanceService(new DemoAdapter()),usage=new UsageStatistics({groups:['6']}),logs=[];
  const server=createApp({service,usage,logDiagnostic:event=>logs.push(event)});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port,headers={'Content-Type':'application/json','X-Usage-Client':'1'};
  const event={group:'6',stage:'helper-connect',code:'CLIENT_TIMEOUT',durationMs:90000,occurredAt:new Date().toISOString(),eventId:randomUUID()};
  for(let i=0;i<2;i++)assert.equal((await fetch(base+'/api/usage/diagnostics',{method:'POST',headers,body:JSON.stringify(event)})).status,202);
  for(const bad of [{...event,name:'PRIVATE'},{...event,stage:'PRIVATE'},{...event,code:'PRIVATE'},{...event,durationMs:-1}])assert.equal((await fetch(base+'/api/usage/diagnostics',{method:'POST',headers,body:JSON.stringify(bad)})).status,400);
  assert.equal(usage.summary({period:'today',group:'6'}).totals.clientConnectionFailures,1);
  assert.doesNotMatch(JSON.stringify(usage.summary()),/PRIVATE|eventId|occurredAt/);
});

test('local read throttling is observed without contacting upstream or spending the write quota', async t => {
  const service=new AttendanceService(new DemoAdapter()),usage=new UsageStatistics({groups:['6']}),logs=[];
  const server=createApp({service,defaultGroup:'6',usage,logDiagnostic:event=>logs.push(event)});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port;
  for(let i=0;i<120;i++)assert.equal((await fetch(base+'/api/reports/meta')).status,200);
  const r=await fetch(base+'/api/meta');assert.equal(r.status,429);assert.equal((await r.json()).error.code,'RATE_LIMIT');
  assert.equal(usage.summary({period:'today',group:'6'}).totals.rateLimited,1);
  assert.ok(logs.some(row=>row.event==='request-error'&&row.code==='RATE_LIMIT'));
});

test('logger and metadata statistics failures cannot block a successful initialization', async t => {
  const service=new AttendanceService(new DemoAdapter()),usage=new UsageStatistics({groups:['6']});
  usage.recordOperation=()=>{throw Error('counter unavailable');};
  const server=createApp({service,defaultGroup:'6',usage,logDiagnostic:()=>{throw Error('logger unavailable');}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();});
  const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/meta');assert.equal(r.status,200);assert.equal((await r.json()).meetings.length,8);
});
