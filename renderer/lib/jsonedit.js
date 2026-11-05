import { h, clear, api } from './dom.js';
import { confirmWrite } from './diffview.js';
import { projectName } from './format.js';

/** Scope picker over settings.json files: user, and per project shared/local. */
export async function settingsScopes() {
  const locs = await api('config.locations');
  return locs.filter((l) => l.kind === 'settings').map((l) => ({
    ...l,
    label: l.scope === 'user' ? 'User (~/.claude/settings.json)'
      : `${projectName(l.project)} — ${l.scope === 'local' ? 'local (settings.local.json)' : 'shared (.claude/settings.json)'}`,
  }));
}

export function scopeSelect(scopes, current, onChange) {
  const sel = h('select', { style: { minWidth: '320px' } }, scopes.map((s) => h('option', { value: s.path }, s.label + (s.exists ? '' : ' (new)'))));
  if (current) sel.value = current;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

const lastRead = new Map();
export async function loadJson(path) { const r = await api('config.read', path); lastRead.set(path, r.exists ? r.raw : ''); return r; }
export const expectedFor = (path) => lastRead.get(path);

/** Save an object as pretty JSON through the diff/backup flow. */
export async function saveJson(path, data) {
  return confirmWrite(path, JSON.stringify(data, null, 2) + '\n', { json: true, expected: lastRead.get(path) });
}

/** Renders the "file is not valid JSON" banner with a raw editor so the user can fix it. Returns true if shown. */
export function invalidJsonGuard(el, path, r, onSaved) {
  if (!r.error) return false;
  const ta = h('textarea', { rows: 20 }, r.raw);
  el.append(h('div', { class: 'banner' }, `${path} is not valid JSON (${r.error}). Fix it below; the form editor is disabled until it parses.`), ta,
    h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn primary', onclick: async () => { if (await confirmWrite(path, ta.value, { json: true, expected: lastRead.get(path) })) onSaved(); } }, 'Save')));
  return true;
}

/** Editable list of strings. Returns {el, get()} */
export function listEditor(values, { placeholder = '', mono = true, trim = true } = {}) {
  const box = h('div', { class: 'list-editor' });
  const items = [...(values || [])];
  const draw = () => {
    clear(box);
    items.forEach((v, i) => {
      const inp = h('input', { type: 'text', value: v, placeholder, class: mono ? 'mono' : '' });
      inp.addEventListener('input', () => { items[i] = inp.value; });
      box.append(h('div', { class: 'item' }, inp,
        h('button', { class: 'btn sm', title: 'Move up', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); } }, '↑'),
        h('button', { class: 'btn sm danger', title: 'Remove', onclick: () => { items.splice(i, 1); draw(); } }, '✕')));
    });
    box.append(h('button', { class: 'btn sm', style: { marginTop: '4px' }, onclick: () => { items.push(''); draw(); box.querySelectorAll('input')[items.length - 1].focus(); } }, '+ Add'));
  };
  draw();
  return { el: box, get: () => (trim ? items.map((s) => s.trim()) : items).filter((s) => s.trim() !== '') };
}

/** Key/value editor. Returns {el, get()} */
export function kvEditor(obj, { keyPh = 'KEY', valPh = 'value' } = {}) {
  const box = h('div', { class: 'list-editor' });
  const rows = Object.entries(obj || {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]);
  const draw = () => {
    clear(box);
    rows.forEach((r, i) => {
      const k = h('input', { type: 'text', value: r[0], placeholder: keyPh, class: 'mono', style: { flex: '0 0 35%' } });
      const v = h('input', { type: 'text', value: r[1], placeholder: valPh, class: 'mono' });
      k.addEventListener('input', () => { r[0] = k.value; });
      v.addEventListener('input', () => { r[1] = v.value; });
      box.append(h('div', { class: 'item' }, k, v, h('button', { class: 'btn sm danger', onclick: () => { rows.splice(i, 1); draw(); } }, '✕')));
    });
    box.append(h('button', { class: 'btn sm', style: { marginTop: '4px' }, onclick: () => { rows.push(['', '']); draw(); } }, '+ Add'));
  };
  draw();
  return { el: box, get: () => Object.fromEntries(rows.filter((r) => r[0].trim()).map((r) => [r[0].trim(), r[1]])) };
}
