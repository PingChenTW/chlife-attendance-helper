import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { UsageStatistics } from '../src/usage.mjs';
import { createUsageReporter } from '../public/usage-client.js';
import { createApp } from '../src/server.mjs';
import { AttendanceService } from '../src/service.mjs';
import { DemoAdapter } from '../src/demo.mjs';

test('usage respects Taipei midnight, group filters, unavailable history and read-only dashboard reads', () => {
  let current = new Date('2026-11-02T15:59:00Z');
  const stats = new UsageStatistics({ now: () => current, groups: ['1', '6'] });
  stats.recordView({ group: '6', page: 'attendance' });
  stats.recordOperation('1', 'reportReads');
  current = new Date('2026-11-02T16:01:00Z');
  stats.recordView({ group: '6', page: 'reports' });
  const today = stats.summary({ period: 'today', group: '6' });
  assert.equal(today.range.from, '2026-11-03'); assert.equal(today.totals.attendanceViews, 0); assert.equal(today.totals.reportViews, 1);
  const week = stats.summary({ period: '7d', group: 'all' });
  assert.equal(week.totals.attendanceViews, 1); assert.equal(week.totals.reportReads, 1);
  assert.equal(week.daily.filter(row => row.covered).length, 2);
  assert.equal(week.daily[0].covered, false);
  assert.equal(stats.summary({ period: '7d', group: '1' }).totals.reportReads, 1);
  assert.deepEqual(stats.summary({ period: '7d', group: 'all' }).totals, week.totals);
});

test('unique submission results count once per group and never retain member records or request IDs in the public result', () => {
  const stats = new UsageStatistics(), id = randomUUID();
  const result = { status: 'confirmed', confirmed: 2, total: 2, roster: { members: [{ id: 123, name: 'DO_NOT_STORE' }] } };
  stats.recordSubmission('6', id, result, 'prayer');
  stats.recordSubmission('6', id, result, 'prayer');
  stats.recordSubmission('7', id, { status: 'partial', confirmed: 1, total: 3 }, 'reading');
  const summary = stats.summary({ period: 'today', group: 'all' });
  assert.equal(summary.totals.submissions, 2); assert.equal(summary.totals.confirmedBatches, 1);
  assert.equal(summary.totals.unconfirmedBatches, 1); assert.equal(summary.totals.confirmedChanges, 3);
  assert.equal(summary.byMeeting.find(row => row.key === 'prayer').submissions, 1);
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(`${id}|DO_NOT_STORE|memberId|userAgent|snapshot|deviceToken`));
});

test('restart begins empty, retention is bounded, and invalid input cannot add arbitrary fields', () => {
  let current = new Date('2026-11-01T00:00:00Z'); const now = () => current;
  const stats = new UsageStatistics({ now }); stats.recordView({ group: '6', page: 'attendance' });
  current = new Date('2026-12-03T00:00:00Z'); stats.recordView({ group: '6', page: 'reports' });
  const summary = stats.summary({ period: '30d', group: 'all' });
  assert.equal(summary.daily.length, 30); assert.equal(summary.totals.attendanceViews, 0); assert.equal(summary.totals.reportViews, 1);
  assert.equal(stats.summary({ period: 'today', group: 'all' }).storage, 'memory');
  assert.equal(new UsageStatistics({ now }).summary({ period: 'today', group: 'all' }).totals.reportViews, 0);
  for (const body of [{ group: '9', page: 'attendance' }, { group: '6', page: 'admin' }, { group: '6', page: 'attendance', name: 'DO_NOT_STORE' }]) assert.throws(() => stats.recordView(body));
  assert.throws(() => stats.summary({ period: 'year', group: 'all' }));
  assert.throws(() => stats.summary({ period: 'today', group: '99' }));
});

test('page reporter sends only page/group once, excludes practice, and swallows failures', async () => {
  const calls = [], report = createUsageReporter({ apiBase: 'https://stats.example', fetchImpl: async (...args) => { calls.push(args); return { ok: true }; } });
  await report('attendance', '6'); await report('attendance', '6'); await report('reports', '6');
  assert.equal(calls.length, 2); assert.equal(calls[0][0], 'https://stats.example/api/usage/events');
  assert.deepEqual(JSON.parse(calls[0][1].body), { group: '6', page: 'attendance' });
  assert.equal(calls[0][1].credentials, 'omit');
  assert.equal(await createUsageReporter({ enabled: false, fetchImpl: () => assert.fail('practice must not report') })('attendance', '6'), false);
  assert.equal(await report('attendance', 'invalid'), false);
  assert.equal(await createUsageReporter({ fetchImpl: async () => { throw new Error('offline'); } })('attendance', '6'), false);
});

async function setup(t, usage) {
  const adapter = new DemoAdapter(), service = new AttendanceService(adapter, { allowWrites: true });
  const groups = new Map([['6', { service }]]);
  const stats = usage ?? new UsageStatistics({ groups: ['6'], mode: 'demo' });
  const server = createApp({ service, groups, defaultGroup: '6', usage: stats, allowedOrigins: ['https://example.github.io'] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { adapter, service, stats, base };
}

test('usage HTTP has separate quotas, rejects untrusted data and keeps actual batch results idempotent', async t => {
  const { base, service, adapter } = await setup(t);
  const headers = { 'Content-Type': 'application/json', 'X-Usage-Client': '1' };
  for (let i = 0; i < 20; i++) assert.equal((await fetch(base + '/api/usage/events', { method: 'POST', headers, body: JSON.stringify({ group: '6', page: 'attendance' }) })).status, 202);
  assert.equal((await fetch(base + '/api/usage/events', { method: 'POST', headers, body: JSON.stringify({ group: '6', page: 'attendance', name: 'PRIVATE' }) })).status, 400);
  assert.equal((await fetch(base + '/api/usage/events', { method: 'POST', headers: { ...headers, Origin: 'https://unlisted.example' }, body: '{}' })).status, 403);
  const preflight = await fetch(base + '/api/usage/events', { method: 'OPTIONS', headers: { Origin: 'https://example.github.io' } });
  assert.match(preflight.headers.get('access-control-allow-headers'), /X-Usage-Client/);
  const meta = await service.metadata(), query = { week: meta.weeks[0].key, scope: meta.scopes[0].key, meeting: 'sunday', audience: 'all' };
  const rosterResponse = await fetch(base + '/api/groups/6/roster?' + new URLSearchParams(query));
  const roster = await rosterResponse.json();
  assert.equal((await fetch(base + '/api/reports/weekly?' + new URLSearchParams({ week: query.week }))).status, 200);
  assert.equal((await fetch(base + '/api/groups/6/roster?' + new URLSearchParams({ ...query, scope: 'not-allowed' }))).status, 403);
  const input = { ...query, snapshot: roster.snapshot, requestId: randomUUID(), changes: [{ memberId: roster.members[0].id, attended: true }] };
  for (let i = 0; i < 2; i++) {
    const response = await fetch(base + '/api/groups/6/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Attendance-Client': '1' }, body: JSON.stringify(input) });
    assert.equal(response.status, 200); assert.equal((await response.json()).status, 'confirmed');
  }
  assert.equal(adapter.writeCount, 1);
  const response = await fetch(base + '/api/usage/summary?period=today&group=all');
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const summary = await response.json(); assert.equal(summary.totals.attendanceViews, 20); assert.equal(summary.totals.submissions, 1); assert.equal(summary.totals.rosterReads, 1);
  assert.equal(summary.totals.reportReads, 1); assert.equal(summary.totals.failures, 1);
  assert.equal((await fetch(base + '/api/usage/summary?period=year')).status, 400);
  assert.equal((await fetch(base + '/usage.html')).status, 200);
});

test('dashboard read quota cannot spend the attendance read budget', async t => {
  const { base } = await setup(t);
  for (let i = 0; i < 60; i++) assert.equal((await fetch(base + '/api/usage/summary')).status, 200);
  assert.equal((await fetch(base + '/api/usage/summary')).status, 429);
  assert.equal((await fetch(base + '/api/meta')).status, 200);
});

test('a counter failure cannot turn a confirmed attendance write into a failed response', async t => {
  const usage = new UsageStatistics({ groups: ['6'] });
  usage.recordOperation = usage.recordSubmission = usage.recordFailure = () => { throw new Error('counter unavailable'); };
  const { base, service } = await setup(t, usage);
  const meta = await service.metadata(), query = { week: meta.weeks[0].key, scope: meta.scopes[0].key, meeting: 'sunday', audience: 'all' };
  const roster = await (await fetch(base + '/api/roster?' + new URLSearchParams(query))).json();
  const response = await fetch(base + '/api/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Attendance-Client': '1' }, body: JSON.stringify({ ...query, snapshot: roster.snapshot, requestId: randomUUID(), changes: [{ memberId: roster.members[0].id, attended: true }] }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).status, 'confirmed');
});
