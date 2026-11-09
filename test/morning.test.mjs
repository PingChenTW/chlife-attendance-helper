import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MEETINGS, selectMeetings } from '../src/scopes.mjs';
import { AttendanceService } from '../src/service.mjs';
import { DemoAdapter } from '../src/demo.mjs';
import { UsageStatistics } from '../src/usage.mjs';
import { SelectionStore, selectionKey, saveSelected } from '../public/selection.js';
import { createPracticeApi } from '../public/practice.js';

test('morning maps to the exact enabled official meeting and is available in practice', async () => {
  const rows = MEETINGS.map(([, , name], index) => ({ id: 500 + index, name, enable: 2, visible: 1 }));
  assert.equal(rows.find(row => row.name === '晨興')?.id, 507);
  const morning = selectMeetings([...rows, { id: 999, name: '晨興服事', enable: 2, visible: 1 }]).find(row => row.key === 'morning');
  assert.deepEqual(morning, { key: 'morning', label: '晨興', id: 507 });
  assert.throws(() => selectMeetings(rows.filter(row => row.name !== '晨興')), /晨興/);
  assert.throws(() => selectMeetings([...rows, { id: 900, name: '晨興', enable: 2, visible: 1 }]), /晨興/);
  const practice = createPracticeApi(), meta = await practice('/api/meta');
  assert.equal(meta.meetings.find(row => row.key === 'morning')?.label, '晨興');
});

test('morning uses its own previous attendees even with legacy shared lists and keeps later phone choices', async () => {
  for (const legacyIds of [[2], []]) {
    const data = new Map(), storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
    const meta = { mode: 'live', church: '測試召會', siteKey: 'group-6', meetings: MEETINGS.map(([key]) => ({ key })), weeks: [{ key: 'current' }, { key: 'previous' }] };
    const query = { week: 'current', scope: 'l3:1', audience: 'all', meeting: 'morning' };
    const roster = { ...query, members: [{ id: 1, attended: false }, { id: 2, attended: true }] };
    saveSelected(storage, selectionKey(meta, query.scope), new Set(legacyIds));
    saveSelected(storage, selectionKey(meta, query.scope, 'all', 'prayer'), new Set([2]));
    const selections = new SelectionStore(storage);
    let reads = 0;
    const result = await selections.initialize({ meta, query, roster, readRoster: async q => {
      reads++; assert.equal(q.meeting, 'morning'); assert.equal(q.week, 'previous');
      return { ...roster, week: 'previous', members: [{ id: 1, attended: true }, { id: 2, attended: false }] };
    } });
    assert.equal(result.initialized, true); assert.equal(reads, 1); assert.deepEqual([...result.selected], [1]);
    assert.deepEqual([...selections.load(meta, query.scope, 'all', 'prayer')], [2]);
    assert.deepEqual([...selections.load(meta, query.scope, 'all', 'sunday')], legacyIds);
    selections.save(meta, query.scope, 'all', new Set(), 'morning');
    const reloaded = new SelectionStore(storage);
    const after = await reloaded.initialize({ meta, query: { ...query, week: 'previous' }, roster: { ...roster, week: 'previous' }, readRoster: () => assert.fail('saved empty morning list must stay empty') });
    assert.equal(after.initialized, false); assert.equal(after.selected.size, 0);
    assert.deepEqual([...reloaded.load(meta, query.scope, 'all', 'prayer')], [2]);
    assert.deepEqual(JSON.parse(storage.getItem(selectionKey(meta, query.scope))).ids, legacyIds);
  }
});

test('morning attendance confirms only that meeting and usage includes its anonymous counters', async () => {
  const adapter = new DemoAdapter(), service = new AttendanceService(adapter, { allowWrites: true });
  const meta = await service.metadata();
  assert.equal(meta.meetings.find(row => row.key === 'morning')?.label, '晨興');
  const query = { week: meta.weeks[0].key, scope: meta.scopes[0].key, audience: 'all', meeting: 'morning' };
  const before = await service.roster(query), prayer = await service.roster({ ...query, meeting: 'prayer' });
  const requestId = randomUUID(), result = await service.submit({ ...query, snapshot: before.snapshot, requestId, changes: [{ memberId: before.members[0].id, attended: !before.members[0].attended }] });
  assert.equal(result.status, 'confirmed');
  assert.equal((await service.roster(query)).members[0].attended, !before.members[0].attended);
  assert.deepEqual((await service.roster(query)).members.slice(1), before.members.slice(1));
  assert.deepEqual((await service.roster({ ...query, meeting: 'prayer' })).members, prayer.members);
  await assert.rejects(service.roster({ ...query, audience: 'children' }), /無法使用這個聚會/);
  const stats = new UsageStatistics();
  stats.recordOperation('6', 'rosterReads', 'morning'); stats.recordSubmission('6', requestId, result, 'morning');
  const usage = stats.summary({ period: 'today', group: '6' }).byMeeting.find(row => row.key === 'morning');
  assert.equal(usage.label, '晨興'); assert.equal(usage.rosterReads, 1); assert.equal(usage.confirmedChanges, 1);
});
