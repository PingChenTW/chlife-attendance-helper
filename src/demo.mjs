import { MEETINGS, CHILD_MEETINGS } from './scopes.mjs';
export class DemoAdapter {
  mode = 'demo';
  writeCount = 0;
  readOnlyIds = new Set();
  values = new Map();
  async metadata() {
    return {
      church: '一起點名 · 示範名單', group: '示範大組',
      scopes: [
        { key: 'l3:611', label: '611區', path: '示範大組 / 611區', level: 3 },
        { key: 'l4:6111', label: '社區一排', path: '示範大組 / 611區 / 社區一排', level: 4 },
        { key: 'l3:612', label: '612區', path: '示範大組 / 612區', level: 3 }
      ],
      meetings: MEETINGS.map(([key, label], i) => ({ key, label, id: i + 1 })),
      childMeetings: CHILD_MEETINGS.map(([key, label], i) => ({ key, label, id: i === 0 ? 1 : 101 + i }))
    };
  }
  async roster(week, scope, meeting, audience = 'all') {
    if (this.failReadAfterWrite && this.writeCount) throw new Error('Simulated readback timeout');
    const names = ['示範陳弟兄', '示範林姊妹', '示範張弟兄', '示範黃姊妹', '示範吳弟兄', '示範劉姊妹', '示範蔡弟兄', '示範王姊妹', '示範李弟兄', '示範周姊妹', '示範許弟兄', '示範鄭姊妹'];
    return names.slice(0, scope.level === 4 ? 5 : 12).map((name, i) => {
      const id = (scope.key === 'l3:612' ? 200 : 100) + i;
      const key = `${week.key}:${meeting.id}:${id}`;
      return { id, name, group: scope.label, attended: this.values.has(key) ? this.values.get(key) : i % 4 === 1, writable: !this.readOnlyIds.has(id) };
    }).filter((member, i) => audience !== 'children' || i % 3 === 0);
  }
  async setAttendance(week, meeting, memberIds, attended) {
    this.writeCount++;
    for (const id of memberIds) this.values.set(`${week.key}:${meeting.id}:${id}`, attended);
    if (this.afterWriteError) throw new Error('Simulated timeout after commit');
  }
}
