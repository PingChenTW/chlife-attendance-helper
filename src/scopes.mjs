import { ensure } from './errors.mjs';
export const MEETINGS = [
  ['sunday', '主日', '主日'], ['home-out', '家聚會出訪', '家聚會出訪'],
  ['home-in', '家聚會受訪', '家聚會受訪'], ['group', '排聚會', '小排'],
  ['prayer', '禱告聚會', '禱告'], ['reading', '生命讀經', '生命讀經'], ['gospel', '福音出訪', '福音出訪']
];
export function selectMeetings(rows) {
  return MEETINGS.map(([key, label, name]) => {
    const matches = rows.filter(row => row.name === name && Number(row.enable) === 2 && Number(row.visible) !== 0);
    ensure(matches.length === 1, 502, 'MEETING_UNAVAILABLE', `原網站「${label}」項目無法確認，請聯絡管理者。`);
    return { key, label, id: Number(matches[0].id) };
  });
}
export function selectScopes(tree, user) {
  const scopes = [];
  const grants = user.privileges ?? [];
  function walk(node, parents = [], granted = false) {
    const chain = [...parents, node];
    const allowed = granted || Boolean(user.is_admin || user.is_church_admin) || grants.some(g => Number(g.level) === Number(node.level) && Number(g.church_id) === Number(node.id));
    if (allowed && [3, 4].includes(Number(node.level))) {
      scopes.push({ key: `l${node.level}:${node.id}`, label: node.name, level: Number(node.level), path: chain.slice(1).map(n => n.name).join(' / '), ids: Object.fromEntries(chain.map(n => [Number(n.level), Number(n.id)])) });
    }
    for (const child of node.children ?? []) walk(child, chain, allowed);
  }
  tree.forEach(root => walk(root));
  ensure(scopes.length, 403, 'NO_SCOPE', '這個帳號沒有可用的小區點名權限。');
  return scopes;
}
export function memberMatchesScope(path, scope) {
  const ids = String(path ?? '').split(',').map(Number);
  return Object.entries(scope.ids).every(([level, id]) => ids[Number(level) - 1] === id);
}
