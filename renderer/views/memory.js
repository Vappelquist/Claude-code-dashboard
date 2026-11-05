import { h, clear, api } from '../lib/dom.js';
import { confirmWrite } from '../lib/diffview.js';
import { render as md } from '../lib/md.js';
import { projectName } from '../lib/format.js';

export async function render(el, _p, query) {
  const [locs, inv] = await Promise.all([api('config.locations'), api('inventory.get')]);
  const files = [
    ...locs.filter((l) => l.kind === 'claudemd').map((l) => ({
      path: l.path, exists: l.exists,
      label: l.scope === 'user' ? 'Global CLAUDE.md' : `${projectName(l.project)} · ${l.scope === 'local' ? 'CLAUDE.local.md' : 'CLAUDE.md'}`,
      group: l.scope === 'user' ? 'Global' : 'Projects',
    })),
    ...inv.memory.flatMap((m) => m.files.map((p) => ({ path: p, exists: true, label: `${m.project.replace(/^C--Users-[^-]+-/, '')} · ${p.split(/[\\/]/).pop()}`, group: 'Auto memory' }))),
  ];
  let current = query.get('file') && files.find((f) => f.path === query.get('file')) ? query.get('file') : (files.find((f) => f.exists) || files[0]).path;
  const list = h('div', { class: 'filelist' });
  const editor = h('div');
  el.append(h('h1', null, 'Memory & CLAUDE.md'), h('p', { class: 'sub' }, 'Instructions Claude reads at the start of every session, plus its auto-memory files.'),
    h('div', { class: 'split' }, h('div', { class: 'card', style: { padding: '8px' } }, list), editor));

  const drawList = () => {
    clear(list);
    let g = null;
    for (const f of files) {
      if (f.group !== g) { g = f.group; list.append(h('div', { class: 'muted small', style: { padding: '8px 8px 2px', textTransform: 'uppercase', letterSpacing: '.05em' } }, g)); }
      list.append(h('button', { class: current === f.path ? 'active' : '', title: f.path, onclick: () => { current = f.path; drawList(); drawEditor(); } },
        f.label, f.exists ? '' : h('span', { class: 'muted' }, ' (new)')));
    }
  };
  async function drawEditor() {
    clear(editor);
    const f = files.find((x) => x.path === current);
    const original = (await api('file.read', current)) || '';
    let preview = false;
    const ta = h('textarea', { rows: 30 }, original);
    const pv = h('div', { class: 'md card', style: { display: 'none', minHeight: '400px' } });
    const toggle = h('button', { class: 'btn', onclick: () => { preview = !preview; pv.innerHTML = md(ta.value); pv.style.display = preview ? 'block' : 'none'; ta.style.display = preview ? 'none' : 'block'; toggle.textContent = preview ? 'Edit' : 'Preview'; } }, 'Preview');
    editor.append(h('div', { class: 'row', style: { marginBottom: '8px' } }, h('span', { class: 'mono small muted grow' }, current), toggle,
      h('button', { class: 'btn', onclick: () => api('shell.openPath', current), disabled: !f.exists }, 'Open externally'),
      h('button', { class: 'btn primary', onclick: async () => { if (await confirmWrite(current, ta.value, { expected: original })) { f.exists = true; drawList(); drawEditor(); } } }, 'Review & save')),
      ta, pv);
  }
  drawList();
  await drawEditor();
}
