import test from 'node:test';
import assert from 'node:assert/strict';
import { weekOptions, requireWeek } from '../src/weeks.mjs';

test('Taipei Monday rollover, current/previous week and ISO year boundaries', () => {
  const before = weekOptions(new Date('2026-10-25T15:59:59Z'));
  const after = weekOptions(new Date('2026-10-25T16:00:00Z'));
  assert.equal(before[0].key, '2026-W43');
  assert.equal(after[0].key, '2026-W44');
  assert.equal(after[0].start, '2026-10-26');
  assert.equal(after[0].end, '2026-11-01');
  assert.equal(after[1].key, '2026-W43');
  const boundary = weekOptions(new Date('2027-01-04T00:00:00Z'));
  assert.equal(boundary[0].key, '2027-W01');
  assert.equal(boundary[1].key, '2026-W53');
  assert.throws(() => requireWeek('2026-W40', new Date('2026-10-28T00:00:00Z')), /本週或上週/);
});
