const $ = id => document.getElementById(id);
const base = String(window.ATTENDANCE_CONFIG?.apiBase ?? '').replace(/\/$/, '');
const state = { period: '7d', group: 'all', seq: 0 };
const number = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('zh-TW') : '—';
const time = value => value ? new Date(value).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }) : '尚無紀錄';
function text(tag, value) { const node = document.createElement(tag); node.textContent = value; return node; }
function busy(value) {
  for (const node of [$('usage-group'),$('usage-refresh'),...$('usage-periods').children]) node.disabled = value;
  $('usage-content').setAttribute('aria-busy', String(value));
  for (const button of $('usage-periods').children) button.setAttribute('aria-pressed', String(button.dataset.period === state.period));
}
function rows(id, records, columns) {
  const body = $(id).querySelector('tbody');
  body.replaceChildren(...records.map(row => {
    const tr = document.createElement('tr'), heading = text('th', row.label); heading.scope = 'row'; tr.append(heading);
    for (const field of columns) tr.append(text('td', number(row[field])));
    return tr;
  }));
}
function render(data) {
  if (!data?.totals || !Array.isArray(data.daily) || !Array.isArray(data.groups) || !Array.isArray(data.byGroup) || !Array.isArray(data.byMeeting)) throw new Error('統計資料格式不完整，請稍後重新讀取。');
  const options = [{ key: 'all', label: '全部大組' }, ...data.groups];
  $('usage-group').replaceChildren(...options.map(group => { const option = text('option', group.label); option.value = group.key; return option; }));
  $('usage-group').value = state.group;
  const durable = data.storage === 'redis';
  $('usage-storage').textContent = durable ? '持續保存：已存入的統計在主機重啟、更新後仍會保留。' : '記憶體試用版：只累計本次主機啟動後的資料，主機重啟後歸零。';
  $('usage-retention').textContent = durable ? '每日彙總持續保存；上方顯示所選期間，下方累計自統計啟用起計算。' : '最多保留本次啟動期間的近三十日彙總。';
  $('usage-lifetime').hidden = !durable;
  if (durable) $('usage-lifetime').textContent = `啟用至今累計（${options.find(group => group.key === state.group)?.label ?? '全部大組'}）\n點名頁 ${number(data.lifetimeTotals?.attendanceViews)} 次 · 名單查詢 ${number(data.lifetimeTotals?.rosterReads)} 次\n點名送出 ${number(data.lifetimeTotals?.submissions)} 批 · 報表查詢 ${number(data.lifetimeTotals?.reportReads)} 次`;
  $('usage-sync').hidden = !durable || data.persistence?.state === 'saved';
  if (!$('usage-sync').hidden) $('usage-sync').textContent = `有 ${number(data.persistence?.pendingEvents)} 筆操作待同步，以上先顯示已保存的數字。${data.persistence?.droppedEvents ? `本次主機有 ${number(data.persistence.droppedEvents)} 筆未能收錄。` : ''}點名仍可使用；尚未同步前主機若突然停止，部分次數可能漏計。`;
  $('usage-demo').hidden = data.mode !== 'demo';
  $('usage-range').textContent = `${options.find(group => group.key === state.group)?.label ?? '全部大組'} · ${data.range.from}～${data.range.to}`;
  $('usage-cards').replaceChildren(...[
    ['attendanceViews','點名頁開啟','次'],['rosterReads','名單查詢','次'],['submissions','點名送出','批'],['reportReads','報表查詢','次']
  ].map(([field, label, unit]) => { const card = document.createElement('div'); card.className = 'usage-card'; card.append(text('span', label), text('strong', number(data.totals[field])), text('small', unit)); return card; }));
  $('usage-outcomes').textContent = `已確認 ${number(data.totals.confirmedBatches)} 批 · 需核對 ${number(data.totals.unconfirmedBatches)} 批\n確認修改 ${number(data.totals.confirmedChanges)} 筆\n報表頁開啟 ${number(data.totals.reportViews)} 次 · 操作錯誤 ${number(data.totals.failures)} 次`;
  $('usage-empty').hidden = Object.values(data.totals).some(value => Number.isSafeInteger(value) && value > 0);
  const max = Math.max(1, ...data.daily.map(day => day.attendanceViews + day.reportViews));
  $('usage-trend').replaceChildren(...data.daily.map(day => {
    const row = document.createElement('li'), label = day.day.slice(5).replace('-', '/');
    row.append(text('span', label));
    if (day.covered) {
      const progress = document.createElement('progress'); progress.max = max; progress.value = day.attendanceViews + day.reportViews;
      progress.setAttribute('aria-label', `${day.day} 開啟 ${progress.value} 次`);
      row.append(progress, text('strong', number(progress.value)));
    } else { row.className = 'unavailable'; row.append(text('span', '尚未啟用'), text('strong', '—')); }
    return row;
  }));
  rows('usage-groups', data.byGroup, ['attendanceViews','submissions','reportReads']);
  rows('usage-meetings', data.byMeeting, ['rosterReads','submissions']);
  $('usage-started').textContent = `${durable ? '統計起始' : '本次統計啟動'}：${time(data.startedAt)}`;
  $('usage-updated').textContent = `更新時間：${time(data.generatedAt)}\n最後操作：${time(data.lastActivity)}`;
  $('usage-content').hidden = false;
}
async function load() {
  const seq = ++state.seq;
  busy(true); $('usage-content').hidden = true; $('usage-status').hidden = false;
  $('usage-status').className = 'notice'; $('usage-status').textContent = '正在讀取統計，首次啟動可能需要約一分鐘…';
  try {
    if (window.ATTENDANCE_CONFIG?.practice) throw new Error('目前尚未連接正式統計服務，請使用已設定後端的統計網址。');
    const response = await fetch(base + '/api/usage/summary?' + new URLSearchParams({ period: state.period, group: state.group }), { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(90000) });
    let data; try { data = await response.json(); } catch { throw new Error('統計服務可能正在啟動，請稍候約一分鐘後按「更新統計」。'); }
    if (!response.ok) throw new Error(data.error?.message ?? '暫時無法讀取統計，請稍後再試。');
    if (seq !== state.seq) return;
    render(data); $('usage-status').hidden = true;
  } catch (error) {
    if (seq !== state.seq) return;
    $('usage-status').textContent = navigator.onLine ? error.message : '目前沒有網路，請連線後按「更新統計」。';
    $('usage-status').className = 'notice error';
  } finally { if (seq === state.seq) busy(false); }
}
for (const button of $('usage-periods').children) button.onclick = () => { state.period = button.dataset.period; load(); };
$('usage-group').onchange = () => { state.group = $('usage-group').value; load(); };
$('usage-refresh').onclick = load;
load();
