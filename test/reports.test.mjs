import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportService, configuredReportSources } from '../src/reports.mjs';
import { ChlifeAdapter } from '../src/upstream.mjs';
import { reportNumber, reportCsv } from '../public/report-model.js';

const now = () => new Date('2026-10-28T04:00:00Z');
function adapter(churchId = 49) {
  return { mode: 'demo', churchId, calls: [], async metadata() { return {
    church: '測試召會', scopes: [
      { key: 'l3:200', label: '同名區', level: 3, path: '甲大組 / 同名區', ids: { 1: churchId, 2: 100, 3: 200 } },
      { key: 'l3:201', label: '乙區', level: 3, path: '甲大組 / 乙區', ids: { 1: churchId, 2: 100, 3: 201 } },
      { key: 'l3:300', label: '新小區', level: 3, path: '乙大組 / 新小區', ids: { 1: churchId, 2: 101, 3: 300 } },
      { key: 'l4:999', label: '不列排', level: 4, ids: { 1: churchId, 2: 100, 3: 200, 4: 999 } }
    ], meetings: ['sunday','gospel','home-in','home-out','reading','group'].map((key,i) => ({ key, id: i+1 })),
    childMeetings: [{ key: 'children-sunday', id: 1 }, { key: 'children-group', id: 8 }] };
  }, async reportCounts(week, scopes) { this.calls.push(scopes.map(s => s.key)); return scopes.map((s,i) => ({ scope: s.key, sunday: i ? 20 : 10, gospel: 2, 'home-in': 3, 'home-out': 4, reading: 5, group: 6, 'children-sunday': 7, 'children-group': 8 })); } };
}
const baselines = { 2026: { 49: { 3: { 200: 12, 201: 23 } } } };
test('dynamic groups, totals use ratios of sums, no fixed districts and no attendance writes', async () => {
  const a = adapter(), service = new ReportService([{ key: 'primary', label: '來源甲', adapter: a }], { now, baselines });
  const report = await service.weekly({ week: '2026-W44', source: 'primary', group: 'l2:100' });
  assert.equal(report.groups.length, 2); assert.equal(report.rows.length, 2);
  assert.deepEqual(a.calls, [['l3:200','l3:201']]);
  assert.equal(report.totals.baseline, 35); assert.equal(report.totals.sunday, 30);
  assert.equal(report.totals.sundayRatio, 30/35*100); assert.equal(report.totals.homeTotal, 14);
  const newGroup = await service.weekly({ week: '2026-W43', source: 'primary', group: 'l2:101' });
  assert.equal(newGroup.rows[0].baseline, null); assert.equal(newGroup.totals.sundayRatio, null);
  for (const query of [{ source: 'unknown' }, { group: 'l2:999' }, { week: '2026-W42' }]) await assert.rejects(service.weekly({ week: '2026-W44', source: 'primary', ...query }));
});
test('accounts with identical district IDs stay separate; credentials never leave registry', async () => {
  const a = adapter(), b = adapter(50);
  const service = new ReportService([{ key: 'primary', label: '甲', adapter: a }, { key: 'second', label: '乙', adapter: b }], { now, baselines });
  const result = await service.weekly({ week: '2026-W44', source: 'second', group: 'l2:100' });
  assert.equal(a.calls.length, 0); assert.equal(b.calls.length, 1); assert.equal(result.rows[0].baseline, null);
  const sameChurch=new ReportService([{key:'another',label:'同召會另一帳號',adapter:adapter()}],{now,baselines});
  assert.equal((await sameChurch.weekly({week:'2026-W44',source:'another',group:'l2:100'})).rows[0].baseline,12);
  assert.deepEqual(service.metadata().sources, [{ key: 'primary', label: '甲' }, { key: 'second', label: '乙' }]);
  assert.equal(JSON.stringify(service.metadata()).includes('adapter'), false);
  const sources = configuredReportSources(a, JSON.stringify([{ key: 'other', label: '新來源', churchId: 50, account: 'fake', password: 'test-secret' }]));
  assert.equal(sources.length, 2); assert.equal(sources[1].adapter.churchId, 50);
  assert.throws(() => configuredReportSources(a, '[{"key":"primary"}]'));
  assert.throws(() => configuredReportSources(a, 'not json'));
});
test('missing values and missing yearly baselines never become zero or partial ratios', async () => {
  const a = adapter(); a.reportCounts = async (_, scopes) => scopes.map(s => ({ scope: s.key, sunday: null, gospel: 0, 'home-in': 0, 'home-out': 0, reading: 0, group: 0, 'children-sunday': 0, 'children-group': 0 }));
  const service = new ReportService([{ key: 'primary', label: '甲', adapter: a }], { now, baselines });
  const r = await service.weekly({ week: '2026-W44' });
  assert.equal(r.totals.sunday, null); assert.equal(r.totals.sundayRatio, null); assert.equal(r.totals.gospelRatio, 0);
  const nextYear = new ReportService(service.sources, { now: () => new Date('2027-01-06T04:00:00Z'), baselines });
  assert.equal((await nextYear.weekly({ week: '2027-W01' })).totals.baseline, null);
  a.reportCounts = async () => [];
  await assert.rejects(service.weekly({ week: '2026-W44' }), /不完整/);
});
test('upstream formal weekly uses official defaults and both child roles, filters unrelated rows and validates schema', async () => {
  const calls = [], a = new ChlifeAdapter({ churchId: 49, account: 'fake', password: 'fake' });
  const scopes = (await adapter().metadata()).scopes.slice(0,2);
  const meta = await adapter().metadata();
  a.request = async path => { const u = new URL(path,'https://example.test'); calls.push(u);
    return { meetings: [1,2,3,4,5,6,8].map(id => ({ id })), rows: [200,201,999].map(id => ({ node_id: id, row_kind: 'node', attendance: Object.fromEntries([1,2,3,4,5,6,8].map(k => [k,2])) })) };
  };
  const rows = await a.reportCounts({ year: 2026, week: 44 },scopes,meta);
  assert.equal(rows.length, 2); assert.equal(rows[0].sunday, 2); assert.equal(rows[0]['children-sunday'], 4);
  assert.deepEqual(calls.map(u=>u.searchParams.get('role')), [null,'學齡前','國小']);
  assert.equal(calls[0].searchParams.get('audience'),null);
  assert.equal(calls[0].searchParams.get('split_children_sunday'),'1');
  assert.equal(calls[1].searchParams.get('split_children_sunday'),'0');
  for (const call of calls) { assert.equal(call.searchParams.get('lv3_ids'),'200,201'); assert.equal(call.searchParams.get('lv2_ids'),'100'); assert.equal(call.searchParams.get('row_contract'),'2'); }
  a.request = async () => ({ meetings: [], rows: [] });
  await assert.rejects(a.reportCounts({ year: 2026, week: 44 },scopes,meta), /欄位/);
  a.request = async () => ({ meetings: [1,2,3,4,5,6,8].map(id=>({id})), rows: [] });
  await assert.rejects(a.reportCounts({ year: 2026, week: 44 },scopes,meta), /不完整/);
});
test('official role-filtered reports omit districts with no eligible children, while general missing rows still fail', async () => {
  const a = new ChlifeAdapter({churchId:49,account:'fake',password:'fake'}), meta = await adapter().metadata(), scopes = meta.scopes.slice(0,2);
  a.request = async path => { const p = new URL(path,'https://example.test').searchParams;return { meetings:[1,2,3,4,5,6,8].map(id=>({id})), rows:(p.has('role')?[200]:[200,201]).map(id=>({node_id:id,row_kind:'node',attendance:Object.fromEntries([1,2,3,4,5,6,8].map(k=>[k,2]))})) }; };
  const rows = await a.reportCounts({year:2026,week:44},scopes,meta);
  assert.equal(rows[1]['children-sunday'],0);assert.equal(rows[0]['children-sunday'],4);
});
test('CSV preserves Unicode, two decimals, unknowns and prevents spreadsheet formula execution', () => {
  assert.equal(reportNumber(null,'sunday'),'—'); assert.equal(reportNumber(133.3333,'sundayRatio'),'133.33%');
  const csv = reportCsv({church:'召會',group:{label:'大組'},week:{key:'2026-W44'},baselineYear:2026,rows:[{label:'=測試',baseline:12,sunday:16,sundayRatio:16/12*100}],totals:{label:'小計'}});
  assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=測試"'));assert.ok(csv.includes('"133.33%"'));assert.ok(csv.includes('2026 基數'));assert.ok(csv.includes('—'));
});
