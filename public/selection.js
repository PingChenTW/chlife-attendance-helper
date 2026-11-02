// Only member IDs are stored on this device; names and attendance stay in memory.
export function selectionKey(meta, scope, audience = 'all') {
  return 'attendance-selected:v1:' + [meta.mode, meta.church, scope].map(encodeURIComponent).join(':') + (audience === 'children' ? ':children' : '') + (meta.siteKey ? ':site:'+encodeURIComponent(meta.siteKey) : '');
}
function decodeSelected(raw) {
  const data = JSON.parse(raw ?? 'null');
  if (data?.version !== 1 || !Array.isArray(data.ids) || data.ids.length > 10000) return null;
  return new Set(data.ids.filter(id => Number.isSafeInteger(id) && id > 0));
}
export function readSelected(storage, key) {
  try {
    return decodeSelected(storage?.getItem(key)) ?? new Set();
  } catch { return new Set(); }
}
export function loadSelected(storage, meta, scope, audience = 'all') {
  const key = selectionKey(meta, scope, audience);
  try {
    const current = storage?.getItem(key) ?? null;
    // Even an intentionally empty selection is authoritative: never restore removed people.
    if (current !== null) return decodeSelected(current) ?? new Set();
    if (meta.mode !== 'live' || meta.siteKey !== 'group-6') return new Set();
    const originalKey = selectionKey({ ...meta, siteKey: undefined }, scope, audience);
    const recovered = decodeSelected(storage?.getItem(originalKey));
    if (!recovered) return new Set();
    // The retired homepage was the sixth group. Copy IDs only; keep its original as a backup.
    saveSelected(storage, key, recovered);
    return recovered;
  } catch { return new Set(); }
}
export function saveSelected(storage, key, selected) {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify({ version: 1, ids: [...selected] })); return true;
  } catch { return false; }
}
// A missing record means first use. An existing empty record means the user chose an empty list.
export class SelectionStore {
  constructor(storage) { this.storage = storage; this.session = new Map(); }
  load(meta, scope, audience = 'all') {
    const key = selectionKey(meta, scope, audience);
    const persisted = loadSelected(this.storage, meta, scope, audience);
    return new Set(this.session.get(key) ?? persisted);
  }
  has(meta, scope, audience = 'all') {
    const key = selectionKey(meta, scope, audience);
    if (this.session.has(key)) return true;
    try {
      if (this.storage?.getItem(key) != null) return true;
      // A recoverable original homepage list is also an existing user choice, even if copying is blocked.
      return meta.mode === 'live' && meta.siteKey === 'group-6' &&
        decodeSelected(this.storage?.getItem(selectionKey({ ...meta, siteKey: undefined }, scope, audience))) !== null;
    } catch { return false; }
  }
  save(meta, scope, audience, selected) {
    const key = selectionKey(meta, scope, audience);
    this.session.set(key, new Set(selected));
    return saveSelected(this.storage, key, selected);
  }
  async initialize({ meta, query, roster, readRoster, isCurrent = () => true }) {
    const existing = () => ({ initialized: false, selected: this.load(meta, query.scope, query.audience) });
    this.load(meta, query.scope, query.audience); // Preserve the original-homepage migration before considering defaults.
    if (this.has(meta, query.scope, query.audience)) return existing();
    const previous = meta.weeks?.[1];
    if (!previous) return existing();
    // "上週" always means the server-provided previous calendar week, even when viewing that week.
    const source = query.week === previous.key ? roster : await readRoster({ ...query, week: previous.key });
    if (!isCurrent()) return { cancelled: true };
    if (this.has(meta, query.scope, query.audience)) return existing();
    if (!Array.isArray(source?.members) || source.week !== previous.key || source.scope !== query.scope ||
        source.meeting !== query.meeting || source.audience !== query.audience) {
      throw new Error('無法確認上週名單的範圍，請重新讀取。');
    }
    const allowed = new Set(roster.members.map(member => member.id));
    const selected = new Set(source.members.filter(member => member.attended === true &&
      Number.isSafeInteger(member.id) && member.id > 0 && allowed.has(member.id)).map(member => member.id));
    const saved = this.save(meta, query.scope, query.audience, selected);
    return { initialized: true, selected, saved };
  }
}
export function selectedMembers(roster, selected) {
  const byId = new Map((roster?.members ?? []).map(member => [member.id, member]));
  return [...selected].map(id => byId.get(id)).filter(Boolean);
}
export function addPeopleMembers(roster, selected, search = '', showAll = false) {
  const query = search.trim().toLocaleLowerCase();
  const members = roster?.members ?? [];
  if (query) return members.filter(member => member.name.toLocaleLowerCase().includes(query));
  return showAll ? members : selectedMembers(roster, selected);
}
