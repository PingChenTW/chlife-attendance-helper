import { ensure } from './errors.mjs';

// Keys share a Redis hash tag. Receipts expire; numeric daily/lifetime aggregates do not.
const PREFIX = '{attendance-usage-v1}:';
export const WRITE_USAGE = `-- usage-write-v1
local events = cjson.decode(ARGV[1])
for i, event in ipairs(events) do
  local day = KEYS[2*i+1]
  local receipt = KEYS[2*i+2]
  if redis.call('EXISTS', receipt) == 0 then
    redis.call('SET', KEYS[1], event.startedAt, 'NX')
    for field, amount in pairs(event.changes) do
      redis.call('HINCRBY', day, event.group..':'..field, amount)
      redis.call('HINCRBY', KEYS[2], event.group..':'..field, amount)
      if event.meeting then
        redis.call('HINCRBY', day, event.group..':m:'..event.meeting..':'..field, amount)
      end
    end
    for _, key in ipairs({day, KEYS[2]}) do
      local field = event.group..':lastActivity'
      local previous = redis.call('HGET', key, field)
      if not previous or previous < event.at then redis.call('HSET', key, field, event.at) end
    end
    if event.seed then redis.call('SET', receipt, '1')
    else redis.call('SET', receipt, '1', 'EX', 1800) end
  end
end
return 1`;
export const READ_USAGE = `-- usage-read-v1
local result = {redis.call('GET', KEYS[1]) or false, redis.call('HGETALL', KEYS[2])}
for i=3,#KEYS do table.insert(result, redis.call('HGETALL', KEYS[i])) end
return result`;

export class RedisUsageStore {
  constructor({ url, token, fetchImpl = globalThis.fetch, command, prefix = PREFIX } = {}) {
    if (!command) {
      let parsed; try { parsed = new URL(url); } catch { /* Checked below without echoing secrets. */ }
      ensure(parsed?.protocol === 'https:' && /^[a-z0-9-]+\.upstash\.io$/.test(parsed.hostname) && parsed.pathname === '/' && !parsed.search && !parsed.username && !parsed.password && typeof token === 'string' && token.length > 10,
        500, 'USAGE_CONFIG', '使用統計資料庫設定不完整，請管理者檢查。');
      this.command = async args => {
        try {
          const response = await fetchImpl(parsed.origin, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(args), signal: AbortSignal.timeout(5000), redirect: 'error' });
          const body = await response.json();
          if (!response.ok || body.error || !Object.hasOwn(body, 'result')) throw new Error();
          return body.result;
        } catch { throw new Error('使用統計資料庫暫時無法連線。'); }
      };
    } else this.command = command;
    this.prefix = prefix;
  }
  write(events) {
    const keys = [this.prefix + 'startedAt', this.prefix + 'lifetime'];
    for (const event of events) keys.push(this.prefix + 'day:' + event.day, this.prefix + 'receipt:' + event.receipt);
    // No URL, token, name, raw request payload or member ID enters the value.
    const values = events.map(({ group, at, startedAt, changes, meeting, seed }) => ({ group, at, startedAt, changes, ...(meeting ? { meeting } : {}), ...(seed ? { seed: true } : {}) }));
    return this.command(['EVAL', WRITE_USAGE, keys.length, ...keys, JSON.stringify(values)]);
  }
  async read(days) {
    const keys = [this.prefix + 'startedAt', this.prefix + 'lifetime', ...days.map(day => this.prefix + 'day:' + day)];
    const result = await this.command(['EVAL', READ_USAGE, keys.length, ...keys]);
    ensure(Array.isArray(result) && result.length === days.length + 2, 503, 'USAGE_STORAGE', '統計資料尚未讀取成功，請稍後更新。');
    const pairs = values => Object.fromEntries(Array.from({ length: values.length / 2 }, (_, i) => [values[2*i], values[2*i+1]]));
    ensure(result.slice(1).every(value => Array.isArray(value) && value.length % 2 === 0), 503, 'USAGE_STORAGE', '統計資料尚未讀取成功，請稍後更新。');
    return { startedAt: result[0] || null, lifetime: pairs(result[1]), days: new Map(days.map((day, index) => [day, pairs(result[index + 2])])) };
  }
}
