import { h, clear } from '../lib/dom.js';
import { settingsScopes, scopeSelect, loadJson, saveJson, invalidJsonGuard, listEditor } from '../lib/jsonedit.js';

const MODES = [
  ['', '(default)'], ['default', 'default — ask for each risky action'], ['acceptEdits', 'acceptEdits — auto-accept file edits'],
  ['plan', 'plan — read-only planning'], ['auto', 'auto — classifier approves safe actions'], ['bypassPermissions', 'bypassPermissions — never ask (dangerous)'],
];
const EXAMPLES = ['Bash(npm run test:*)', 'Bash(git status)', 'Read(./src/**)', 'Edit(./docs/**)', 'WebFetch(domain:github.com)', 'mcp__github', 'Read(./.env)'];

export async function render(el, _p, query) {
  const scopes = await settingsScopes();
  let current = query.get('file') || scopes[0].path;
  const body = h('div');
  el.append(h('h1', null, 'Permissions'), h('p', { class: 'sub' }, 'Rules that decide which tool calls run without asking. Deny beats ask beats allow.'),
    h('div', { class: 'row', style: { marginBottom: '12px' } }, scopeSelect(scopes, current, (v) => { current = v; draw(); })), body);

  async function draw() {
    clear(body);
    const r = await loadJson(current);
    if (invalidJsonGuard(body, current, r, draw)) return;
    const data = r.data || {};
    const p = data.permissions || {};
    const allow = listEditor(p.allow, { placeholder: 'Bash(npm test)' });
    const ask = listEditor(p.ask, { placeholder: 'Bash(git push:*)' });
    const deny = listEditor(p.deny, { placeholder: 'Read(./.env)' });
    const dirs = listEditor(p.additionalDirectories, { placeholder: 'C:\\path\\to\\other\\repo' });
    const mode = h('select', null, MODES.map(([v, l]) => h('option', { value: v }, l)));
    mode.value = p.defaultMode || '';
    if (p.defaultMode && !MODES.some(([v]) => v === p.defaultMode)) { mode.append(h('option', { value: p.defaultMode }, p.defaultMode)); mode.value = p.defaultMode; }
    const col = (title, cls, ed, help) => h('div', { class: 'card' }, h('h2', null, h('span', { class: `pill ${cls}` }, title)), h('p', { class: 'muted small', style: { marginTop: 0 } }, help), ed.el);
    body.append(
      h('div', { class: 'card', style: { marginBottom: '14px' } }, h('label', { class: 'field' }, 'Default permission mode', mode)),
      h('div', { class: 'grid cols-3' },
        col('allow', 'good', allow, 'Run without asking.'),
        col('ask', 'accent', ask, 'Always ask, even if allowed elsewhere.'),
        col('deny', 'bad', deny, 'Never allowed.')),
      h('div', { class: 'card', style: { marginTop: '14px' } }, h('h2', null, 'Additional directories'),
        h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Extra folders Claude may read and edit besides the working directory.'), dirs.el),
      h('p', { class: 'muted small' }, 'Rule examples: ', EXAMPLES.map((e) => h('code', { style: { marginRight: '6px' } }, e))),
      h('button', { class: 'btn primary', onclick: async () => {
        const next = JSON.parse(JSON.stringify(data));
        const np = { ...(next.permissions || {}) };
        for (const [k, ed] of [['allow', allow], ['ask', ask], ['deny', deny], ['additionalDirectories', dirs]]) {
          const v = ed.get(); if (v.length) np[k] = v; else delete np[k];
        }
        if (mode.value) np.defaultMode = mode.value; else delete np.defaultMode;
        if (Object.keys(np).length) next.permissions = np; else delete next.permissions;
        if (await saveJson(current, next)) draw();
      } }, 'Review & save'));
  }
  await draw();
}
