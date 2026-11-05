import { h, clear, api, guarded } from '../lib/dom.js';
import { confirmWrite } from '../lib/diffview.js';
import { settingsScopes, scopeSelect, loadJson, saveJson, invalidJsonGuard, kvEditor, expectedFor } from '../lib/jsonedit.js';

const FIELDS = [
  { key: 'model', label: 'Default model', type: 'datalist', options: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'opus', 'sonnet', 'haiku'], help: 'Model used for new sessions.' },
  { key: 'theme', label: 'Theme', type: 'select', options: ['', 'dark', 'light', 'dark-daltonized', 'light-daltonized', 'dark-ansi', 'light-ansi'] },
  { key: 'outputStyle', label: 'Output style', type: 'text', help: 'Name of an output style (e.g. Explanatory, Learning).' },
  { key: 'autoUpdatesChannel', label: 'Auto-update channel', type: 'select', options: ['', 'latest', 'stable'] },
  { key: 'cleanupPeriodDays', label: 'Keep transcripts (days)', type: 'number', help: 'Sessions older than this are deleted locally. Default 30.' },
  { key: 'includeCoAuthoredBy', label: 'Add "Co-Authored-By: Claude" to commits', type: 'bool' },
  { key: 'alwaysThinkingEnabled', label: 'Always enable thinking', type: 'bool' },
  { key: 'statusLine.command', label: 'Status line command', type: 'text', help: 'Shell command whose output is shown as the status line.' },
];

const getPath = (o, k) => k.split('.').reduce((a, p) => (a == null ? undefined : a[p]), o);
function setPath(o, k, v) {
  const parts = k.split('.');
  let cur = o;
  for (let i = 0; i < parts.length - 1; i++) { if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] == null) cur[parts[i]] = {}; cur = cur[parts[i]]; }
  const last = parts[parts.length - 1];
  if (v === undefined) delete cur[last]; else cur[last] = v;
  if (k === 'statusLine.command') { if (v === undefined) delete o.statusLine; else o.statusLine.type = o.statusLine.type || 'command'; }
}

export async function render(el, _p, query) {
  const scopes = await settingsScopes();
  let current = query.get('file') || scopes[0].path;
  let tab = 'form';
  const body = h('div');
  const tabs = h('div', { class: 'tabs' });
  el.append(h('h1', null, 'Settings'), h('p', { class: 'sub' }, 'Claude Code settings.json files. Project settings override user settings; local overrides project.'),
    h('div', { class: 'row', style: { marginBottom: '12px' } }, scopeSelect(scopes, current, (v) => { current = v; draw(); })), tabs, body);

  const setTab = (t) => { tab = t; draw(); };
  async function draw() {
    clear(tabs).append(...[['form', 'Editor'], ['raw', 'Raw JSON'], ['pricing', 'Cost estimates']].map(([k, l]) => h('button', { class: tab === k ? 'active' : '', onclick: () => setTab(k) }, l)));
    clear(body);
    if (tab === 'pricing') return drawPricing(body);
    const r = await loadJson(current);
    if (invalidJsonGuard(body, current, r, draw)) return;
    const data = r.data || {};
    if (tab === 'raw') {
      const ta = h('textarea', { rows: 28 }, r.raw || '{\n}\n');
      const status = h('span', { class: 'small' });
      const check = () => { try { JSON.parse(ta.value); status.textContent = '✓ valid JSON'; status.className = 'small muted'; } catch (e) { status.textContent = e.message; status.className = 'small err'; } };
      ta.addEventListener('input', check); check();
      body.append(ta, h('div', { class: 'row', style: { marginTop: '8px' } },
        h('button', { class: 'btn primary', onclick: async () => { if (await confirmWrite(current, ta.value, { json: true, expected: expectedFor(current) })) draw(); } }, 'Save'), status));
      return;
    }
    const inputs = {};
    const form = h('div', { class: 'grid cols-2' });
    for (const fd of FIELDS) {
      const v = getPath(data, fd.key);
      let inp;
      if (fd.type === 'bool') {
        inp = h('select', null, h('option', { value: '' }, '(default)'), h('option', { value: 'true' }, 'Yes'), h('option', { value: 'false' }, 'No'));
        inp.value = v === true ? 'true' : v === false ? 'false' : '';
      } else if (fd.type === 'select') {
        inp = h('select', null, fd.options.map((o) => h('option', { value: o }, o || '(default)')));
        if (v && !fd.options.includes(v)) inp.append(h('option', { value: v }, v));
        inp.value = v || '';
      } else if (fd.type === 'datalist') {
        const id = `dl-${fd.key}`;
        inp = h('input', { type: 'text', value: v || '', list: id, placeholder: '(default)' });
        form.append(h('datalist', { id }, fd.options.map((o) => h('option', { value: o }))));
      } else {
        inp = h('input', { type: fd.type === 'number' ? 'number' : 'text', value: v == null ? '' : String(v), placeholder: '(default)' });
      }
      inputs[fd.key] = { inp, fd };
      form.append(h('label', { class: 'field' }, fd.label, inp, fd.help ? h('span', { class: 'muted small' }, fd.help) : null));
    }
    const env = kvEditor(data.env || {}, { keyPh: 'ENV_VAR', valPh: 'value' });
    const known = new Set(['env', 'permissions', 'hooks', 'enabledPlugins', ...FIELDS.map((f) => f.key.split('.')[0])]);
    const other = Object.keys(data).filter((k) => !known.has(k));
    body.append(
      h('div', { class: 'card' }, form),
      h('div', { class: 'card', style: { marginTop: '14px' } }, h('h2', null, 'Environment variables'),
        h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Set for every Claude Code session using this settings file.'), env.el),
      other.length ? h('p', { class: 'muted small' }, `Other keys kept as-is: ${other.join(', ')}. Permissions, hooks and plugins have their own pages.`) : null,
      h('div', { class: 'row', style: { marginTop: '14px' } }, h('button', {
        class: 'btn primary', onclick: async () => {
          const next = JSON.parse(JSON.stringify(data));
          for (const { inp, fd } of Object.values(inputs)) {
            const raw = inp.value.trim();
            let val;
            if (raw === '') val = undefined;
            else if (fd.type === 'bool') val = raw === 'true';
            else if (fd.type === 'number') val = Number(raw);
            else val = raw;
            setPath(next, fd.key, val);
          }
          const e = env.get();
          if (Object.keys(e).length) next.env = e; else delete next.env;
          if (await saveJson(current, next)) draw();
        },
      }, 'Review & save')));
  }

  async function drawPricing(box) {
    const { defaults, overrides } = await api('pricing.get');
    const rows = Object.keys({ ...defaults, ...overrides }).sort();
    const inputs = {};
    box.append(h('p', { class: 'secondary' }, 'USD per million tokens, used for the dashboard\'s API-equivalent estimates only. Cache writes cost 1.25× input (5-minute) or 2× input (1-hour). Leave a field empty to use the default.'));
    const tbl = h('table', { class: 'tbl' }, h('tr', null, h('th', null, 'Model'), h('th', null, 'Input'), h('th', null, 'Output'), h('th', null, 'Cache read')));
    for (const m of rows) {
      const d = defaults[m] || {}, o = overrides[m] || {};
      const mk = (k) => h('input', { type: 'number', step: '0.01', style: { width: '110px' }, value: o[k] != null ? o[k] : '', placeholder: d[k] != null ? String(d[k]) : k === 'cacheRead' && d.input != null ? String(+(d.input * 0.1).toFixed(4)) : '' });
      inputs[m] = { input: mk('input'), output: mk('output'), cacheRead: mk('cacheRead') };
      tbl.append(h('tr', null, h('td', { class: 'mono' }, m), h('td', null, inputs[m].input), h('td', null, inputs[m].output), h('td', null, inputs[m].cacheRead)));
    }
    const newModel = h('input', { type: 'text', placeholder: 'add model id…', class: 'mono' });
    box.append(h('div', { class: 'card' }, tbl), h('div', { class: 'row', style: { marginTop: '12px' } },
      newModel, h('button', { class: 'btn', onclick: async () => {
        const id = newModel.value.trim(); if (!id) return;
        await api('pricing.set', { ...overrides, [id]: { input: 0, output: 0 } }); draw();
      } }, 'Add'), h('div', { class: 'grow' }),
      h('button', { class: 'btn', onclick: () => guarded(async () => { await api('pricing.set', {}); draw(); }, 'Prices reset to defaults') }, 'Reset all'),
      h('button', { class: 'btn primary', onclick: () => guarded(async () => {
        const next = {};
        for (const [m, ins] of Object.entries(inputs)) {
          const o = {};
          for (const k of ['input', 'output', 'cacheRead']) if (ins[k].value !== '') o[k] = Number(ins[k].value);
          if (Object.keys(o).length) next[m] = o;
        }
        await api('pricing.set', next);
      }, 'Prices saved; estimates recalculated') }, 'Save prices')));
  }
  await draw();
}
