// Public synthetic data only. This mode never connects to the original website.
export function createPracticeApi() {
  const values = new Map();
  function weeks() {
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const day = new Date(date + 'T00:00:00Z');
    const monday = day.getTime() - ((day.getUTCDay() + 6) % 7) * 86400000;
    return [0, 1].map(offset => {
      const start = new Date(monday - offset * 7 * 86400000), thursday = new Date(start.getTime() + 3 * 86400000);
      const year = thursday.getUTCFullYear(), week = Math.ceil(((thursday - new Date(Date.UTC(year, 0, 1))) / 86400000 + 1) / 7);
      return { key: `${year}-W${String(week).padStart(2, '0')}`, year, week, label: offset ? '上週' : '本週', start: start.toISOString().slice(0, 10), end: new Date(start.getTime() + 6 * 86400000).toISOString().slice(0, 10) };
    });
  }
  const scopes = [{ key: '611', label: '611區', path: '示範大組 / 611區', level: 3 }, { key: '612', label: '612區', path: '示範大組 / 612區', level: 3 }];
  const meetings = [['sunday', '主日'], ['home-out', '家聚會出訪'], ['home-in', '家聚會受訪'], ['group', '排聚會'], ['prayer', '禱告聚會'], ['reading', '生命讀經'], ['gospel', '福音出訪']].map(([key, label]) => ({ key, label }));
  const names = ['示範陳弟兄', '示範林姊妹', '示範張弟兄', '示範黃姊妹', '示範吳弟兄', '示範劉姊妹', '示範蔡弟兄', '示範王姊妹'];
  function roster(query) {
    return { ...query, snapshot: 'practice', loadedAt: new Date().toISOString(), members: names.map((name, i) => {
      const id = Number(query.scope) * 100 + i, key = `${query.week}:${query.meeting}:${id}`;
      return { id, name, group: scopes.find(s => s.key === query.scope)?.label ?? '示範小區', writable: true, attended: values.has(key) ? values.get(key) : i % 4 === 1 };
    }) };
  }
  return async (path, options = {}) => {
    if (path === '/api/meta') return { church: '示範召會', group: '示範大組', mode: 'demo', writesEnabled: true, scopes, meetings, weeks: weeks() };
    if (path.startsWith('/api/roster?')) return roster(Object.fromEntries(new URLSearchParams(path.split('?')[1])));
    if (path === '/api/attendance') {
      const input = JSON.parse(options.body);
      for (const change of input.changes) values.set(`${input.week}:${input.meeting}:${change.memberId}`, change.attended);
      return { status: 'confirmed', confirmed: input.changes.length, total: input.changes.length,
        message: '練習完成！這些是示範資料，不會寫入原網站。', roster: roster({ week: input.week, scope: input.scope, meeting: input.meeting }) };
    }
    throw new Error('找不到此練習功能。');
  };
}
