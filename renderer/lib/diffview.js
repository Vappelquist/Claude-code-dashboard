import { h, modal, toast, api } from './dom.js';

/** Render a diff [{op,line}] collapsing long unchanged runs. */
export function diffNode(diff, context = 3) {
  const box = h('div', { class: 'diff' });
  const changed = diff.map((d) => d.op !== '=');
  const near = (i) => { for (let k = Math.max(0, i - context); k <= Math.min(diff.length - 1, i + context); k++) if (changed[k]) return true; return false; };
  let skipped = 0;
  diff.forEach((d, i) => {
    if (d.op === '=' && !near(i)) { skipped++; return; }
    if (skipped) { box.append(h('div', { class: 'gap' }, `… ${skipped} unchanged line${skipped > 1 ? 's' : ''}`)); skipped = 0; }
    box.append(h('div', { class: d.op === '+' ? 'add' : d.op === '-' ? 'del' : 'ctx' }, (d.op === '=' ? '  ' : d.op + ' ') + d.line));
  });
  if (skipped) box.append(h('div', { class: 'gap' }, `… ${skipped} unchanged line${skipped > 1 ? 's' : ''}`));
  return box;
}

/**
 * Every Control save goes through here: show diff → confirm → write (main makes a backup first).
 * Returns true when written.
 */
export async function confirmWrite(path, newText, { json = false, expected } = {}) {
  let diff;
  try { diff = await api('config.preview', path, newText); }
  catch (e) { toast(String(e.message || e), 'error'); return false; }
  const changes = diff.filter((d) => d.op !== '=').length;
  if (!changes) { toast('No changes to save'); return false; }
  const body = h('div', null,
    h('div', { class: 'secondary small', style: { marginBottom: '8px' } },
      h('span', { class: 'mono' }, path), ` — ${changes} changed line${changes > 1 ? 's' : ''}. A backup of the current file is made before saving.`),
    diffNode(diff));
  const ok = await modal({ title: 'Review changes', body, wide: true, actions: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }] });
  if (!ok) return false;
  try {
    const r = await api('config.write', path, newText, json, expected);
    toast(r.backupPath ? `Saved. Backup: ${r.backupPath}` : 'Saved (new file).', 'good', 6000);
    return true;
  } catch (e) {
    toast(String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error', 9000);
    return false;
  }
}
