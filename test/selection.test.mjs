import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionKey, readSelected, saveSelected, selectedMembers, addPeopleMembers } from '../public/selection.js';

function phone() { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), data }; }
const meta = { mode: 'live', church: '測試召會' };

test('browse all lists the current roster without adding people, while search and saved selections still work', () => {
  const roster = { members: [{ id: 1, name: '陳弟兄' }, { id: 2, name: '林姊妹' }, { id: 3, name: '陳姊妹' }] };
  const selected = new Set([2, 999]);
  assert.deepEqual(addPeopleMembers(roster, selected), [roster.members[1]]);
  assert.deepEqual(addPeopleMembers(roster, selected, '', true), roster.members);
  assert.deepEqual(addPeopleMembers(roster, selected, ' 陳 ', true), [roster.members[0], roster.members[2]]);
  assert.deepEqual(addPeopleMembers(roster, selected, '陳', false), [roster.members[0], roster.members[2]]);
  assert.deepEqual(addPeopleMembers(roster, selected, '找不到', true), []);
  assert.deepEqual(addPeopleMembers({ members: [] }, selected, '', true), []);
  assert.deepEqual([...selected], [2, 999]);
});
test('first use has no selected names; reload retains IDs without storing personal names', () => {
  const storage = phone(), key = selectionKey(meta, 'l3:611');
  assert.equal(readSelected(storage, key).size, 0);
  assert.equal(saveSelected(storage, key, new Set([2, 1])), true);
  assert.deepEqual([...readSelected(storage, key)], [2, 1]);
  assert.deepEqual(JSON.parse(storage.data.get(key)), { version: 1, ids: [2, 1] });
  assert.deepEqual(selectedMembers({ members: [{ id: 1, name: '甲' }, { id: 2, name: '乙' }, { id: 3, name: '丙' }] }, readSelected(storage, key)).map(m => m.name), ['乙', '甲']);
  assert.deepEqual(selectedMembers({ members: [{ id: 1 }] }, new Set()), []);
});
test('different phones, districts, practice and live data have separate selections', () => {
  const a = phone(), b = phone(), key = selectionKey(meta, 'l3:611');
  saveSelected(a, key, new Set([1]));
  assert.equal(readSelected(b, key).size, 0);
  assert.equal(readSelected(a, selectionKey(meta, 'l3:612')).size, 0);
  assert.equal(readSelected(a, selectionKey({ ...meta, mode: 'demo' }, 'l3:611')).size, 0);
  assert.equal(selectionKey(meta, 'l3:611', 'all'), key);
  assert.equal(readSelected(a, selectionKey(meta, 'l3:611', 'children')).size, 0);
  saveSelected(a, selectionKey(meta, 'l3:611', 'children'), new Set([2]));
  assert.deepEqual([...readSelected(a, key)], [1]);
  assert.deepEqual([...readSelected(a, selectionKey(meta, 'l3:611', 'children'))], [2]);
});
test('invalid storage cannot inject unknown names or force a false persistence claim', () => {
  const storage = phone(), key = selectionKey(meta, 'l3:611');
  storage.setItem(key, '{broken'); assert.equal(readSelected(storage, key).size, 0);
  storage.setItem(key, JSON.stringify({ version: 1, ids: [-1, '2', 2, 2, null] }));
  assert.deepEqual([...readSelected(storage, key)], [2]);
  assert.deepEqual(selectedMembers({ members: [{ id: 1 }] }, new Set([999])), []);
  assert.equal(saveSelected({ setItem() { throw new Error('Storage blocked'); } }, key, new Set([1])), false);
});
