// Best-effort page counts only. No storage, names, URLs, member IDs or browser fingerprints.
export function createUsageReporter({ apiBase = '', enabled = true, fetchImpl = globalThis.fetch } = {}) {
  const seen = new Set(), base = String(apiBase).replace(/\/$/, '');
  return async (page, group) => {
    if (!enabled || !['attendance','reports'].includes(page) || typeof group !== 'string' || !/^[1-8]$/.test(group)) return false;
    const key = page + ':' + group;
    if (seen.has(key)) return false;
    seen.add(key);
    try {
      const response = await fetchImpl(base + '/api/usage/events', { method: 'POST', credentials: 'omit', keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-Usage-Client': '1' },
        body: JSON.stringify({ group, page }), signal: AbortSignal.timeout(8000) });
      return response.ok;
    } catch { return false; } // Statistics must never interrupt attendance/report use.
  };
}
