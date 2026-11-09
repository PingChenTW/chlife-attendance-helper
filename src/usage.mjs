import { ensure } from './errors.mjs';
import { MEETINGS, CHILD_MEETINGS } from './scopes.mjs';

export const FIELDS = ['attendanceViews', 'reportViews', 'rosterReads', 'reportReads', 'submissions', 'confirmedBatches', 'unconfirmedBatches', 'confirmedChanges', 'failures', 'metadataReads', 'metadataFailures', 'clientConnectionFailures', 'rateLimited'];
export const MEETING_LABELS = new Map([...MEETINGS, ...CHILD_MEETINGS].map(([key, label]) => [key, label]));
const NUMERALS = ['', '一', '二', '三', '四', '五', '六', '七', '八'];
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });
export const dayKey = date => formatter.format(date);
export const shift = (day, offset) => new Date(new Date(day + 'T00:00:00Z').getTime() + offset * 86400000).toISOString().slice(0, 10);
const empty = () => Object.fromEntries(FIELDS.map(field => [field, 0]));
const add = (target, source) => { for (const key of FIELDS) target[key] += source[key]; };

// Only numeric aggregates live here. No original roster, payload, member ID, IP or browser identity is stored.
export class UsageStatistics {
  constructor({ now = () => new Date(), groups = ['1','2','3','4','5','6','7','8'], mode = 'live' } = {}) {
    this.now = now; this.startedAt = this.now().toISOString(); this.mode = mode;
    this.groups = [...new Set(groups)].filter(group => /^[1-8]$/.test(group)).sort();
    this.days = new Map(); this.submitted = new Map();
  }
  groupKey(group) {
    ensure(typeof group === 'string' && this.groups.includes(group), 400, 'USAGE_GROUP', '請選擇已開放的大組。');
    return group;
  }
  prune() {
    const oldest = shift(dayKey(this.now()), -29);
    for (const day of this.days.keys()) if (day < oldest) this.days.delete(day);
    const time = this.now().getTime();
    for (const [key, expires] of this.submitted) if (expires <= time) this.submitted.delete(key);
  }
  record(group, changes, meeting) {
    ensure(Object.entries(changes).every(([key,value]) => FIELDS.includes(key) && Number.isSafeInteger(value) && value >= 0), 400, 'USAGE_EVENT', '使用統計事件格式不正確。');
    this.groupKey(group); this.prune();
    const day = dayKey(this.now());
    if (!this.days.has(day)) this.days.set(day, new Map());
    const rows = this.days.get(day);
    if (!rows.has(group)) rows.set(group, { counters: empty(), meetings: new Map(), lastActivity: null });
    const row = rows.get(group);
    for (const [key, value] of Object.entries(changes)) row.counters[key] += value;
    row.lastActivity = this.now().toISOString();
    if (MEETING_LABELS.has(meeting)) {
      if (!row.meetings.has(meeting)) row.meetings.set(meeting, empty());
      for (const [key, value] of Object.entries(changes)) row.meetings.get(meeting)[key] += value;
    }
  }
  recordView(body) {
    ensure(body && !Array.isArray(body) && Object.keys(body).length === 2 && Object.keys(body).every(key => ['group','page'].includes(key)) && ['attendance','reports'].includes(body.page), 400, 'USAGE_EVENT', '使用統計事件格式不正確。');
    this.record(body.group, { [body.page === 'attendance' ? 'attendanceViews' : 'reportViews']: 1 });
  }
  recordOperation(group, kind, meeting) {
    ensure(['rosterReads', 'reportReads', 'metadataReads'].includes(kind), 400, 'USAGE_EVENT', '使用統計事件格式不正確。');
    this.record(group, { [kind]: 1 }, meeting);
  }
  recordFailure(group, meeting, operation) { this.record(group, { failures: 1, ...(operation === 'metadata' ? {metadataFailures:1} : {}) }, meeting); }
  recordRateLimited(group) { this.record(group, {rateLimited:1}); }
  recordClientDiagnostic(body) {
    const fields=['group','stage','code','durationMs','occurredAt','eventId'];
    ensure(body && !Array.isArray(body) && Object.keys(body).length === fields.length && Object.keys(body).every(key=>fields.includes(key)) &&
      ['helper-connect','metadata','roster','attendance','report'].includes(body.stage) && ['CLIENT_TIMEOUT','CLIENT_NETWORK','CLIENT_OFFLINE','HELPER_NON_JSON'].includes(body.code) &&
      Number.isSafeInteger(body.durationMs) && body.durationMs >= 0 && body.durationMs <= 600000 &&
      typeof body.occurredAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.occurredAt) && !Number.isNaN(Date.parse(body.occurredAt)) &&
      typeof body.eventId === 'string' && /^[a-f0-9-]{36}$/i.test(body.eventId), 400, 'USAGE_EVENT', '連線回報格式不正確。');
    this.groupKey(body.group); this.prune();
    const key='diagnostic:'+body.group+':'+body.eventId;
    if(this.submitted.has(key)) return false;
    if(this.submitted.size>=8000)this.submitted.delete(this.submitted.keys().next().value);
    this.submitted.set(key,this.now().getTime()+30*60000);
    // Persistent mode hashes this short-lived event key; only a numeric increment reaches Redis.
    this.record(body.group,{clientConnectionFailures:1},undefined,key); return true;
  }
  recordSubmission(group, requestId, result, meeting) {
    this.groupKey(group); this.prune();
    ensure(typeof requestId === 'string' && /^[0-9a-f-]{36}$/i.test(requestId) && ['confirmed','partial','unconfirmed'].includes(result?.status) &&
      Number.isSafeInteger(result.confirmed) && Number.isSafeInteger(result.total) && result.confirmed >= 0 && result.confirmed <= result.total && result.total <= 500,
    400, 'USAGE_RESULT', '無法確認點名統計結果。');
    const key = group + ':' + requestId;
    if (this.submitted.has(key)) return;
    // This short-lived ID is only for duplicate-batch suppression, never a person/browser identifier.
    if (this.submitted.size >= 8000) this.submitted.delete(this.submitted.keys().next().value);
    this.submitted.set(key, this.now().getTime() + 30 * 60000);
    this.record(group, { submissions: 1, confirmedBatches: result.status === 'confirmed' ? 1 : 0,
      unconfirmedBatches: result.status === 'confirmed' ? 0 : 1, confirmedChanges: result.confirmed }, meeting, key);
  }
  summary({ period = '7d', group = 'all' } = {}) {
    const periods = { today: 1, '7d': 7, '30d': 30 };
    ensure(Object.hasOwn(periods, period), 400, 'USAGE_PERIOD', '請選擇今天、近七日或近三十日。');
    if (group !== 'all') this.groupKey(group);
    this.prune();
    const to = dayKey(this.now()), from = shift(to, 1 - periods[period]), startedDay = dayKey(new Date(this.startedAt));
    const selected = group === 'all' ? this.groups : [group], totals = empty();
    const byGroup = new Map(selected.map(key => [key, { key, label: NUMERALS[Number(key)] + '大組', ...empty(), lastActivity: null }]));
    const byMeeting = new Map([...MEETING_LABELS].map(([key, label]) => [key, { key, label, ...empty() }]));
    const daily = [];
    let lastActivity = null;
    for (let i = 0; i < periods[period]; i++) {
      const day = shift(from, i), counters = empty();
      for (const key of selected) {
        const row = this.days.get(day)?.get(key); if (!row) continue;
        add(counters, row.counters); add(byGroup.get(key), row.counters);
        byGroup.get(key).lastActivity = row.lastActivity;
        if (!lastActivity || row.lastActivity > lastActivity) lastActivity = row.lastActivity;
        for (const [meeting, values] of row.meetings) add(byMeeting.get(meeting), values);
      }
      add(totals, counters); daily.push({ day, covered: day >= startedDay, ...counters });
    }
    return { storage: 'memory', mode: this.mode, startedAt: this.startedAt, generatedAt: this.now().toISOString(), timeZone: 'Asia/Taipei', retentionDays: 30,
      range: { period, from, to, coveredFrom: from > startedDay ? from : startedDay }, filterGroup: group,
      groups: this.groups.map(key => ({ key, label: NUMERALS[Number(key)] + '大組' })), totals, daily,
      byGroup: [...byGroup.values()], byMeeting: [...byMeeting.values()], lastActivity };
  }
}
