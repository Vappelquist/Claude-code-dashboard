import { h, clear, api, modal, toast, confirm } from '../lib/dom.js';
import { diffNode } from '../lib/diffview.js';
import { projectName } from '../lib/format.js';
import { kvEditor, listEditor } from '../lib/jsonedit.js';

const errMsg = (e) => String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

async function applyChange(change, title) {
  let p;
  try { p = await api('mcp.plan', change); } catch (e) { toast(errMsg(e), 'error', 8000); return false; }
  const ok = await modal({ title, wide: true, body: h('div', null,
    h('div', { class: 'secondary small', style: { marginBottom: '8px' } }, h('span', { class: 'mono' }, p.path), ' — a backup is made before saving.'), diffNode(p.diff)),
  actions: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }] });
  if (!ok) return false;
  try { const r = await api('mcp.apply', change); toast(r.backupPath ? `Saved. Backup: ${r.backupPath}` : 'Saved.', 'good', 6000); return true; }
  catch (e) { toast(errMsg(e), 'error', 9000); return false; }
}

async function serverForm(projects, initial = {}) {
  const c = initial.config || {};
  const name = h('input', { type: 'text', value: initial.name || '', placeholder: 'github', class: 'mono', disabled: !!initial.name });
  const scope = h('select', null, h('option', { value: 'user' }, 'User — all projects (~/.claude.json)'),
    projects.map((p) => [h('option', { value: `local|${p}` }, `${projectName(p)} — just me (~/.claude.json)`), h('option', { value: `project|${p}` }, `${projectName(p)} — shared with team (.mcp.json)`)]));
  scope.value = initial.scope ? (initial.scope === 'user' ? 'user' : `${initial.scope}|${initial.project}`) : 'user';
  if (initial.name) scope.disabled = true;
  const type = h('select', null, ['stdio', 'http', 'sse'].map((t) => h('option', { value: t }, t)));
  type.value = c.type || (c.url ? 'http' : 'stdio');
  const command = h('input', { type: 'text', value: c.command || '', placeholder: 'npx', class: 'mono' });
  const args = listEditor((c.args || []).map(String), { placeholder: 'one argument per row, e.g. -y', trim: false });
  const url = h('input', { type: 'text', value: c.url || '', placeholder: 'https://example.com/mcp', class: 'mono' });
  const env = kvEditor(c.env || {});
  const headers = kvEditor(c.headers || {}, { keyPh: 'Header', valPh: 'value' });
  const stdioBox = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    h('label', { class: 'field' }, 'Command', command), h('label', { class: 'field' }, 'Arguments (one per row; spaces inside an argument are kept)', args.el),
    h('label', { class: 'field' }, 'Environment', env.el));
  const httpBox = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    h('label', { class: 'field' }, 'URL', url), h('label', { class: 'field' }, 'Headers', headers.el));
  const sync = () => { stdioBox.style.display = type.value === 'stdio' ? 'flex' : 'none'; httpBox.style.display = type.value === 'stdio' ? 'none' : 'flex'; };
  type.addEventListener('change', sync); sync();
  const r = await modal({ title: initial.name ? `Edit ${initial.name}` : 'Add MCP server',
    body: h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
      h('label', { class: 'field' }, 'Name', name), h('label', { class: 'field' }, 'Scope', scope), h('label', { class: 'field' }, 'Transport', type), stdioBox, httpBox),
    actions: [{ label: 'Cancel', value: null }, { label: 'Review', value: 'ok', primary: true }] });
  if (r !== 'ok') return null;
  const [sc, proj] = scope.value.split('|');
  // Keep unknown fields from the existing config.
  const { type: _t, command: _c, args: _a, url: _u, env: _e, headers: _h, ...rest } = c;
  let cfg;
  if (type.value === 'stdio') {
    cfg = { ...rest, command: command.value.trim(), args: args.get() };
    if (c.type === 'stdio') cfg.type = 'stdio';
    const e = env.get(); if (Object.keys(e).length) cfg.env = e;
  } else {
    cfg = { ...rest, type: type.value, url: url.value.trim() };
    const hd = headers.get(); if (Object.keys(hd).length) cfg.headers = hd;
  }
  return { scope: sc, project: proj || null, name: name.value.trim(), config: cfg };
}

export async function render(el) {
  const body = h('div');
  el.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h1', null, 'MCP Servers'),
    h('p', { class: 'sub' }, 'Model Context Protocol servers give Claude extra tools. Changes apply to new sessions.')),
    h('button', { class: 'btn primary', onclick: async () => { const c = await serverForm(await api('projects.known')); if (c && await applyChange(c, `Add ${c.name}`)) draw(); } }, '+ Add server')), body);

  async function draw() {
    clear(body);
    const [{ servers, error }, projects] = await Promise.all([api('mcp.list'), api('projects.known')]);
    if (error) body.append(h('div', { class: 'banner' }, `~/.claude.json could not be parsed: ${error}`));
    if (!servers.length) { body.append(h('div', { class: 'card empty' }, 'No MCP servers configured. Servers from claude.ai connectors and plugins are managed elsewhere and are not listed here.')); return; }
    const groups = [['user', 'User (all projects)'], ['local', 'Per project — private'], ['project', 'Per project — shared (.mcp.json)']];
    for (const [sc, title] of groups) {
      const items = servers.filter((s) => s.scope === sc);
      if (!items.length) continue;
      body.append(h('div', { class: 'card', style: { marginBottom: '12px' } }, h('h2', null, title),
        h('table', { class: 'tbl' }, h('tr', null, h('th', null, 'Name'), h('th', null, 'Transport'), h('th', null, 'Command / URL'), sc !== 'user' ? h('th', null, 'Project') : null, h('th', null, '')),
          items.map((s) => h('tr', null,
            h('td', null, h('b', null, s.name)),
            h('td', null, h('span', { class: 'pill' }, s.config.type || (s.config.url ? 'http' : 'stdio'))),
            h('td', { class: 'mono small' }, s.config.url || [s.config.command, ...(s.config.args || [])].join(' ')),
            sc !== 'user' ? h('td', { class: 'secondary', title: s.project }, projectName(s.project)) : null,
            h('td', { style: { whiteSpace: 'nowrap', width: '1%' } },
              h('button', { class: 'btn sm', onclick: async () => { const c = await serverForm(projects, s); if (c && await applyChange(c, `Edit ${s.name}`)) draw(); } }, 'Edit'), ' ',
              h('button', { class: 'btn sm danger', onclick: async () => {
                if (!(await confirm('Remove server', `Remove MCP server "${s.name}"?`, { danger: true, okLabel: 'Continue' }))) return;
                if (await applyChange({ scope: s.scope, project: s.project, name: s.name, config: null }, `Remove ${s.name}`)) draw();
              } }, 'Remove')))))));
    }
  }
  await draw();
}
