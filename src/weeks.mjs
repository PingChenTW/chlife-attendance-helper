import { AppError } from './errors.mjs';
const DAY = 86400000;
const iso = date => date.toISOString().slice(0, 10);
export function weekOptions(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = name => Number(parts.find(p => p.type === name).value);
  const localDay = new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
  const monday = new Date(localDay.getTime() - ((localDay.getUTCDay() + 6) % 7) * DAY);
  return [0, 1].map(offset => {
    const start = new Date(monday.getTime() - offset * 7 * DAY);
    const thursday = new Date(start.getTime() + 3 * DAY);
    const year = thursday.getUTCFullYear();
    const week = Math.ceil(((thursday - new Date(Date.UTC(year, 0, 1))) / DAY + 1) / 7);
    return { key: `${year}-W${String(week).padStart(2, '0')}`, year, week, label: offset ? '上週' : '本週', start: iso(start), end: iso(new Date(start.getTime() + 6 * DAY)) };
  });
}
export function requireWeek(key, now) {
  const found = weekOptions(now).find(week => week.key === key);
  if (!found) throw new AppError(400, 'WEEK_NOT_ALLOWED', '只能點名本週或上週，請重新載入週次。');
  return found;
}
