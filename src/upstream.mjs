import { randomUUID } from 'node:crypto';
import { AppError, ensure } from './errors.mjs';
import { selectMeetings, selectScopes, memberMatchesScope } from './scopes.mjs';

const BASE = 'https://www.chlife-stat.org/api';
export class ChlifeAdapter {
  mode = 'live';
  constructor({ churchId, account, password, deviceToken = randomUUID(), fetchImpl = fetch }) {
    ensure(Number.isSafeInteger(churchId) && churchId > 0 && account && password, 500, 'CONFIG_REQUIRED', '後端尚未設定原網站帳號。');
    this.churchId = churchId; this.account = account; this.password = password; this.deviceToken = deviceToken;
    this.fetch = fetchImpl; this.auth = null; this.authPromise = null; this.metaCache = new Map();
  }
  async raw(path, { method = 'GET', body, token, idempotencyKey } = {}) {
    let response, data;
    try {
      response = await this.fetch(BASE + path, { method, signal: AbortSignal.timeout(20000), redirect: 'error',
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      data = await response.json();
    } catch { throw new AppError(502, 'UPSTREAM_UNAVAILABLE', '暫時無法連接原網站，請稍後再試。'); }
    if (response.status === 401) throw new AppError(502, 'UPSTREAM_AUTH_EXPIRED', '原網站登入已過期，請稍後重新查詢。');
    ensure(response.ok && data.success, 502, 'UPSTREAM_REJECTED', '原網站未接受這次操作，請重新查詢或聯絡管理者。');
    return data.data;
  }
  async authenticate() {
    if (this.auth && this.auth.expires > Date.now() + 60000) return this.auth;
    if (this.authPromise) return this.authPromise;
    this.authPromise = (async () => {
      let data;
      if (this.auth?.refresh) {
        try { data = await this.raw('/auth/refresh', { method: 'POST', body: { refresh_token: this.auth.refresh } }); } catch { /* Fall back to the owner's configured credentials. */ }
      }
      data ??= await this.raw('/auth/login', { method: 'POST', body: { church_id: this.churchId, account: this.account, password: this.password, device_token: this.deviceToken } });
      ensure(data && !data.totp_required && data.access_token && data.user && data.security_flags?.password_upgrade_phase !== 'forced' && !data.user.pwd_needs_reset, 503, 'AUTH_ACTION_REQUIRED', '原網站需要帳號管理者完成驗證或更新設定，請先到原網站處理。');
      ensure(Number(data.user.church_id) === this.churchId, 502, 'AUTH_SCOPE_MISMATCH', '原網站帳號的召會範圍不符合後端設定。');
      let expires = Date.now() + 5 * 60000;
      try { const payload = JSON.parse(Buffer.from(data.access_token.split('.')[1], 'base64url').toString()); if (payload.exp) expires = payload.exp * 1000; } catch { /* Short fallback lifetime for opaque tokens. */ }
      this.auth = { token: data.access_token, refresh: data.refresh_token, user: data.user, expires };
      this.metaCache.clear();
      return this.auth;
    })().finally(() => { this.authPromise = null; });
    return this.authPromise;
  }
  async request(path, options = {}) {
    const auth = await this.authenticate();
    try { return await this.raw(path, { ...options, token: auth.token }); }
    catch (error) {
      if (error.code !== 'UPSTREAM_AUTH_EXPIRED') throw error;
      this.auth.expires = 0;
      // Reads can be repeated after refresh; a mutation is resolved by readback instead.
      if (options.write) throw error;
      const refreshed = await this.authenticate();
      return this.raw(path, { ...options, token: refreshed.token });
    }
  }
  async metadata(week) {
    const auth = await this.authenticate();
    const cached = this.metaCache.get(week.key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const [tree, meetings] = await Promise.all([
      this.request(`/admin/church-tree?purpose=rollcall&week_year=${week.year}&week=${week.week}`), this.request('/meetings')
    ]);
    ensure(Array.isArray(tree) && Array.isArray(meetings), 502, 'UPSTREAM_SCHEMA', '原網站資料格式已變更，請聯絡管理者。');
    const scopes = selectScopes(tree, auth.user);
    const groups = [...new Set(scopes.map(s => s.path.split(' / ')[0]))];
    const value = { church: tree.find(t => Number(t.id) === this.churchId)?.name ?? '召會生活', group: groups.join('、'), scopes, meetings: selectMeetings(meetings) };
    if (this.metaCache.size >= 2) this.metaCache.delete(this.metaCache.keys().next().value);
    this.metaCache.set(week.key, { value, expires: Date.now() + 30000 });
    return value;
  }
  async roster(week, scope, meeting) {
    const rows = [], seen = new Set();
    let start = 0, count = Infinity;
    while (start < count) {
      const body = { year: week.year, week: week.week, meeting: String(meeting.id), start, limit: 500 };
      for (const level of [2, 3, 4]) if (scope.ids[level]) body[`lv${level}_ids`] = String(scope.ids[level]);
      const data = await this.request('/members', { method: 'POST', body });
      ensure(Array.isArray(data?.members) && Array.isArray(data.meetingIds) && Number.isSafeInteger(data.count) && data.count >= 0 && data.count <= 10000, 502, 'UPSTREAM_SCHEMA', '原網站名單格式已變更，請聯絡管理者。');
      const index = data.meetingIds.map(Number).indexOf(meeting.id);
      ensure(index >= 0, 502, 'UPSTREAM_MEETING', '無法確認原網站的聚會欄位，請稍後再試。');
      if (start) ensure(count === data.count, 409, 'ROSTER_MOVED', '讀取時名單已變動，請重新載入。');
      count = data.count;
      for (const row of data.members) {
        const id = Number(row.member_id);
        ensure(Number.isSafeInteger(id) && id > 0 && !seen.has(id), 502, 'UPSTREAM_SCHEMA', '讀取名單時發現重複或無效資料，請重新載入。');
        seen.add(id);
        // Ignore extended/orphan rows outside the selected district instead of exposing them.
        if (!memberMatchesScope(row.path, scope)) continue;
        rows.push({ id, name: String(row.member_name), group: String(row.church_name ?? scope.label), attended: Number(row[`attend${index}`]) === 1,
          writable: Number(row.roll_callable) === 1 && Number(row.in_scope) === 1 });
      }
      ensure(data.members.length > 0 || count === 0, 502, 'UPSTREAM_PAGINATION', '原網站名單分頁不完整，請重新載入。');
      start += data.members.length;
    }
    return rows;
  }
  async setAttendance(week, meeting, memberIds, attended, idempotencyKey) {
    await this.request('/attendance', { method: 'POST', write: true, idempotencyKey,
      body: { year: week.year, week: week.week, meeting_id: meeting.id, member_ids: memberIds, attend: attended } });
  }
}
