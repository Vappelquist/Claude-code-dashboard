import { h, clear, api, debounce } from '../lib/dom.js';
import * as f from '../lib/format.js';

export async function render(el, _param, query) {
  let sessions = await api('sessions.list');
  const q = h('input', { type: 'search', placeholder: 'Filter by title, id, path…', value: query.get('q') || '', style: { width: '280px' } });
  const proj = h('select', null);
  const model = h('select', null);
  const range = h('select', null, ['all', 'today', '7d', '30d'].map((v) => h('option', { value: v }, { all: 'All time', today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days' }[v])));
  const sort = h('select', null, [['end', 'Last active'], ['cost', 'Est. cost'], ['tokens', 'Tokens'], ['prompts', 'Prompts']].map(([v, l]) => h('option', { value: v }, `Sort: ${l}`)));
  const tableBox = h('div');
  const summary = h('div', { class: 'muted small' });

  const fillSelects = () => {
    const projects = [...new Set(sessions.map((s) => s.cwd).filter(Boolean))].sort();
    const models = [...new Set(sessions.flatMap((s) => Object.keys(s.models)))].sort();
    const pv = proj.value || query.get('project') || '', mv = model.value;
    clear(proj).append(h('option', { value: '' }, 'All projects'), projects.map((p) => h('option', { value: p }, f.projectName(p))));
    clear(model).append(h('option', { value: '' }, 'All models'), models.map((m) => h('option', { value: m }, f.shortModel(m))));
    proj.value = pv; model.value = mv;
  };

  const draw = () => {
    const text = q.value.trim().toLowerCase();
    const now = Date.now();
    const since = { all: 0, today: new Date().setHours(0, 0, 0, 0), '7d': now - 7 * 864e5, '30d': now - 30 * 864e5 }[range.value];
    let rows = sessions.filter((s) =>
      (!text || [s.title, s.id, s.cwd, s.gitBranch].some((x) => String(x || '').toLowerCase().includes(text)))
      && (!proj.value || s.cwd === proj.value)
      && (!model.value || s.models[model.value])
      && (!since || (s.end || 0) >= since));
    const key = { end: (s) => s.end || 0, cost: (s) => s.costUsd, tokens: (s) => f.totalTokens(s.tokens), prompts: (s) => s.userMsgs }[sort.value];
    rows = rows.sort((a, b) => key(b) - key(a));
    const tot = rows.reduce((a, s) => ({ t: a.t + f.totalTokens(s.tokens), c: a.c + s.costUsd }), { t: 0, c: 0 });
    summary.textContent = `${rows.length} session${rows.length === 1 ? '' : 's'} · ${f.tokens(tot.t)} tokens · ${f.usd(tot.c)} est.`;
    clear(tableBox);
    if (!rows.length) { tableBox.append(h('div', { class: 'empty' }, 'No sessions match these filters')); return; }
    tableBox.append(h('table', { class: 'tbl' },
      h('tr', null, h('th', null, 'Session'), h('th', null, 'Project'), h('th', null, 'Branch'), h('th', null, 'Models'),
        h('th', { class: 'num' }, 'Prompts'), h('th', { class: 'num' }, 'Tools'), h('th', { class: 'num' }, 'Tokens'), h('th', { class: 'num' }, 'Est. cost'), h('th', { class: 'num' }, 'Duration'), h('th', { class: 'num' }, 'Last active')),
      rows.slice(0, 500).map((s) => h('tr', { class: 'click', onclick: () => { location.hash = `#/session/${s.id}`; } },
        h('td', { style: { maxWidth: '420px' } }, s.title || h('span', { class: 'muted' }, '(no prompt)'), h('div', { class: 'muted small mono' }, s.id.slice(0, 8))),
        h('td', { class: 'secondary', title: s.cwd || '' }, f.projectName(s.cwd)),
        h('td', null, s.gitBranch ? h('span', { class: 'pill' }, s.gitBranch) : '—'),
        h('td', null, Object.keys(s.models).map((m) => h('span', { class: 'pill', style: { marginRight: '4px' } }, f.shortModel(m)))),
        h('td', { class: 'num' }, f.int(s.userMsgs)),
        h('td', { class: 'num' }, f.int(Object.values(s.tools).reduce((a, b) => a + b, 0)), s.toolErrors ? h('span', { class: 'err small' }, ` (${s.toolErrors}✕)`) : null),
        h('td', { class: 'num' }, f.tokens(f.totalTokens(s.tokens))),
        h('td', { class: 'num' }, f.usd(s.costUsd), s.unknownModel ? h('span', { class: 'muted', title: 'Contains a model without a price' }, '*') : null),
        h('td', { class: 'num muted' }, f.duration((s.end || 0) - (s.start || 0))),
        h('td', { class: 'num muted' }, f.ago(s.end))))));
    if (rows.length > 500) tableBox.append(h('div', { class: 'muted small', style: { padding: '8px' } }, `Showing 500 of ${rows.length}. Narrow the filters to see more.`));
  };

  fillSelects();
  for (const c of [proj, model, range, sort]) c.addEventListener('change', draw);
  q.addEventListener('input', debounce(draw, 150));
  el.append(h('h1', null, 'Sessions'), h('p', { class: 'sub' }, 'Every Claude Code conversation stored in ~/.claude/projects.'),
    h('div', { class: 'row', style: { marginBottom: '12px' } }, q, proj, model, range, sort, h('div', { class: 'grow' }), summary),
    h('div', { class: 'card', style: { padding: '4px 8px' } }, tableBox));
  draw();
  const off = window.api.on('transcripts-changed', async () => { sessions = await api('sessions.list'); fillSelects(); draw(); });
  return off;
}
