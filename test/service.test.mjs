import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AttendanceService } from '../src/service.mjs';
import { DemoAdapter } from '../src/demo.mjs';

const now = () => new Date('2026-10-28T04:00:00Z');
async function setup() {
  const adapter = new DemoAdapter();
  const service = new AttendanceService(adapter, { now, allowWrites: true });
  const meta = await service.metadata();
  const query = { week: meta.weeks[0].key, scope: meta.scopes[0].key, meeting: meta.meetings[0].key };
  const roster = await service.roster(query);
  const input = { ...query, snapshot: roster.snapshot, requestId: randomUUID(), changes: [{ memberId: roster.members[0].id, attended: !roster.members[0].attended }] };
  return { adapter, service, query, roster, input };
}

test('only submitted people change, with explicit target values and readback', async () => {
  const { service, query, input, roster } = await setup();
  const result = await service.submit(input);
  assert.equal(result.status, 'confirmed');
  const after = await service.roster(query);
  assert.equal(after.members[0].attended, input.changes[0].attended);
  assert.deepEqual(after.members.slice(1), roster.members.slice(1));
});

test('concurrent duplicate submissions are idempotent', async () => {
  const { service, input, adapter } = await setup();
  const [a, b] = await Promise.all([service.submit(input), service.submit(input)]);
  assert.equal(a.status, 'confirmed');
  assert.deepEqual(b, a);
  assert.equal(adapter.writeCount, 1);
  await assert.rejects(service.submit({ ...input, changes: [{ ...input.changes[0], attended: !input.changes[0].attended }] }), /重複/);
});

test('timeout after upstream applies is resolved by readback without another write', async () => {
  const { service, input, adapter } = await setup();
  adapter.afterWriteError = true;
  const result = await service.submit(input);
  assert.equal(result.status, 'confirmed');
  assert.equal(adapter.writeCount, 1);
});

test('unavailable readback never reports confirmed success', async () => {
  const { service, input, adapter } = await setup();
  adapter.failReadAfterWrite = true;
  const result = await service.submit(input);
  assert.equal(result.status, 'unconfirmed');
  assert.equal(result.results[0].status, 'unknown');
});

test('scope, meeting, week, snapshot tampering, and unknown member are rejected before writing', async () => {
  const { service, input, adapter } = await setup();
  for (const patch of [
    { scope: 'l3:99999' }, { meeting: 'admin' }, { week: '2026-W01' },
    { snapshot: input.snapshot + 'x' }, { changes: [{ memberId: 999999, attended: true }] },
    { changes: [{ memberId: input.changes[0].memberId, attended: 'true' }] }
  ]) await assert.rejects(service.submit({ ...input, ...patch, requestId: randomUUID() }));
  assert.equal(adapter.writeCount, 0);
});

test('a removed or read-only member prevents the entire batch from writing', async () => {
  const { service, input, adapter } = await setup();
  adapter.readOnlyIds.add(input.changes[0].memberId);
  await assert.rejects(service.submit(input), /名單或權限/);
  assert.equal(adapter.writeCount, 0);
});

test('live read-only switch blocks mutation', async () => {
  const { adapter, input } = await setup();
  const service = new AttendanceService(adapter, { now, allowWrites: false });
  await assert.rejects(service.submit(input), /尚未開放/);
  assert.equal(adapter.writeCount, 0);
});
