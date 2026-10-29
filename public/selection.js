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
