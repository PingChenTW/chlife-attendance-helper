// Only member IDs are stored on this device; names and attendance stay in memory.
export function selectionKey(meta, scope) {
  return 'attendance-selected:v1:' + [meta.mode, meta.church, scope].map(encodeURIComponent).join(':');
}
export function readSelected(storage, key) {
  try {
    const data = JSON.parse(storage?.getItem(key) ?? 'null');
    if (data?.version !== 1 || !Array.isArray(data.ids) || data.ids.length > 10000) return new Set();
    return new Set(data.ids.filter(id => Number.isSafeInteger(id) && id > 0));
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
