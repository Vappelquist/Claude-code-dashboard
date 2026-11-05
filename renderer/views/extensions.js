import { h, clear, api, modal, prompt, guarded } from '../lib/dom.js';
import { render as md } from '../lib/md.js';
import { projectName } from '../lib/format.js';
import { loadJson, saveJson } from '../lib/jsonedit.js';

async function viewFile(path, title) {
  const text = await api('file.read', path);
  const body = h('div', null, h('div', { class: 'muted small mono', style: { marginBottom: '8px' } }, path),
    h('div', { class: 'md card', style: { background: 'var(--surface-2)' }, html: md(String(text || '').replace(/^---[\s\S]*?---\s*/, '')) }));
  const r = await modal({ title, body, wide: true, actions: [{ label: 'Open file', value: 'open' }, { label: 'Close', value: null, primary: true }] });
  if (r === 'open') api('shell.openPath', path);
}

export async function render(el, _p, query) {
  let tab = query.get('tab') || 'plugins';
  const tabs = h('div', { class: 'tabs' });
  const body = h('div');
  el.append(h('h1', null, 'Plugins, Skills & Agents'), h('p', { class: 'sub' }, 'Everything that extends Claude Code on this machine.'), tabs, body);

  async function draw() {
    const inv = await api('inventory.get');
    const counts = { plugins: inv.plugins.length, marketplaces: inv.marketplaces.length, skills: inv.skills.length, agents: inv.agents.length, commands: inv.commands.length };
    clear(tabs).append(...[['plugins', 'Plugins'], ['skills', 'Skills'], ['agents', 'Agents'], ['commands', 'Slash commands'], ['marketplaces', 'Marketplaces']]
      .map(([k, l]) => h('button', { class: tab === k ? 'active' : '', onclick: () => { tab = k; draw(); } }, `${l} (${counts[k]})`)));
    clear(body);
    const search = h('input', { type: 'search', placeholder: 'Filter…', style: { width: '260px' } });
    const listBox = h('div');
    const projects = await api('projects.known');
    const create = async (kind) => {
      const name = await prompt(`New ${kind}`, { label: 'Name (letters, digits, - and _)', placeholder: `my-${kind}` });
      if (!name) return;
      let scope = 'user', project = null;
      if (projects.length) {
        const sel = h('select', null, h('option', { value: '' }, 'User (~/.claude) — available everywhere'), projects.map((p) => h('option', { value: p }, `Project: ${projectName(p)}`)));
        const r = await modal({ title: `Where should "${name}" live?`, body: sel, actions: [{ label: 'Cancel', value: null }, { label: 'Create', value: 'ok', primary: true }] });
        if (r !== 'ok') return;
        if (sel.value) { scope = 'project'; project = sel.value; }
      }
      const p = await guarded(() => api('inventory.create', kind, scope, name, project), `Created ${kind} "${name}"`);
      if (p) { api('shell.openPath', p); draw(); }
    };
    const filterRows = (rows, fn) => { const q = search.value.toLowerCase(); return rows.filter((r) => !q || fn(r).toLowerCase().includes(q)); };
    const itemTable = (rows, kind) => {
      clear(listBox);
      const f = filterRows(rows, (r) => `${r.name} ${r.description} ${r.scope}`);
      if (!f.length) { listBox.append(h('div', { class: 'empty' }, 'Nothing here yet.')); return; }
      listBox.append(h('table', { class: 'tbl' }, h('tr', null, h('th', null, 'Name'), h('th', null, 'Description'), h('th', null, 'Source')),
        f.map((r) => h('tr', { class: 'click', onclick: () => viewFile(r.path, r.name) },
          h('td', null, h('b', null, kind === 'commands' ? `/${r.name}` : r.name)),
          h('td', { class: 'secondary', style: { maxWidth: '700px' } }, r.description),
          h('td', null, h('span', { class: 'pill' }, r.scope === 'project' ? `project: ${projectName(r.project)}` : r.scope))))));
    };

    if (tab === 'plugins') {
      const settingsPath = (await api('config.locations')).find((l) => l.scope === 'user' && l.kind === 'settings').path;
      const drawPlugins = () => {
        clear(listBox);
        const f = filterRows(inv.plugins, (p) => `${p.name} ${p.description}`);
        if (!f.length) { listBox.append(h('div', { class: 'empty' }, 'No plugins installed. Use /plugin inside Claude Code to browse marketplaces.')); return; }
        listBox.append(h('table', { class: 'tbl' }, h('tr', null, h('th', null, 'Plugin'), h('th', null, 'Description'), h('th', null, 'Version'), h('th', null, 'Enabled')),
          f.map((p) => {
            const toggle = h('input', { type: 'checkbox', checked: p.enabled });
            toggle.addEventListener('change', async () => {
              const r = await loadJson(settingsPath);
              if (r.error) { toggle.checked = !toggle.checked; return; }
              const next = JSON.parse(JSON.stringify(r.data || {}));
              next.enabledPlugins = { ...(next.enabledPlugins || {}), [p.key]: toggle.checked };
              if (!(await saveJson(settingsPath, next))) toggle.checked = !toggle.checked;
            });
            return h('tr', null, h('td', null, h('b', null, p.name)), h('td', { class: 'secondary', style: { maxWidth: '700px' } }, p.description),
              h('td', { class: 'muted' }, p.version || '—'), h('td', null, h('label', { class: 'check' }, toggle)));
          })));
      };
      body.append(h('div', { class: 'row', style: { marginBottom: '10px' } }, search), h('div', { class: 'card' }, listBox));
      search.addEventListener('input', drawPlugins); drawPlugins();
    } else if (tab === 'marketplaces') {
      const drawM = () => {
        clear(listBox);
        if (!inv.marketplaces.length) { listBox.append(h('div', { class: 'empty' }, 'No marketplaces added.')); return; }
        for (const m of inv.marketplaces) {
          const cat = filterRows(m.catalog, (p) => `${p.name} ${p.description}`);
          listBox.append(h('div', { class: 'card', style: { marginBottom: '12px' } },
            h('div', { class: 'row' }, h('h2', { class: 'grow' }, m.name), h('span', { class: 'muted small mono' }, m.source)),
            h('div', { class: 'muted small', style: { marginBottom: '8px' } }, `${m.available} plugins available · install with `, h('code', null, `/plugin install <name>@${m.name}`)),
            h('details', null, h('summary', { class: 'small', style: { cursor: 'pointer' } }, `Browse catalog (${cat.length})`),
              h('table', { class: 'tbl' }, cat.map((p) => h('tr', null, h('td', null, h('b', null, p.name)), h('td', { class: 'secondary' }, p.description), h('td', null,
                h('button', { class: 'btn sm', onclick: () => guarded(() => api('clipboard.write', `/plugin install ${p.name}@${m.name}`), 'Install command copied') }, 'Copy install'))))))));
        }
      };
      body.append(h('div', { class: 'row', style: { marginBottom: '10px' } }, search), listBox);
      search.addEventListener('input', drawM); drawM();
    } else {
      const kind = { skills: 'skill', agents: 'agent', commands: 'command' }[tab];
      body.append(h('div', { class: 'row', style: { marginBottom: '10px' } }, search, h('div', { class: 'grow' }),
        h('button', { class: 'btn primary', onclick: () => create(kind) }, `+ New ${kind}`)), h('div', { class: 'card' }, listBox));
      const redraw = () => itemTable(inv[tab], tab);
      search.addEventListener('input', redraw); redraw();
    }
  }
  await draw();
}
