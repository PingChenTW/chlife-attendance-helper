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

test('children roster is a subset, shares attendance records, and binds snapshots to its audience', async () => {
  const { service, query, roster, adapter } = await setup();
  const childQuery = { ...query, audience: 'children', meeting: 'children-sunday' };
  const children = await service.roster(childQuery);
  assert.equal(children.audience, 'children');
  assert.ok(children.members.length > 0 && children.members.length < roster.members.length);
  assert.ok(children.members.every(child => roster.members.some(member => member.id === child.id)));
  const child = children.members[0];
  const input = { ...childQuery, snapshot: children.snapshot, requestId: randomUUID(), changes: [{ memberId: child.id, attended: !child.attended }] };
  await assert.rejects(service.submit({ ...input, audience: 'all', meeting: query.meeting }), /名單與送出範圍/);
  await assert.rejects(service.submit({ ...input, changes: [{ memberId: roster.members.find(member => !children.members.some(c => c.id === member.id)).id, attended: true }] }), /名單或權限/);
  await assert.rejects(service.roster({ ...query, audience: 'adults' }), /名單種類/);
  assert.equal(adapter.writeCount, 0);
  const result = await service.submit(input);
  assert.equal(result.status, 'confirmed');
  assert.equal(result.roster.audience, 'children');
  assert.equal((await service.roster(query)).members.find(member => member.id === child.id).attended, !child.attended);
  assert.equal(adapter.writeCount, 1);
});

test('a person leaving the children roster cannot be marked through an old children snapshot', async () => {
  const { service, query, adapter } = await setup();
  const childQuery = { ...query, audience: 'children', meeting: 'children-sunday' }, children = await service.roster(childQuery);
  const child = children.members[0], original = adapter.roster.bind(adapter);
  adapter.roster = async (...args) => (await original(...args)).filter(member => args[3] !== 'children' || member.id !== child.id);
  await assert.rejects(service.submit({ ...childQuery, snapshot: children.snapshot, requestId: randomUUID(), changes: [{ memberId: child.id, attended: true }] }), /名單或權限/);
  assert.equal(adapter.writeCount, 0);
});

test('existing clients without an audience keep working with earlier all-member snapshots', async () => {
  const { service, query, roster, input } = await setup();
  const previous = service.verify(roster.snapshot); delete previous.audience;
  const result = await service.submit({ ...input, snapshot: service.sign(previous) });
  assert.equal(result.status, 'confirmed');
  assert.equal((await service.roster(query)).audience, 'all');
});

test('children have exactly three meeting choices, with independent group and home attendance', async () => {
  const { service, query } = await setup(), meta = await service.metadata();
  assert.deepEqual(meta.childMeetings.map(meeting => meeting.label), ['兒童主日', '兒童排', '兒童家聚會']);
  assert.equal(meta.meetings.length, 7);
  await assert.rejects(service.roster({ ...query, audience: 'children' }), /無法使用這個聚會/);
  await assert.rejects(service.roster({ ...query, meeting: 'children-group' }), /無法使用這個聚會/);
  const childQuery = { ...query, audience: 'children', meeting: 'children-group' };
  const group = await service.roster(childQuery), child = group.members[0];
  await service.submit({ ...childQuery, snapshot: group.snapshot, requestId: randomUUID(), changes: [{ memberId: child.id, attended: !child.attended }] });
  assert.equal((await service.roster(childQuery)).members[0].attended, !child.attended);
  assert.equal((await service.roster({ ...childQuery, meeting: 'children-home' })).members[0].attended, child.attended);
  assert.equal((await service.roster({ ...query, meeting: 'group' })).members[0].attended, child.attended);
});
