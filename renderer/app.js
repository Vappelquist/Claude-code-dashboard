import { h, clear, toast } from './lib/dom.js';
import { openPalette } from './lib/search.js';

export const NAV = [
  { group: 'Insight', items: [
    { id: 'overview', label: 'Overview', ico: '◎' },
    { id: 'sessions', label: 'Sessions', ico: '☰' },
    { id: 'projects', label: 'Projects', ico: '▦' },
    { id: 'tools', label: 'Tools & Models', ico: '⚒' },
    { id: 'history', label: 'Prompt History', ico: '↺' },
  ] },
  { group: 'Control', items: [
    { id: 'settings', label: 'Settings', ico: '⚙' },
    { id: 'permissions', label: 'Permissions', ico: '⛨' },
    { id: 'hooks', label: 'Hooks', ico: '⚓' },
    { id: 'mcp', label: 'MCP Servers', ico: '⇄' },
    { id: 'extensions', label: 'Plugins & Skills', ico: '✦' },
    { id: 'memory', label: 'Memory & CLAUDE.md', ico: '✎' },
    { id: 'backups', label: 'Backups', ico: '⟲' },
  ] },
  { group: 'Command Center', items: [
    { id: 'run', label: 'Run', ico: '▶' },
    { id: 'actions', label: 'Quick Actions', ico: '⚡' },
  ] },
];
const VIEWS = {
  overview: () => import('./views/overview.js'),
  sessions: () => import('./views/sessions.js'),
  session: () => import('./views/session.js'),
  projects: () => import('./views/projects.js'),
  tools: () => import('./views/tools.js'),
  history: () => import('./views/history.js'),
  settings: () => import('./views/settings.js'),
  permissions: () => import('./views/permissions.js'),
  hooks: () => import('./views/hooks.js'),
  mcp: () => import('./views/mcp.js'),
  extensions: () => import('./views/extensions.js'),
  memory: () => import('./views/memory.js'),
  backups: () => import('./views/backups.js'),
  run: () => import('./views/run.js'),
  actions: () => import('./views/actions.js'),
};

const sidebar = document.getElementById('sidebar');
const main = document.getElementById('main');

function renderSidebar(active) {
  clear(sidebar);
  sidebar.append(h('div', { class: 'brand' }, h('div', { class: 'logo' }, 'C'), 'Claude Code'));
  for (const g of NAV) {
    sidebar.append(h('div', { class: 'group' }, g.group));
    for (const it of g.items) {
      sidebar.append(h('a', { class: `nav ${active === it.id || (active === 'session' && it.id === 'sessions') ? 'active' : ''}`, href: `#/${it.id}` },
        h('span', { class: 'ico' }, it.ico), it.label));
    }
  }
  sidebar.append(h('div', { class: 'spacer' }));
  sidebar.append(h('div', { class: 'hint' }, 'Ctrl+K  search everything'));
}

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || 'overview';
  const [pathPart, qs] = raw.split('?');
  const [view, ...rest] = pathPart.split('/');
  return { view, param: rest.map(decodeURIComponent).join('/'), query: new URLSearchParams(qs || '') };
}

let current = { cleanup: null, token: 0 };
async function route() {
  const { view, param, query } = parseHash();
  const v = VIEWS[view] ? view : 'overview';
  renderSidebar(v);
  if (current.cleanup) { try { current.cleanup(); } catch { /* ignore */ } current.cleanup = null; }
  const token = ++current.token;
  const container = h('div', { class: 'view' });
  clear(main).append(container);
  main.scrollTop = 0;
  try {
    const mod = await VIEWS[v]();
    if (token !== current.token) return;
    const cleanup = await mod.render(container, param, query);
    if (token === current.token) current.cleanup = typeof cleanup === 'function' ? cleanup : null;
    else if (typeof cleanup === 'function') cleanup();
  } catch (e) {
    console.error(e);
    container.append(h('div', { class: 'banner' }, `Failed to render ${v}: ${e.message}`));
  }
}

window.addEventListener('hashchange', route);
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(NAV); }
});
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); });
if (!window.api) toast('Preload bridge missing: window.api is undefined', 'error', 20000);
route();
