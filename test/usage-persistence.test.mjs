import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PersistentUsageStatistics, configuredUsage } from '../src/persistent-usage.mjs';
import { RedisUsageStore, READ_USAGE, WRITE_USAGE } from '../src/usage-store.mjs';
import { once } from 'node:events';
import { createApp } from '../src/server.mjs';
import { AttendanceService } from '../src/service.mjs';
import { DemoAdapter } from '../src/demo.mjs';

// Fake Redis transport: exercises the REST wire contract and process lifecycle.
// Production smoke verification separately checks the Lua scripts on Upstash.
function database(now = () => new Date()) {
  const hashes = new Map(), receipts = new Map(); let startedAt = null, offline = false, loseReply = false;
  const calls = [];
  const command = async args => {
    calls.push(args); if (offline) throw new Error('offline');
    const [kind, script, n, ...rest] = args; assert.equal(kind, 'EVAL');
    const keys = rest.slice(0, n);
    const row = key => { if (!hashes.has(key)) hashes.set(key, {}); return hashes.get(key); };
    if (script === READ_USAGE) return [startedAt, ...keys.slice(1).map(key => Object.entries(row(key)).flat())];
    assert.equal(script, WRITE_USAGE);
    const events = JSON.parse(rest[n]);
    events.forEach((event, i) => {
      if ((receipts.get(keys[3+2*i]) ?? 0) > now().getTime()) return;
      startedAt ??= event.startedAt;
      for (const [field, amount] of Object.entries(event.changes)) {
        for (const key of [keys[1], keys[2+2*i]]) { const values = row(key); const name = event.group + ':' + field; values[name] = Number(values[name] ?? 0) + amount; }
        if (event.meeting) { const values = row(keys[2+2*i]), name = `${event.group}:m:${event.meeting}:${field}`; values[name] = Number(values[name] ?? 0) + amount; }
      }
      for (const key of [keys[1], keys[2+2*i]]) { const values = row(key), name = event.group + ':lastActivity'; if (!values[name] || values[name] < event.at) values[name] = event.at; }
      receipts.set(keys[3+2*i], event.seed ? Infinity : now().getTime() + 1800000);
    });
    if (loseReply) { loseReply = false; throw new Error('reply lost after commit'); }
    return 1;
  };
  return { store: new RedisUsageStore({ command }), calls, setOffline: value => { offline = value; }, loseNextReply: () => { loseReply = true; } };
}

test('persistent counts survive new processes, Taipei midnight and more than thirty days', async () => {
  let current = new Date('2026-11-02T15:59:00Z'); const now = () => current, db = database(now);
  const first = new PersistentUsageStatistics({ store: db.store, now, groups: ['1','6'] });
  first.recordOperation('6', 'rosterReads', 'prayer'); first.recordView({ group: '1', page: 'reports' }); await first.flush();
  current = new Date('2026-11-02T16:01:00Z');
  const second = new PersistentUsageStatistics({ store: db.store, now, groups: ['1','6'] });
  second.recordView({ group: '6', page: 'attendance' });
  const week = await second.summary({ period: '7d', group: '6' });
  assert.equal(week.storage, 'redis'); assert.equal(week.retentionDays, null); assert.equal(week.startedAt, first.startedAt);
  assert.equal(week.totals.rosterReads, 1); assert.equal(week.totals.attendanceViews, 1);
  assert.equal(week.byMeeting.find(row => row.key === 'prayer').rosterReads, 1);
  assert.equal(week.daily.at(-2).rosterReads, 1); assert.equal(week.daily.at(-1).attendanceViews, 1);
  assert.equal((await second.summary({ group: '1' })).totals.reportViews, 1);
  assert.equal((await second.summary({ group: '1' })).byGroup[0].lastActivity, '2026-11-02T15:59:00.000Z');
  current = new Date('2027-01-02T00:00:00Z');
  const later = await new PersistentUsageStatistics({ store: db.store, now }).summary({ period: '30d', group: '6' });
  assert.equal(later.totals.rosterReads, 0); assert.equal(later.lifetimeTotals.rosterReads, 1); assert.equal(later.lifetimeTotals.attendanceViews, 1);
});

test('numeric memory migration imports meeting totals once, without inventing duplicate counts', async () => {
  const db = database(), now = () => new Date('2026-11-02T03:00:00Z');
  const rows = [{ group: '6', day: '2026-11-02', startedAt: '2026-11-02T02:00:00Z', at: '2026-11-02T02:30:00Z', counters: { attendanceViews: 4, rosterReads: 7, submissions: 1, confirmedBatches: 1, confirmedChanges: 2 },
    meetings: [{ key: 'prayer', counters: { rosterReads: 7, submissions: 1, confirmedBatches: 1, confirmedChanges: 2 } }] }];
  const first = new PersistentUsageStatistics({ store: db.store, now }); first.seed(rows); await first.flush();
  const second = new PersistentUsageStatistics({ store: db.store, now }); second.seed(rows);
  const summary = await second.summary();
  assert.equal(summary.totals.attendanceViews, 4); assert.equal(summary.totals.rosterReads, 7); assert.equal(summary.totals.submissions, 1);
  assert.equal(summary.byMeeting.find(row => row.key === 'prayer').rosterReads, 7); assert.equal(summary.startedAt, '2026-11-02T02:00:00.000Z');
  assert.throws(() => second.seed([{ ...rows[0], counters: { name: 'PRIVATE' } }]));
  assert.throws(() => second.seed([{ ...rows[0], counters: { rosterReads: 2 } }]));
  assert.equal(second.pending.length, 0);
});

test('a stalled durable store cannot delay a confirmed attendance response', async t => {
  let release; const stalled = new Promise(resolve => { release = resolve; });
  const db = database(), store = { write: async events => { await stalled; return db.store.write(events); }, read: days => db.store.read(days) };
  const usage = new PersistentUsageStatistics({ store, groups: ['6'] });
  const adapter = new DemoAdapter(), service = new AttendanceService(adapter, { allowWrites: true });
  const server = createApp({ service, groups: new Map([['6', { service }]]), defaultGroup: '6', usage });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { release(); server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`, meta = await service.metadata();
  const query = { week: meta.weeks[0].key, scope: meta.scopes[0].key, meeting: 'prayer', audience: 'all' };
  const roster = await (await fetch(base + '/api/roster?' + new URLSearchParams(query))).json();
  const response = await fetch(base + '/api/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Attendance-Client': '1' },
    body: JSON.stringify({ ...query, snapshot: roster.snapshot, requestId: randomUUID(), changes: [{ memberId: roster.members[0].id, attended: true }] }), signal: AbortSignal.timeout(2000) });
  assert.equal(response.status, 200); assert.equal((await response.json()).status, 'confirmed'); assert.equal(adapter.writeCount, 1);
  assert.equal(usage.pending.length, 2); release(); await usage.flush();
  const statsResponse = await fetch(base + '/api/usage/summary?period=today');
  assert.equal(statsResponse.status, 200); const summary = await statsResponse.json();
  assert.equal(summary.storage, 'redis'); assert.equal(summary.totals.submissions, 1);
});

test('ambiguous commit/retry and a batch repeated across restarts do not double count', async () => {
  const db = database(), stats = new PersistentUsageStatistics({ store: db.store });
  db.loseNextReply(); stats.recordView({ group: '6', page: 'attendance' }); await stats.flush();
  assert.equal(stats.pending.length, 1); await stats.flush();
  const id = randomUUID(), result = { status: 'confirmed', confirmed: 3, total: 3, members: [{ name: 'PRIVATE', id: 999 }] };
  stats.recordSubmission('6', id, result, 'prayer'); await stats.flush();
  const restarted = new PersistentUsageStatistics({ store: db.store });
  restarted.recordSubmission('6', id, result, 'prayer'); await restarted.flush();
  const summary = await restarted.summary({ group: '6' });
  assert.equal(summary.totals.attendanceViews, 1); assert.equal(summary.totals.submissions, 1); assert.equal(summary.totals.confirmedChanges, 3);
  assert.doesNotMatch(JSON.stringify(db.calls), new RegExp(`${id}|PRIVATE|members|999`));
  assert.doesNotMatch(JSON.stringify(summary), /receipt|redis\.io|Bearer|PRIVATE/);
});

test('multiple instances add increments without overwriting each other', async () => {
  const db = database(), instances = Array.from({ length: 8 }, () => new PersistentUsageStatistics({ store: db.store }));
  await Promise.all(instances.map(async (stats, i) => { for (let n=0; n<20; n++) stats.recordView({ group: String(i+1), page: 'attendance' }); await stats.flush(); }));
  const summary = await instances[0].summary(); assert.equal(summary.totals.attendanceViews, 160);
  assert.ok(summary.byGroup.every(row => row.attendanceViews === 20));
});

test('storage failures retain pending events, never display false zero, and recover', async () => {
  const db = database(), stats = new PersistentUsageStatistics({ store: db.store });
  db.setOffline(true); stats.recordOperation('6', 'rosterReads', 'prayer'); await stats.flush();
  await assert.rejects(stats.summary(), error => error.status === 503 && !error.message.includes('offline'));
  assert.equal(stats.pending.length, 1);
  db.setOffline(false); const summary = await stats.summary();
  assert.equal(summary.totals.rosterReads, 1); assert.equal(summary.persistence.state, 'saved'); assert.equal(summary.persistence.pendingEvents, 0);
});

test('REST requests keep the credential in headers, never URL/errors, and configuration fails closed', async () => {
  const calls = [], token = 'PRIVATE_SERVER_SECRET';
  const store = new RedisUsageStore({ url: 'https://example-1.upstash.io', token, fetchImpl: async (...args) => { calls.push(args); return { ok: true, json: async () => ({ result: [null, [], []] }) }; } });
  await store.read(['2026-11-02']);
  assert.equal(calls[0][0], 'https://example-1.upstash.io'); assert.equal(calls[0][1].headers.Authorization, 'Bearer ' + token);
  assert.equal(calls[0][1].redirect, 'error'); assert.doesNotMatch(calls[0][1].body, /PRIVATE_SERVER_SECRET/);
  const broken = new RedisUsageStore({ url: 'https://example-1.upstash.io', token, fetchImpl: async () => { throw new Error(token); } });
  await assert.rejects(broken.read([]), error => !error.message.includes(token));
  assert.throws(() => configuredUsage({ USAGE_REDIS_REST_URL: 'https://example-1.upstash.io' }, {}));
  assert.throws(() => new RedisUsageStore({ url: 'https://example-1.upstash.io.evil.example', token }));
  assert.equal(configuredUsage({}, {}).summary().storage, 'memory');
});
