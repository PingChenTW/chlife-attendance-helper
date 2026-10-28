import test from 'node:test';
import assert from 'node:assert/strict';
import { ChlifeAdapter } from '../src/upstream.mjs';

test('adapter restricts scope and sends explicit attendance with idempotency, without returning private columns', async () => {
  const calls = [];
  const adapter = new ChlifeAdapter({ churchId: 49, account: 'test-owner', password: 'test-only-secret', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    let data;
    if (url.endsWith('/auth/login')) data = { access_token: 'opaque-test-token', user: { church_id: 49, privileges: [{ church_id: 100, level: 2 }] } };
    else if (url.endsWith('/members') && JSON.parse(options.body).role?.includes(',')) data = { count: 0, meetingIds: [37], members: [] };
    else if (url.endsWith('/members')) data = { count: 2, meetingIds: [37], members: [
      { member_id: 1, member_name: '測試甲', path: '49,100,200,0', church_name: '測試小區', attend0: 1, in_scope: 1, roll_callable: 1, phone: 'private-not-for-frontend' },
      { member_id: 2, member_name: '其他區資料', path: '49,101,201,0', attend0: 0, in_scope: 0, roll_callable: 0 }
    ] };
    else data = {};
    return new Response(JSON.stringify({ success: true, data }), { status: 200 });
  } });
  const week = { key: '2026-W44', year: 2026, week: 44 }, scope = { label: '測試小區', ids: { 1: 49, 2: 100, 3: 200 } }, meeting = { id: 37 };
  const roster = await adapter.roster(week, scope, meeting);
  assert.equal(roster.length, 1); assert.equal(roster[0].attended, true);
  assert.equal('phone' in roster[0], false); assert.equal('path' in roster[0], false);
  assert.equal('role' in JSON.parse(calls.at(-1).options.body), false);
  const childRoster = await adapter.roster(week, scope, meeting, 'children');
  assert.equal(childRoster.length, 1);
  assert.deepEqual(calls.filter(call => call.url.endsWith('/members')).map(call => JSON.parse(call.options.body).role).slice(-2), ['學齡前', '國小']);
  const childFilter = JSON.parse(calls.at(-1).options.body);
  assert.equal(childFilter.role, '國小');
  assert.equal(childFilter.lv2_ids, '100'); assert.equal(childFilter.lv3_ids, '200');
  await adapter.setAttendance(week, meeting, [1], false, 'test-operation-id');
  const request = calls.at(-1);
  assert.equal(request.options.headers['Idempotency-Key'], 'test-operation-id');
  assert.deepEqual(JSON.parse(request.options.body), { year: 2026, week: 44, meeting_id: 37, member_ids: [1], attend: false });
});

test('upstream MFA or forced account changes stop automation', async () => {
  const adapter = new ChlifeAdapter({ churchId: 49, account: 'test-owner', password: 'test-only-secret', fetchImpl: async () => new Response(JSON.stringify({ success: true, data: { totp_required: true } })) });
  await assert.rejects(adapter.authenticate(), /管理者完成驗證/);
});
test('original report rate limits retain a bounded retry interval instead of a generic failure',async()=>{
  const a=new ChlifeAdapter({churchId:49,account:'fake',password:'fake',fetchImpl:async()=>new Response(JSON.stringify({success:false,error:'busy'}),{status:429,headers:{'Retry-After':'13'}})});
  await assert.rejects(a.raw('/admin/reports/weekly'),e=>e.code==='UPSTREAM_RATE_LIMIT' && e.status===429 && e.retryAfter===13 && e.message.includes('13'));
});
