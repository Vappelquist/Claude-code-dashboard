import { h, clear, api, modal, guarded } from '../lib/dom.js';
import * as f from '../lib/format.js';

async function editTemplate(t = { name: '', prompt: '' }) {
  const name = h('input', { type: 'text', value: t.name, placeholder: 'Template name' });
  const prompt = h('textarea', { rows: 8, style: { fontFamily: 'inherit', fontSize: '13px' } }, t.prompt);
  const r = await modal({ title: t.name ? 'Edit template' : 'New template',
    body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, h('label', { class: 'field' }, 'Name', name), h('label', { class: 'field' }, 'Prompt', prompt)),
    actions: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'ok', primary: true }] });
  if (r !== 'ok' || !name.value.trim() || !prompt.value.trim()) return null;
  return { name: name.value.trim(), prompt: prompt.value.trim() };
}

export async function render(el) {
  const [projects, version, live] = await Promise.all([api('projects.known'), api('runner.version'), api('sessions.live')]);
  const tplBox = h('div');
  el.append(h('h1', null, 'Quick Actions'), h('p', { class: 'sub' }, 'Shortcuts for starting Claude Code work.'),
    h('div', { class: 'grid cols-3', style: { marginBottom: '14px' } },
      h('div', { class: 'card kpi' }, h('div', { class: 'label' }, 'Claude Code CLI'), h('div', { class: 'value', style: { fontSize: '18px' } }, version || 'Not found'),
        h('div', { class: 'meta' }, version ? 'claude is on PATH' : h('span', null, 'Install: ', h('code', null, 'npm install -g @anthropic-ai/claude-code')))),
      h('div', { class: 'card kpi' }, h('div', { class: 'label' }, 'Running sessions'), h('div', { class: 'value', style: { fontSize: '18px' } }, String(live.length)),
        h('div', { class: 'meta' }, live.map((l) => `${f.projectName(l.cwd)} · ${l.entrypoint || l.kind || ''} · ${l.status || ''}`).join('\n') || 'none')),
      h('div', { class: 'card kpi' }, h('div', { class: 'label' }, 'New terminal session'),
        h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn primary', onclick: async () => { const p = await api('dialog.pickFolder'); if (p) guarded(() => api('terminal.open', { cwd: p }), 'Opening terminal…'); } }, 'Pick folder & open claude')))),
    h('div', { class: 'grid cols-2' },
      h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Prompt templates'),
        h('button', { class: 'btn sm', onclick: async () => { const t = await editTemplate(); if (t) { templates.push(t); save(); } } }, '+ New')), tplBox),
      h('div', { class: 'card' }, h('h2', null, 'Projects'),
        projects.length ? h('table', { class: 'tbl' }, projects.map((p) => h('tr', null,
          h('td', null, h('b', null, f.projectName(p)), h('div', { class: 'muted small mono' }, p)),
          h('td', { style: { whiteSpace: 'nowrap', width: '1%' } },
            h('button', { class: 'btn sm', onclick: () => guarded(() => api('terminal.open', { cwd: p }), 'Opening terminal…') }, 'Terminal'), ' ',
            h('a', { class: 'btn sm', href: `#/run?cwd=${encodeURIComponent(p)}` }, 'Run'), ' ',
            h('button', { class: 'btn sm', onclick: () => api('shell.openPath', p) }, 'Folder'))))) : h('div', { class: 'empty' }, 'No projects yet.'))));

  let templates = await api('templates.list');
  const save = async () => { await guarded(() => api('templates.save', templates), 'Templates saved'); draw(); };
  const draw = () => {
    clear(tplBox);
    if (!templates.length) { tplBox.append(h('div', { class: 'empty' }, 'No templates.')); return; }
    templates.forEach((t, i) => tplBox.append(h('div', { style: { padding: '8px 0', borderBottom: '1px solid #262624' } },
      h('div', { class: 'row' }, h('b', { class: 'grow' }, t.name),
        h('a', { class: 'btn sm primary', href: `#/run?prompt=${encodeURIComponent(t.prompt)}` }, 'Use'),
        h('button', { class: 'btn sm', onclick: async () => { const n = await editTemplate(t); if (n) { templates[i] = n; save(); } } }, 'Edit'),
        h('button', { class: 'btn sm danger', onclick: () => { templates.splice(i, 1); save(); } }, '✕')),
      h('div', { class: 'secondary small', style: { marginTop: '4px', whiteSpace: 'pre-wrap' } }, t.prompt.slice(0, 240)))));
  };
  draw();
}
