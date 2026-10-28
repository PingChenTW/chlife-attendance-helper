export function changesFor(roster, drafts) {
  return roster.members.filter(m => drafts.has(m.id) && drafts.get(m.id) !== m.attended && m.writable)
    .map(m => ({ memberId: m.id, attended: drafts.get(m.id) }));
}
export function mergeDesired(roster, desired) {
  const drafts = new Map();
  for (const member of roster.members) if (member.writable && desired.has(member.id) && desired.get(member.id) !== member.attended) drafts.set(member.id, desired.get(member.id));
  return drafts;
}
export function allDesiredConfirmed(roster, desired) {
  return [...desired].every(([id, target]) => roster.members.some(member => member.id === id && member.attended === target));
}
