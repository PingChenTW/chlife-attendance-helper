import { ensure, AppError } from './errors.mjs';
import { weekOptions, requireWeek } from './weeks.mjs';
import { ChlifeAdapter } from './upstream.mjs';
import configuredBaselines from './report-config.json' with { type: 'json' };

const FIELDS = ['sunday', 'gospel', 'home-in', 'home-out', 'reading', 'group', 'children-sunday', 'children-group'];
const count = value => Number.isSafeInteger(value) && value >= 0;
const sum = values => values.every(count) ? values.reduce((a,b) => a+b,0) : null;
const ratio = (value, base) => count(value) && count(base) && base > 0 ? value/base*100 : null;
function calculated(row) {
  const homeTotal = sum([row['home-in'],row['home-out']]);
  return { ...row, homeTotal, sundayRatio: ratio(row.sunday,row.baseline), gospelRatio: ratio(row.gospel,row.baseline), homeRatio: ratio(homeTotal,row.baseline) };
}
export function configuredReportSources(primary, json) {
  const sources = [{ key: 'primary', label: '目前服事範圍', adapter: primary }];
  if (!json) return sources;
  let entries;
  try { entries = JSON.parse(json); } catch { throw new AppError(500,'REPORT_CONFIG','報表來源設定格式有誤，請管理者檢查機密設定。'); }
  ensure(Array.isArray(entries) && entries.length <= 8,500,'REPORT_CONFIG','報表最多可設定八個額外來源。');
  const keys = new Set(['primary']);
  for (const entry of entries) {
    ensure(entry && /^[a-z][a-z0-9-]{0,39}$/.test(entry.key) && !keys.has(entry.key) && typeof entry.label === 'string' && entry.label.trim().length > 0 && entry.label.length <= 80 && Number.isSafeInteger(entry.churchId) && entry.churchId > 0 && typeof entry.account === 'string' && entry.account && typeof entry.password === 'string' && entry.password,500,'REPORT_CONFIG','報表來源設定不完整或代碼重複。');
    keys.add(entry.key);
    sources.push({ key: entry.key, label: entry.label.trim(), adapter: new ChlifeAdapter(entry) });
  }
  return sources;
}
export class ReportService {
  constructor(sources, { now = () => new Date(), baselines = configuredBaselines } = {}) { this.sources = sources; this.now = now; this.baselines = baselines; }
  metadata() { return { weeks: weekOptions(this.now()), sources: this.sources.map(({key,label}) => ({key,label})) }; }
  async weekly(query) {
    const week = requireWeek(query.week,this.now());
    const source = this.sources.find(s => s.key === (query.source ?? 'primary'));
    ensure(source,403,'REPORT_SOURCE','無法使用這個資料來源，請重新選擇。');
    const meta = await source.adapter.metadata(week);
    // Only fully granted level-3 nodes qualify. A grant to one level-4 group never grants its entire parent district.
    const scopes = meta.scopes.filter(s => s.level === 3 && Number.isSafeInteger(s.ids?.[2]) && Number.isSafeInteger(s.ids?.[3]));
    const groups = [...new Map(scopes.map(s => [`l2:${s.ids[2]}`, { key: `l2:${s.ids[2]}`, label: s.path.split(' / ')[0] }])).values()];
    const group = groups.find(g => g.key === (query.group || groups[0]?.key));
    ensure(group,403,'REPORT_GROUP','這個來源目前沒有可讀取完整小區報表的權限。');
    const districts = scopes.filter(s => `l2:${s.ids[2]}` === group.key);
    const data = await source.adapter.reportCounts(week,districts,meta);
    ensure(Array.isArray(data) && data.length === districts.length && new Set(data.map(r=>r.scope)).size === data.length,502,'REPORT_INCOMPLETE','原網站報表資料不完整，請重新讀取。');
    const rows = districts.map(scope => {
      const value = data.find(r=>r.scope===scope.key);
      ensure(value && FIELDS.every(key => value[key] === null || count(value[key])),502,'REPORT_INCOMPLETE','原網站報表資料不完整，請重新讀取。');
      const base = this.baselines[source.key]?.[week.year]?.[source.adapter.churchId]?.[scope.ids[3]];
      return calculated({ scope: scope.key, label: scope.label, baseline: count(base) ? base : null, ...Object.fromEntries(FIELDS.map(key=>[key,value[key]])) });
    });
    const totals = calculated({ label: '小計', baseline: sum(rows.map(r=>r.baseline)), ...Object.fromEntries(FIELDS.map(key=>[key,sum(rows.map(r=>r[key]))])) });
    return { week, source: {key:source.key,label:source.label}, church:meta.church, group, groups, mode:source.adapter.mode,
      rows, totals, loadedAt:this.now().toISOString(), inProgress:week.key===weekOptions(this.now())[0].key, baselineYear:week.year };
  }
}
