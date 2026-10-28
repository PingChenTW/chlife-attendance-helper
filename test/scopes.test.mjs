import test from 'node:test';
import assert from 'node:assert/strict';
import { selectScopes, memberMatchesScope, selectChildMeetings } from '../src/scopes.mjs';
test('account grants constrain districts, including same numeric IDs at different levels', () => {
  const tree = [{ id: 49, name: '召會', level: 1, children: [
    { id: 100, name: '有權限大組', level: 2, children: [{ id: 200, name: '小區', level: 3, children: [{ id: 200, name: '排', level: 4 }] }] },
    { id: 101, name: '其他大組', level: 2, children: [{ id: 201, name: '其他小區', level: 3 }] }
  ] }];
  const scopes = selectScopes(tree, { privileges: [{ church_id: 100, level: 2 }] });
  assert.deepEqual(scopes.map(s => s.key), ['l3:200', 'l4:200']);
  assert.equal(memberMatchesScope('49,100,200,200', scopes[1]), true);
  assert.equal(memberMatchesScope('49,101,200,200', scopes[1]), false);
  assert.throws(() => selectScopes(tree, { privileges: [] }), /沒有可用/);
});

test('children meetings map only to exact official fields, including Add meeting entries', () => {
  const rows = [{ id: 37, name: '主日', enable: '2', visible: 1 }, { id: 797, name: '兒童排(兒童)', enable: '1', visible: 0 }, { id: 2475, name: '家聚會(兒童)', enable: '1', visible: 0 }, { id: 740, name: '兒童排服事', enable: '1', visible: 0 }];
  assert.deepEqual(selectChildMeetings(rows).map(meeting => meeting.id), [37, 797, 2475]);
  assert.deepEqual(selectChildMeetings(rows.slice(0, 2)), []);
  assert.deepEqual(selectChildMeetings([...rows, rows[1]]), []);
  assert.deepEqual(selectChildMeetings(rows.map(row => row.id === 797 ? { ...row, enable: 0 } : row)), []);
});
