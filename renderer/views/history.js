import { h, clear, api, debounce, guarded } from '../lib/dom.js';
import * as f from '../lib/format.js';

export async function render(el, _p, query) {
  const q = h('input', { type: 'search', placeholder: 'Search everything you have typed…', value: query.get('q') || '', style: { width: '420px' } });
  const count = h('span', { class: 'muted small' });
  const list = h('div', { class: 'card', style: { padding: '4px 8px' } });
  el.append(h('h1', null, 'Prompt History'), h('p', { class: 'sub' }, 'From ~/.claude/history.jsonl — every prompt across all projects.'),
    h('div', { class: 'row', style: { marginBottom: '12px' } }, q, count), list);
  const draw = async () => {
    const items = await api('history.list', q.value);
    count.textContent = `${items.length}${items.length === 2000 ? '+' : ''} prompt${items.length === 1 ? '' : 's'}`;
    clear(list);
    if (!items.length) { list.append(h('div', { class: 'empty' }, 'No prompts found')); return; }
    list.append(h('table', { class: 'tbl' }, items.slice(0, 500).map((p) => h('tr', null,
      h('td', { style: { width: '100%' } }, h('div', { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '9em', overflow: 'hidden' } }, p.text),
        h('div', { class: 'muted small' }, f.projectName(p.project), ' · ', f.datetime(p.timestamp))),
      h('td', { style: { whiteSpace: 'nowrap' } },
        h('button', { class: 'btn sm', onclick: () => guarded(() => api('clipboard.write', p.text), 'Copied') }, 'Copy'), ' ',
        h('a', { class: 'btn sm', href: `#/run?prompt=${encodeURIComponent(p.text)}&cwd=${encodeURIComponent(p.project || '')}` }, 'Run again'), ' ',
        p.sessionId ? h('a', { class: 'btn sm', href: `#/session/${p.sessionId}` }, 'Session') : null)))));
  };
  q.addEventListener('input', debounce(draw, 200));
  await draw();
  q.focus();
}
