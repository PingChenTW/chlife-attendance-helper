import test from 'node:test';
import assert from 'node:assert/strict';
import { changesFor, mergeDesired, allDesiredConfirmed, districtScopes } from '../public/model.js';
import { createPracticeApi } from '../public/practice.js';

test('only districts are selectable, retaining order and the full district scope', () => {
  const district = { key: 'l3:200', label: '611區', level: 3, ids: { 1: 49, 2: 100, 3: 200 } };
  const next = { key: 'l3:201', label: '612區', level: '3' };
  const scopes = [{ key: 'l2:100', level: 2 }, district, { key: 'l4:200', label: '一排', level: 4 }, next];
  assert.deepEqual(districtScopes(scopes), [district, next]);
  assert.deepEqual(districtScopes([{ level: 4 }]), []);
  assert.deepEqual(districtScopes(), []);
  assert.equal(scopes.length, 4);
  assert.equal('4' in districtScopes(scopes)[0].ids, false);
});

test('partial readback keeps unsaved choices; removed records cannot become false success', () => {
  const roster = { members: [{ id: 1, attended: true, writable: true }, { id: 2, attended: false, writable: true }] };
  const desired = new Map([[1, true], [2, true], [3, true]]);
  assert.deepEqual([...mergeDesired(roster, desired)], [[2, true]]);
  assert.equal(allDesiredConfirmed(roster, desired), false);
  assert.deepEqual(changesFor(roster, desired), [{ memberId: 2, attended: true }]);
  assert.equal(allDesiredConfirmed(roster, new Map([[1, true]])), true);
});

test('static Pages practice works independently and keeps different meetings separate', async () => {
  const api = createPracticeApi();
  const meta = await api('/api/meta');
  assert.equal(meta.mode, 'demo'); assert.equal(meta.meetings.length, 7);
  const query = { week: meta.weeks[0].key, scope: meta.scopes[0].key, meeting: meta.meetings[0].key };
  const before = await api('/api/roster?' + new URLSearchParams(query));
  const input = { ...query, changes: [{ memberId: before.members[0].id, attended: true }] };
  const after = await api('/api/attendance', { body: JSON.stringify(input) });
  assert.equal(after.roster.members[0].attended, true);
  const another = await api('/api/roster?' + new URLSearchParams({ ...query, meeting: meta.meetings[1].key }));
  assert.equal(another.members[0].attended, false);
  assert.deepEqual(meta.childMeetings.map(meeting => meeting.label), ['兒童主日', '兒童排', '兒童家聚會']);
  const childQuery = { ...query, audience: 'children', meeting: meta.childMeetings[0].key };
  const children = await api('/api/roster?' + new URLSearchParams(childQuery));
  assert.ok(children.members.length < before.members.length);
  const savedChild = await api('/api/attendance', { body: JSON.stringify({ ...childQuery, changes: [{ memberId: children.members[0].id, attended: false }] }) });
  assert.equal(savedChild.roster.audience, 'children');
  assert.deepEqual(savedChild.roster.members.map(member => member.id), children.members.map(member => member.id));
  assert.equal((await api('/api/roster?' + new URLSearchParams(query))).members[0].attended, false);
});
