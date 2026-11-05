// Tiny DOM helpers. h('div', {class:'x', onclick: fn}, child, 'text', [more])
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v; // only used with already-escaped HTML (md.render)
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const svgNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(svgNS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }
export function escapeHtml(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(msg, kind = 'info', ms = 4500) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: `toast ${kind}` }, msg);
  box.append(t);
  setTimeout(() => t.remove(), ms);
}

/** modal({title, body: Node|string, actions:[{label, value, primary, danger}]}) -> Promise<value|null> */
export function modal({ title, body, actions = [{ label: 'Close', value: null }], wide = false }) {
  return new Promise((resolve) => {
    const close = (v) => { bg.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const bg = h('div', { class: 'modal-bg', onclick: (e) => { if (e.target === bg) close(null); } },
      h('div', { class: 'modal', style: wide ? { width: 'min(1200px, 95vw)' } : null },
        h('header', null, title),
        h('div', { class: 'body' }, body),
        h('footer', null, actions.map((a) => h('button', {
          class: `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`, onclick: () => close(a.value),
        }, a.label)))));
    document.addEventListener('keydown', onKey);
    document.body.append(bg);
  });
}

export async function prompt(title, { label = '', value = '', placeholder = '' } = {}) {
  const input = h('input', { type: 'text', value, placeholder, style: { width: '100%' } });
  const body = h('div', null, label ? h('div', { class: 'secondary small', style: { marginBottom: '6px' } }, label) : null, input);
  setTimeout(() => input.focus(), 0);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') body.closest('.modal').querySelector('.btn.primary').click(); });
  const r = await modal({ title, body, actions: [{ label: 'Cancel', value: null }, { label: 'OK', value: 'ok', primary: true }] });
  return r === 'ok' ? input.value.trim() : null;
}

export async function confirm(title, message, { danger = false, okLabel = 'Confirm' } = {}) {
  return (await modal({ title, body: message, actions: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: !danger, danger }] })) === true;
}

/** Wrap an async action: shows error toast on failure. */
export async function guarded(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg, 'good'); return r; }
  catch (e) { toast(String(e && e.message ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : e), 'error', 8000); return undefined; }
}

export function debounce(fn, ms = 200) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const api = (ch, ...args) => window.api[ch](...args);
