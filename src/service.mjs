import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, ensure } from './errors.mjs';
import { weekOptions, requireWeek } from './weeks.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const publicMember = row => ({ id: row.id, name: row.name, group: row.group, attended: row.attended, writable: row.writable });
export class AttendanceService {
  constructor(adapter, { now = () => new Date(), allowWrites = false, secret = randomBytes(32).toString('hex') } = {}) {
    this.adapter = adapter; this.now = now; this.allowWrites = allowWrites; this.secret = secret;
    this.queue = Promise.resolve(); this.requests = new Map();
  }
  sign(payload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encoded}.${createHmac('sha256', this.secret).update(encoded).digest('base64url')}`;
  }
  verify(token) {
    ensure(typeof token === 'string' && token.length < 200000, 400, 'BAD_SNAPSHOT', '名單憑證無效，請重新載入。');
    const parts = token.split('.');
    ensure(parts.length === 2 && /^[A-Za-z0-9_-]+$/.test(parts[0]), 400, 'BAD_SNAPSHOT', '名單憑證無效，請重新載入。');
    const expected = createHmac('sha256', this.secret).update(parts[0]).digest();
    const supplied = Buffer.from(parts[1], 'base64url');
    ensure(expected.length === supplied.length && timingSafeEqual(expected, supplied), 400, 'BAD_SNAPSHOT', '名單憑證無效，請重新載入。');
    let data;
    try { data = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); } catch { throw new AppError(400, 'BAD_SNAPSHOT', '名單憑證無效，請重新載入。'); }
    ensure(data.expires > this.now().getTime(), 409, 'SNAPSHOT_EXPIRED', '名單已超過 15 分鐘，請重新載入後核對點名。');
    return data;
  }
  async context(query) {
    const week = requireWeek(query.week, this.now());
    const meta = await this.adapter.metadata(week);
    const scope = meta.scopes.find(s => s.key === query.scope);
    const meeting = meta.meetings.find(m => m.key === query.meeting);
    ensure(scope, 403, 'SCOPE_NOT_ALLOWED', '無法使用這個小區，請重新選擇。');
    ensure(meeting, 400, 'MEETING_NOT_ALLOWED', '只能使用指定的七個點名項目。');
    return { week, meta, scope, meeting };
  }
  async metadata() {
    const weeks = weekOptions(this.now());
    const meta = await this.adapter.metadata(weeks[0]);
    return { church: meta.church, group: meta.group, weeks, mode: this.adapter.mode, writesEnabled: this.allowWrites,
      scopes: meta.scopes.map(({ key, label, path, level }) => ({ key, label, path, level })),
      meetings: meta.meetings.map(({ key, label }) => ({ key, label })) };
  }
  pack(query, members) {
    ensure(members.length <= 10000 && new Set(members.map(m => m.id)).size === members.length, 502, 'INVALID_ROSTER', '原網站名單格式有變動，請稍後再試。');
    return { ...query, members: members.map(publicMember), loadedAt: this.now().toISOString(),
      snapshot: this.sign({ ...query, expires: this.now().getTime() + 15 * 60000, rows: members.map(m => [m.id, m.attended, m.writable]) }) };
  }
  async roster(query) {
    const { week, scope, meeting } = await this.context(query);
    const members = await this.adapter.roster(week, scope, meeting);
    return this.pack({ week: week.key, scope: scope.key, meeting: meeting.key }, members);
  }
  submit(input) {
    const operation = this.queue.then(() => this.performSubmit(input));
    this.queue = operation.catch(() => {});
    return operation;
  }
  async performSubmit(input) {
    ensure(this.allowWrites, 403, 'READ_ONLY', '目前尚未開放正式寫入，您可以先查看名單。');
    ensure(typeof input.requestId === 'string' && /^[a-f0-9-]{36}$/i.test(input.requestId), 400, 'BAD_REQUEST_ID', '送出識別碼無效，請重新操作。');
    ensure(Array.isArray(input.changes) && input.changes.length > 0 && input.changes.length <= 500, 400, 'BAD_CHANGES', '每次請送出 1 至 500 筆修改。');
    const ids = new Set();
    for (const change of input.changes) {
      ensure(Number.isSafeInteger(change.memberId) && change.memberId > 0 && typeof change.attended === 'boolean' && !ids.has(change.memberId), 400, 'BAD_CHANGES', '點名資料格式錯誤或包含重複姓名。');
      ids.add(change.memberId);
    }
    const fingerprint = digest(input);
    for (const [key, value] of this.requests) if (value.expires < this.now().getTime()) this.requests.delete(key);
    const previous = this.requests.get(input.requestId);
    if (previous) {
      ensure(previous.fingerprint === fingerprint, 409, 'REQUEST_REUSED', '送出識別碼重複，請重新載入後再送出。');
      return previous.result;
    }
    const { week, scope, meeting } = await this.context(input);
    const snapshot = this.verify(input.snapshot);
    ensure(snapshot.week === input.week && snapshot.scope === input.scope && snapshot.meeting === input.meeting, 400, 'SNAPSHOT_MISMATCH', '名單與送出範圍不一致，請重新載入。');
    const baseline = new Map(snapshot.rows.map(([id, attended, writable]) => [id, { attended, writable }]));
    const before = await this.adapter.roster(week, scope, meeting);
    const current = new Map(before.map(row => [row.id, row]));
    for (const change of input.changes) {
      ensure(baseline.get(change.memberId)?.writable && current.get(change.memberId)?.writable, 409, 'ROSTER_CHANGED', '名單或權限已變動，請重新載入後核對；這次尚未寫入。');
    }
    let stopped = false;
    for (const attended of [true, false]) {
      const pending = input.changes.filter(c => c.attended === attended && current.get(c.memberId).attended !== attended);
      for (let start = 0; start < pending.length && !stopped; start += 50) {
        const batch = pending.slice(start, start + 50).map(c => c.memberId);
        const key = digest([input.requestId, attended, start]);
        try { await this.adapter.setAttendance(week, meeting, batch, attended, key); }
        catch { stopped = true; } // A timeout may have committed: read back before offering another attempt.
      }
    }
    let after = null;
    try { after = await this.adapter.roster(week, scope, meeting); } catch { /* Unknown is never success. */ }
    const afterById = new Map((after ?? []).map(row => [row.id, row]));
    const results = input.changes.map(change => ({ memberId: change.memberId,
      status: !afterById.has(change.memberId) ? 'unknown' : afterById.get(change.memberId).attended === change.attended ? 'confirmed' : 'notApplied' }));
    const confirmed = results.filter(r => r.status === 'confirmed').length;
    const status = confirmed === results.length ? 'confirmed' : after ? 'partial' : 'unconfirmed';
    const result = { status, confirmed, total: results.length, results,
      message: status === 'confirmed' ? `已確認 ${confirmed} 筆修改儲存至${this.adapter.mode === 'demo' ? '示範系統' : '原網站'}。` : after ? `已確認 ${confirmed}／${results.length} 筆；其餘尚未儲存，請核對後再送出。` : '暫時無法確認儲存結果，請重新查詢名單後核對。',
      roster: after ? this.pack({ week: week.key, scope: scope.key, meeting: meeting.key }, after) : null };
    if (this.requests.size >= 1000) this.requests.delete(this.requests.keys().next().value);
    this.requests.set(input.requestId, { fingerprint, result, expires: this.now().getTime() + 30 * 60000 });
    return result;
  }
}
