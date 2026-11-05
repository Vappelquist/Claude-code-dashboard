import { h, clear, api, guarded } from '../lib/dom.js';
import * as f from '../lib/format.js';
import { render as md } from '../lib/md.js';

export async function render(el) {
  const [st, locs, inv] = await Promise.all([api('stats.get', 'all'), api('config.locations'), api('inventory.get')]);
  el.append(h('h1', null, 'Projects'), h('p', { class: 'sub' }, 'Every folder you have run Claude Code in.'));
  if (!st.byProject.length) { el.append(h('div', { class: 'empty' }, 'No projects yet.')); return; }
  const grid = h('div', { class: 'grid auto-fill' });
  const detail = h('div', { style: { marginTop: '16px' } });
  el.append(grid, detail);

  const memFor = (key) => inv.memory.find((m) => m.project === key);
  for (const p of st.byProject) {
    const cm = locs.find((l) => l.project === p.cwd && l.kind === 'claudemd' && l.scope === 'project');
    const mem = memFor(p.projectKey);
    grid.append(h('div', { class: 'card', style: { cursor: 'pointer' }, onclick: () => showDetail(p, cm, mem) },
      h('div', { style: { fontWeight: 600, fontSize: '14px' } }, f.projectName(p.cwd || p.projectKey)),
      h('div', { class: 'muted small mono', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: '2px 0 10px' }, title: p.cwd }, p.cwd || p.projectKey),
      h('div', { class: 'kpi-row', style: { gridTemplateColumns: 'repeat(3,1fr)' } },
        h('div', null, h('div', { class: 'k' }, 'Sessions'), h('div', { class: 'v' }, f.int(p.sessions))),
        h('div', null, h('div', { class: 'k' }, 'Tokens'), h('div', { class: 'v' }, f.tokens(p.tokens))),
        h('div', null, h('div', { class: 'k' }, 'Est. cost'), h('div', { class: 'v' }, f.usd(p.costUsd)))),
      h('div', { class: 'row small', style: { marginTop: '10px' } },
        h('span', { class: 'muted' }, `Last active ${f.ago(p.last)}`), h('div', { class: 'grow' }),
        cm && cm.exists ? h('span', { class: 'pill' }, 'CLAUDE.md') : null,
        mem ? h('span', { class: 'pill' }, `${mem.files.length} memory`) : null)));
  }

  async function showDetail(p, cm, mem) {
    clear(detail);
    const body = h('div', { class: 'card' });
    detail.append(body);
    body.append(h('div', { class: 'row' }, h('h2', { class: 'grow' }, f.projectName(p.cwd)),
      h('a', { class: 'btn sm', href: `#/sessions?project=${encodeURIComponent(p.cwd || '')}` }, 'Sessions'),
      h('a', { class: 'btn sm', href: `#/run?cwd=${encodeURIComponent(p.cwd || '')}` }, 'New run here'),
      p.cwd ? h('button', { class: 'btn sm', onclick: () => guarded(() => api('terminal.open', { cwd: p.cwd })) }, 'Open terminal') : null,
      p.cwd ? h('button', { class: 'btn sm', onclick: () => api('shell.openPath', p.cwd) }, 'Open folder') : null));
    if (cm && cm.exists) {
      const text = await api('file.read', cm.path);
      body.append(h('div', { class: 'row', style: { marginTop: '10px' } }, h('b', { class: 'grow' }, 'CLAUDE.md'),
        h('a', { class: 'btn sm', href: `#/memory?file=${encodeURIComponent(cm.path)}` }, 'Edit')),
        h('div', { class: 'md card', style: { background: 'var(--surface-2)', marginTop: '6px', maxHeight: '360px', overflow: 'auto' }, html: md(text || '') }));
    } else if (p.cwd) {
      body.append(h('p', { class: 'muted' }, 'No CLAUDE.md in this project. ', h('a', { href: `#/memory?file=${encodeURIComponent((cm && cm.path) || '')}` }, 'Create one')));
    }
    if (mem) {
      body.append(h('b', { style: { display: 'block', marginTop: '14px' } }, 'Memory files'));
      for (const file of mem.files) {
        const t = await api('file.read', file);
        body.append(h('details', { class: 'tool', style: { marginTop: '6px' } }, h('summary', null, h('span', { class: 'mono small' }, file.split(/[\\/]/).pop())),
          h('div', { class: 'tbody md', html: md(t || '') })));
      }
    }
    detail.scrollIntoView({ behavior: 'smooth' });
  }
}
