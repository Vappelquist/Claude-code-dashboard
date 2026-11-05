export function tokens(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K';
  return String(Math.round(n));
}
export function usd(n) {
  n = Number(n) || 0;
  if (n > 0 && n < 0.01) return '<$0.01';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function int(n) { return (Number(n) || 0).toLocaleString('en-US'); }
export function pct(x) { return (Math.round((Number(x) || 0) * 1000) / 10) + '%'; }
export function ago(ts) {
  if (!ts) return '—';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
  return date(ts);
}
export function date(ts) { return ts ? new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'; }
export function datetime(ts) { return ts ? new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
export function duration(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}
export function shortModel(m) {
  return String(m || 'unknown').replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[.*\]$/, '');
}
export function projectName(cwd) {
  if (!cwd) return '—';
  const parts = String(cwd).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || cwd;
}
export function totalTokens(t) { return t ? (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0) : 0; }
