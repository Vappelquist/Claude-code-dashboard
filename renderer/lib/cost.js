// Client-side mirror of main/data/pricing.js costOf (the sandboxed renderer cannot require main modules).
// Prices come from main via pricing.get, so the table itself lives in one place.
export function costOfClient(model, usage, { defaults = {}, overrides = {} } = {}) {
  const m = String(model || '').replace(/\[.*?\]/g, '').replace(/-\d{8}$/, '').trim();
  const table = { ...defaults };
  for (const [k, v] of Object.entries(overrides || {})) table[k] = { ...(table[k] || {}), ...v };
  let p = table[m];
  if (!p) {
    let best = null;
    for (const k of Object.keys(table)) if (m.startsWith(k) && (!best || k.length > best.length)) best = k;
    p = best ? table[best] : null;
  }
  if (!p || p.input == null) return null;
  const u = usage || {};
  const cc = u.cache_creation || {};
  const hasSplit = cc.ephemeral_5m_input_tokens != null || cc.ephemeral_1h_input_tokens != null;
  const w5 = hasSplit ? cc.ephemeral_5m_input_tokens || 0 : u.cache_creation_input_tokens || 0;
  const w1 = cc.ephemeral_1h_input_tokens || 0;
  const read = p.cacheRead != null ? p.cacheRead : p.input * 0.1;
  return ((u.input_tokens || 0) * p.input + (u.output_tokens || 0) * p.output + (u.cache_read_input_tokens || 0) * read
    + w5 * p.input * 1.25 + w1 * p.input * 2) / 1e6;
}
