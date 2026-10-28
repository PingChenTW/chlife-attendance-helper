import { changesFor, mergeDesired, allDesiredConfirmed } from './model.js';
import { createPracticeApi } from './practice.js';

const $ = id => document.getElementById(id);
const state = { meta: null, query: null, roster: null, drafts: new Map(), busy: false, loading: false, seq: 0, search: '', lastSaved: false };
const base = String(window.ATTENDANCE_CONFIG?.apiBase ?? '').replace(/\/$/, '');
const practice = window.ATTENDANCE_CONFIG?.practice ? createPracticeApi() : null;
function notice(message, error = false, retry = false) {
  const node = $('notice'); node.replaceChildren(); node.hidden = !message; node.className = error ? 'notice error' : 'notice';
  if (!message) return;
  node.append(document.createTextNode(message));
  if (retry) { const button = document.createElement('button'); button.textContent = '重新讀取'; button.onclick = () => state.meta ? loadRoster({ preserve: true }) : start(); node.append(button); }
}
async function api(path, options = {}) {
  if (practice) return practice(path, options);
  let response;
  try { response = await fetch(base + path, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(90000), ...options }); }
  catch { throw new Error(navigator.onLine ? '連線中斷，尚未確認儲存。請重新讀取名單核對。' : '目前沒有網路，請連上網路後重新讀取。'); }
  let data;
  try { data = await response.json(); } catch { throw new Error('尚未連接點名後端，請聯絡工具管理者。'); }
  if (!response.ok) throw new Error(data.error?.message ?? '暫時無法完成，請稍後再試。');
  return data;
}
const prettyDate = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
function currentWeek() { return state.meta.weeks.find(w => w.key === state.query.week); }
function renderControls() {
  $('scope-select').value = state.query.scope; $('meeting-select').value = state.query.meeting;
  $('scope-select').disabled = state.busy || state.loading; $('meeting-select').disabled = state.busy || state.loading;
  for (const button of $('week-switch').children) {
    button.setAttribute('aria-pressed', String(button.dataset.week === state.query.week)); button.disabled = state.busy || state.loading;
  }
  $('refresh-button').disabled = state.busy || state.loading;
  $('search').disabled = state.busy || state.loading || !state.roster;
}
function renderRoster() {
  const changes = state.roster ? changesFor(state.roster, state.drafts) : [];
  const added = changes.filter(c => c.attended).length, removed = changes.length - added;
  $('pending-count').textContent = changes.length ? `${changes.length} 筆待送出` : state.lastSaved ? '已儲存完成' : '尚未修改';
  $('pending-detail').textContent = state.busy ? '正在儲存，請稍候…' : changes.length ? `新增 ${added} 人 · 取消 ${removed} 人` : state.lastSaved ? '已重新查詢確認' : '選完姓名再送出';
  $('submit-button').disabled = state.busy || state.loading || !changes.length || !state.meta?.writesEnabled || !navigator.onLine;
  $('submit-button').textContent = state.busy ? '儲存中…' : '送出點名';
  $('unsaved-hint').hidden = changes.length === 0;
  const list = $('members'); list.setAttribute('aria-busy', String(state.loading));
  if (state.loading) {
    list.replaceChildren(...Array.from({ length: 3 }, () => { const el = document.createElement('div'); el.className = 'skeleton'; return el; }));
    $('empty-state').hidden = true; $('member-count').textContent = '正在讀取…'; return;
  }
  list.replaceChildren();
  if (!state.roster) { $('empty-state').hidden = false; $('empty-state').textContent = '尚未取得名單，請按「重新讀取」。'; return; }
  const meeting = state.meta.meetings.find(m => m.key === state.query.meeting);
  const scope = state.meta.scopes.find(s => s.key === state.query.scope);
  $('roster-title').textContent = `${scope.label} · ${meeting.label}`;
  const all = state.roster.members;
  const visible = all.filter(m => m.name.toLocaleLowerCase().includes(state.search.toLocaleLowerCase()));
  const present = all.filter(m => state.drafts.has(m.id) ? state.drafts.get(m.id) : m.attended).length;
  $('member-count').textContent = state.search ? `找到 ${visible.length} 人` : `出席 ${present} 人 / 共 ${all.length} 人`;
  $('empty-state').hidden = visible.length > 0;
  $('empty-state').textContent = state.search ? '沒有找到這個姓名。' : '這個小區目前沒有可點名的人員。';
  const fragment = document.createDocumentFragment();
  for (const member of visible) {
    const attended = state.drafts.has(member.id) ? state.drafts.get(member.id) : member.attended;
    const changed = attended !== member.attended;
    const button = document.createElement('button'); button.type = 'button'; button.className = `member${changed ? ' changed' : ''}`;
    button.dataset.id = member.id; button.setAttribute('aria-pressed', String(attended));
    button.setAttribute('aria-label', `${member.name}，${attended ? '出席' : '未出席'}${changed ? '，待送出' : ''}`);
    button.disabled = state.busy || !member.writable || !state.meta.writesEnabled;
    const check = document.createElement('span'); check.className = 'check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span'); text.className = 'member-text';
    const name = document.createElement('span'); name.className = 'member-name'; name.textContent = member.name;
    const group = document.createElement('span'); group.className = 'member-group'; group.textContent = member.group;
    text.append(name, group);
    const status = document.createElement('span'); status.className = 'member-state';
    status.textContent = !member.writable ? '僅供查看' : changed ? (attended ? '出席待送出' : '取消待送出') : attended ? '出席' : '未出席';
    button.append(check, text, status);
    button.onclick = () => {
      state.lastSaved = false;
      const next = !attended;
      if (next === member.attended) state.drafts.delete(member.id); else state.drafts.set(member.id, next);
      renderRoster();
      // Keep keyboard and screen-reader focus on the person that was just changed.
      [...$('members').children].find(el => el.dataset.id === String(member.id))?.focus({ preventScroll: true });
    };
    fragment.append(button);
  }
  list.append(fragment);
}
async function loadRoster({ preserve = false } = {}) {
  const seq = ++state.seq; state.loading = true; state.lastSaved = false;
  const desired = preserve ? new Map(state.drafts) : new Map();
  if (!preserve) { state.roster = null; state.drafts.clear(); }
  notice(''); renderControls(); renderRoster();
  try {
    const roster = await api('/api/roster?' + new URLSearchParams(state.query));
    if (seq !== state.seq) return;
    state.roster = roster; state.drafts = mergeDesired(roster, desired);
    if (preserve && desired.size) notice(state.drafts.size ? '已讀取最新名單。保留的修改仍需按「送出點名」。' : allDesiredConfirmed(roster, desired) ? '已確認修改符合目前的儲存狀態。' : '名單或權限已變動，部分修改無法保留，請核對後重新點名。', !state.drafts.size && !allDesiredConfirmed(roster, desired));
  } catch (error) { if (seq === state.seq) notice(error.message, true, true); }
  finally { if (seq === state.seq) { state.loading = false; renderControls(); renderRoster(); } }
}
async function changeScope(field, value) {
  if (state.drafts.size && !window.confirm('還有點名尚未送出。要放棄這些修改，切換範圍嗎？')) { renderControls(); return; }
  state.query[field] = value; state.search = ''; $('search').value = ''; await loadRoster();
}
async function submit() {
  const changes = changesFor(state.roster, state.drafts);
  if (!changes.length || state.busy) return;
  const week = currentWeek(), scope = state.meta.scopes.find(s => s.key === state.query.scope), meeting = state.meta.meetings.find(m => m.key === state.query.meeting);
  $('confirm-scope').textContent = `${scope.path}\n${week.label} ${prettyDate(week.start)}～${prettyDate(week.end)}\n${meeting.label}`;
  $('confirm-detail').textContent = `新增出席 ${changes.filter(c => c.attended).length} 人\n取消出席 ${changes.filter(c => !c.attended).length} 人`;
  const dialog = $('confirm-dialog'); dialog.returnValue = ''; dialog.showModal();
  const answer = await new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
  if (answer !== 'send') return;
  state.busy = true; notice(''); renderControls(); renderRoster();
  try {
    const result = await api('/api/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Attendance-Client': '1' },
      body: JSON.stringify({ ...state.query, snapshot: state.roster.snapshot, requestId: crypto.randomUUID(), changes }) });
    if (result.roster) { state.roster = result.roster; state.drafts = mergeDesired(result.roster, state.drafts); }
    state.lastSaved = result.status === 'confirmed';
    notice(result.message, result.status !== 'confirmed', result.status !== 'confirmed');
  } catch (error) {
    notice(error.message, true, true);
    // The POST may have completed even when its response was lost. Reconcile once; never auto-send again.
    try {
      const roster = await api('/api/roster?' + new URLSearchParams(state.query));
      const desired = new Map(state.drafts);
      state.roster = roster; state.drafts = mergeDesired(roster, desired);
      if (allDesiredConfirmed(roster, desired)) { state.lastSaved = true; notice('已重新查詢，確認這次修改都已儲存。'); }
    } catch { /* Retain the desired states and show the original error. */ }
  } finally {
    state.busy = false; renderControls(); renderRoster(); $('notice').scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}
async function start() {
  notice('');
  try {
    const meta = await api('/api/meta');
    if (!meta.scopes?.length || !meta.meetings?.length || !meta.weeks?.length) throw new Error('尚未取得可用的小區與聚會，請稍後再試。');
    state.meta = meta; state.query = { week: meta.weeks[0].key, scope: meta.scopes.find(s => s.level === 3)?.key ?? meta.scopes[0].key, meeting: meta.meetings[0].key };
    $('group-label').textContent = meta.group;
    $('mode-banner').hidden = meta.mode !== 'demo' && meta.writesEnabled;
    $('mode-banner').textContent = meta.mode === 'demo' ? '這是練習版，姓名都是示範資料。可以放心練習點名。' : '目前是名單查看版，尚未開放正式點名寫入。';
    $('week-switch').replaceChildren(...meta.weeks.map(week => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'week-button'; button.dataset.week = week.key;
      const title = document.createElement('span'); title.textContent = week.label;
      const dates = document.createElement('small'); dates.textContent = `${prettyDate(week.start)}～${prettyDate(week.end)}`;
      button.append(title, dates); button.onclick = () => changeScope('week', week.key); return button;
    }));
    $('scope-select').replaceChildren(...meta.scopes.map(scope => { const option = document.createElement('option'); option.value = scope.key; option.textContent = scope.level === 4 ? '　' + scope.path.split(' / ').slice(-2).join(' / ') : scope.label; return option; }));
    $('meeting-select').replaceChildren(...meta.meetings.map(meeting => { const option = document.createElement('option'); option.value = meeting.key; option.textContent = meeting.label; return option; }));
    await loadRoster();
  } catch (error) { notice(error.message, true, true); $('members').replaceChildren(); $('empty-state').hidden = false; $('empty-state').textContent = '暫時無法讀取，請稍後再試。'; }
}
function connection() { $('connection').textContent = navigator.onLine ? '已連網' : '未連網'; $('connection').classList.toggle('offline', !navigator.onLine); renderRoster(); }
$('scope-select').onchange = e => changeScope('scope', e.target.value);
$('meeting-select').onchange = e => changeScope('meeting', e.target.value);
$('refresh-button').onclick = () => loadRoster({ preserve: true });
$('search').oninput = e => { state.search = e.target.value.trim(); renderRoster(); };
$('submit-button').onclick = submit;
window.addEventListener('beforeunload', event => { if (state.drafts.size || state.busy) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('online', connection); window.addEventListener('offline', connection);
connection(); start();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
