import { ensure, AppError } from './errors.mjs';
import { weekOptions, requireWeek } from './weeks.mjs';
import { ChlifeAdapter } from './upstream.mjs';
import {BASELINES} from './baselines.mjs';
import profiles from './report-profiles.json' with { type: 'json' };

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
  constructor(sources, { now = () => new Date(), baselines = BASELINES } = {}) { this.sources = sources; this.now = now; this.baselines = baselines; }
  metadata() { return { weeks: weekOptions(this.now()), sources: this.sources.map(({key,label}) => ({key,label})), reportTypes:Object.entries(profiles).map(([key,{label,ready}])=>({key,label,ready})) }; }
  async summary(query) {
    requireWeek(query.week,this.now());
    throw new AppError(501,'SUMMARY_NOT_READY','各大組總表已預留介面，待設定總帳號及確認欄位口徑後啟用。');
  }
  async weekly(query) {
    const week = requireWeek(query.week,this.now());
    const source = this.sources.find(s => s.key === (query.source ?? 'primary'));
    ensure(source,403,'REPORT_SOURCE','無法使用這個資料來源，請重新選擇。');
    const meta = await source.adapter.metadata(week);
    // Only fully granted level-3 nodes qualify. A grant to one level-4 group never grants its entire parent district.
    const scopes = meta.scopes.filter(s => s.level === 3 && s.ids?.[1] === source.adapter.churchId && Number.isSafeInteger(s.ids?.[2]) && Number.isSafeInteger(s.ids?.[3]));
    const groups = (meta.reportGroups ?? [...new Map(scopes.map(s => [`l2:${s.ids[2]}`, { key: `l2:${s.ids[2]}`, label: s.path.split(' / ')[0] }])).values()]).map(({key,label})=>({key,label}));
    if(meta.supportsChurchReport)groups.push({key:'church',label:'全召會'});
    const group = groups.find(g => g.key === (query.group || meta.defaultReportGroup || groups[0]?.key));
    ensure(group,403,'REPORT_GROUP','這個來源目前沒有可讀取完整小區報表的權限。');
    const groupBase=id=>this.baselines[week.year]?.[source.adapter.churchId]?.[2]?.[id];
    const pack=(rows,baseline,rowLevel,baselineKind,info={})=>({week,source:{key:source.key,label:source.label},church:meta.church,group,groups,mode:source.adapter.mode,rows,
      totals:calculated({label:rowLevel===2?'合計':'小計',baseline,...Object.fromEntries(FIELDS.map(key=>[key,sum(rows.map(r=>r[key]))]))}),rowLevel,baselineKind,
      loadedAt:info.loadedAt??this.now().toISOString(),cacheSeconds:info.cacheSeconds??0,inProgress:week.key===weekOptions(this.now())[0].key,baselineYear:week.year});
    if(group.key==='church') {
      ensure(source.adapter.churchCounts,403,'REPORT_GROUP','這個來源尚未開放全召會報表。');
      const raw=await source.adapter.churchCounts(week,meta),values=Array.isArray(raw)?raw:raw?.rows;
      ensure(Array.isArray(values) && values.length && new Set(values.map(r=>r.scope)).size===values.length && values.every(r=>FIELDS.every(key=>r[key]===null || count(r[key]))),502,'REPORT_INCOMPLETE','原網站報表資料不完整。');
      const rows=values.map(r=>calculated({...r,baseline:count(groupBase(r.scope.split(':')[1]))?groupBase(r.scope.split(':')[1]):null}));
      return pack(rows,sum(meta.reportGroups.map(g=>groupBase(g.id))),2,'groups',raw);
    }
    const districts = scopes.filter(s => `l2:${s.ids[2]}` === group.key);
    ensure(districts.length,403,'REPORT_GROUP','這個大組目前沒有可讀取的小區報表。');
    const raw = await source.adapter.reportCounts(week,districts,meta);
    const data=Array.isArray(raw)?raw:raw?.rows;
    const omitted=raw.omittedScopes??[];
    ensure(Array.isArray(omitted) && omitted.every(key=>districts.some(s=>s.key===key)),502,'REPORT_INCOMPLETE','原網站已結束小區資料無法確認。');
    const listed=districts.filter(s=>!omitted.includes(s.key));
    ensure(Array.isArray(data) && data.length === listed.length && new Set(data.map(r=>r.scope)).size === data.length,502,'REPORT_INCOMPLETE','原網站報表資料不完整，請重新讀取。');
    const rows = listed.map(scope => {
      const value = data.find(r=>r.scope===scope.key);
      ensure(value && FIELDS.every(key => value[key] === null || count(value[key])),502,'REPORT_INCOMPLETE','原網站報表資料不完整，請重新讀取。');
      const base = this.baselines[week.year]?.[source.adapter.churchId]?.[3]?.[scope.ids[3]];
      return calculated({ scope: scope.key, label: scope.label, baseline: count(base) ? base : null, ...Object.fromEntries(FIELDS.map(key=>[key,value[key]])) });
    });
    for(const extra of raw.extraRows??[]) {
      ensure(extra && typeof extra.scope==='string' && !rows.some(r=>r.scope===extra.scope) && FIELDS.every(key=>extra[key]===null || count(extra[key])),502,'REPORT_INCOMPLETE','原網站直屬報表資料不完整。');
      rows.push(calculated({...extra,baseline:null}));
    }
    const explicitBase=groupBase(group.key.split(':')[1]);
    return pack(rows,count(explicitBase)?explicitBase:sum(rows.map(r=>r.baseline)),3,count(explicitBase)?'group':'districts',raw);
  }
}
