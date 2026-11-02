import { createHash, randomUUID } from 'node:crypto';
import { AppError, ensure } from './errors.mjs';
import { UsageStatistics, FIELDS, MEETING_LABELS, dayKey, shift } from './usage.mjs';
import { RedisUsageStore } from './usage-store.mjs';

const empty = () => Object.fromEntries(FIELDS.map(field => [field, 0]));
const hash = value => createHash('sha256').update(value).digest('hex');
const count = value => { const n = Number(value ?? 0); ensure(Number.isSafeInteger(n) && n >= 0, 503, 'USAGE_STORAGE', '統計資料尚未讀取成功，請稍後更新。'); return n; };

export class PersistentUsageStatistics extends UsageStatistics {
  constructor({ store, ...options } = {}) {
    super(options); this.store = store; this.pending = []; this.running = null; this.timer = null; this.dropped = 0; this.lastSavedAt = null;
  }
  record(group, changes, meeting, batchKey) {
    super.record(group, changes, meeting);
    if (this.pending.length >= 10000) { this.dropped++; return; }
    const at = this.now().toISOString();
    this.pending.push({ group, changes: { ...changes }, ...(MEETING_LABELS.has(meeting) ? { meeting } : {}), at, day: dayKey(new Date(at)), startedAt: this.startedAt,
      receipt: batchKey ? 'batch-' + hash(batchKey) : 'event-' + randomUUID() });
    if (!this.timer) void this.flush();
  }
  seed(rows) {
    ensure(Array.isArray(rows) && rows.length <= 8, 500, 'USAGE_SEED', '統計承接設定格式不正確。');
    const events = [];
    for (const row of rows) {
      this.groupKey(row.group);
      ensure(/^\d{4}-\d{2}-\d{2}$/.test(row.day) && !Number.isNaN(Date.parse(row.startedAt)) && !Number.isNaN(Date.parse(row.at)) && row.day <= dayKey(this.now()) && Array.isArray(row.meetings), 500, 'USAGE_SEED', '統計承接設定格式不正確。');
      const validate = values => {
        ensure(values && Object.keys(values).every(field => FIELDS.includes(field)) && Object.values(values).every(value => Number.isSafeInteger(value) && value >= 0), 500, 'USAGE_SEED', '統計承接數值不正確。');
        return { ...empty(), ...values };
      };
      const remainder = validate(row.counters);
      const make = (changes, meeting) => ({ group: row.group, changes, ...(meeting ? { meeting } : {}), at: new Date(row.at).toISOString(), day: row.day, startedAt: new Date(row.startedAt).toISOString(), seed: true,
        receipt: 'seed-v1-' + hash(row.group + ':' + row.day + ':' + (meeting ?? 'general')) });
      const seen = new Set();
      for (const meeting of row.meetings) {
        ensure(MEETING_LABELS.has(meeting.key) && !seen.has(meeting.key), 500, 'USAGE_SEED', '統計承接聚會設定不正確。'); seen.add(meeting.key);
        const counters = validate(meeting.counters);
        for (const field of FIELDS) remainder[field] -= counters[field];
        if (Object.values(counters).some(Boolean)) events.push(make(counters, meeting.key));
      }
      ensure(Object.values(remainder).every(value => value >= 0), 500, 'USAGE_SEED', '統計承接合計不一致。');
      if (Object.values(remainder).some(Boolean)) events.push(make(remainder));
    }
    this.pending.push(...events); // Validate all rows before enqueuing any import.
    if (events.length) void this.flush();
  }
  flush() {
    if (this.running) return this.running;
    clearTimeout(this.timer); this.timer = null;
    // Assign before the drain starts so a synchronous store cannot race the lock.
    this.running = Promise.resolve().then(async () => {
      try {
        while (this.pending.length) {
          const batch = this.pending.slice(0, 100);
          await this.store.write(batch);
          this.pending.splice(0, batch.length); this.lastSavedAt = this.now().toISOString();
        }
      } catch {
        this.timer = setTimeout(() => { void this.flush(); }, 15000); this.timer.unref?.();
      } finally { this.running = null; }
    });
    return this.running;
  }
  async summary(options = {}) {
    const shape = super.summary(options); // Validate filters before any database request.
    await this.flush();
    let saved;
    try { saved = await this.store.read(shape.daily.map(row => row.day)); }
    catch { throw new AppError(503, 'USAGE_STORAGE', '暫時無法讀取已保存的統計，點名仍可使用。請稍後更新。'); }
    const restored = new UsageStatistics({ now: this.now, groups: this.groups, mode: this.mode });
    restored.startedAt = saved.startedAt ?? this.startedAt;
    ensure(!Number.isNaN(Date.parse(restored.startedAt)), 503, 'USAGE_STORAGE', '統計資料尚未讀取成功，請稍後更新。');
    for (const [day, fields] of saved.days) {
      const rows = new Map();
      for (const group of this.groups) {
        if (!Object.keys(fields).some(key => key.startsWith(group + ':'))) continue;
        const counters = Object.fromEntries(FIELDS.map(key => [key, count(fields[group + ':' + key])]));
        const meetings = new Map([...MEETING_LABELS.keys()].map(meeting => [meeting, Object.fromEntries(FIELDS.map(key => [key, count(fields[group + ':m:' + meeting + ':' + key])]))]));
        rows.set(group, { counters, meetings, lastActivity: fields[group + ':lastActivity'] ?? null });
      }
      restored.days.set(day, rows);
    }
    const result = restored.summary(options), lifetimeTotals = empty();
    for (const group of result.filterGroup === 'all' ? this.groups : [result.filterGroup]) for (const key of FIELDS) lifetimeTotals[key] += count(saved.lifetime[group + ':' + key]);
    return { ...result, storage: 'redis', retentionDays: null, lifetimeTotals,
      persistence: { state: this.pending.length || this.dropped ? 'pending' : 'saved', pendingEvents: this.pending.length, droppedEvents: this.dropped, lastSavedAt: this.lastSavedAt } };
  }
}

export function configuredUsage(env, options) {
  const url = env.USAGE_REDIS_REST_URL, token = env.USAGE_REDIS_REST_TOKEN;
  if (!url && !token) return new UsageStatistics(options);
  const usage = new PersistentUsageStatistics({ ...options, store: new RedisUsageStore({ url, token }) });
  if (env.USAGE_SEED_JSON) {
    let rows; try { rows = JSON.parse(env.USAGE_SEED_JSON); } catch { throw new AppError(500, 'USAGE_SEED', '統計承接設定格式不正確。'); }
    usage.seed(rows);
  }
  return usage;
}
