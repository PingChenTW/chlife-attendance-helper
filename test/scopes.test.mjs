import test from 'node:test';
import assert from 'node:assert/strict';
import { selectScopes, memberMatchesScope } from '../src/scopes.mjs';
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
