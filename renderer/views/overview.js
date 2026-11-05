import { h, clear, api } from '../lib/dom.js';
import * as f from '../lib/format.js';
import { stackedBars, heatmap, donut, modelColor } from '../lib/charts.js';

function kpi(label, st, extra) {
  return h('div', { class: 'card kpi' },
    h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, f.tokens(st.tokens.total), h('span', { class: 'muted', style: { fontSize: '13px', fontWeight: 400 } }, ' tokens')),
    h('div', { class: 'kpi-row' },
      h('div', null, h('div', { class: 'k' }, 'Sessions'), h('div', { class: 'v' }, f.int(st.sessions))),
      h('div', null, h('div', { class: 'k' }, 'Prompts'), h('div', { class: 'v' }, f.int(st.prompts))),
      h('div', null, h('div', { class: 'k' }, 'Output'), h('div', { class: 'v' }, f.tokens(st.tokens.output))),
      h('div', null, h('div', { class: 'k' }, 'Est. cost'), h('div', { class: 'v' }, f.usd(st.costUsd)))),
    extra || null);
}

function last30(byDay) {
  const map = new Map(byDay.map((d) => [d.date, d]));
  const out = [];
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 29);
  for (let i = 0; i < 30; i++) {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    out.push(map.get(k) || { date: k, tokens: 0, byModel: {}, costUsd: 0 });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export async function render(el) {
  const draw = async () => {
    const [today, w, m, all, live] = await Promise.all([
      api('stats.get', 'today'), api('stats.get', '7d'), api('stats.get', '30d'), api('stats.get', 'all'), api('sessions.live'),
    ]);
    clear(el);
    el.append(
      h('h1', null, 'Overview'),
      h('p', { class: 'sub' }, 'Usage across all Claude Code sessions on this machine. Costs are API-equivalent estimates, not your bill.'),
      h('div', { class: 'grid cols-4' }, kpi('Today', today), kpi('Last 7 days', w), kpi('Last 30 days', m), kpi('All time', all)),
    );

    const row2 = h('div', { class: 'grid cols-4', style: { marginTop: '14px' } },
      h('div', { class: 'card kpi' }, h('div', { class: 'label' }, 'Cache hit rate (all time)'),
        h('div', { class: 'value' }, f.pct(all.cacheHitRate)),
        h('div', { class: 'meta' }, `${f.tokens(all.tokens.cacheRead)} read from cache · ${f.tokens(all.tokens.cacheWrite)} written`)),
      h('div', { class: 'card kpi' }, h('div', { class: 'label' }, 'Current streak'),
        h('div', { class: 'value' }, `${all.streakDays} day${all.streakDays === 1 ? '' : 's'}`),
        h('div', { class: 'meta' }, `${all.byDay.length} active days total`)),
      h('div', { class: 'card kpi' }, h('div', { class: 'label' }, 'Projects'),
        h('div', { class: 'value' }, f.int(all.byProject.length)),
        h('div', { class: 'meta' }, all.byProject[0] ? `Latest: ${f.projectName(all.byProject[0].cwd)}` : '—')),
      h('div', { class: 'card kpi' }, h('div', { class: 'label' }, 'Running now'),
        h('div', { class: 'value' }, String(live.length)),
        h('div', { class: 'meta' }, live.length ? live.slice(0, 3).map((l) => `${f.projectName(l.cwd)} (${l.status || l.kind || 'active'})`).join(' · ') : 'No live Claude Code processes')),
    );
    el.append(row2);

    const barsEl = h('div');
    const models = Object.keys(m.byModel).sort((a, b) => (m.byModel[b].tokens || 0) - (m.byModel[a].tokens || 0));
    el.append(h('div', { class: 'grid cols-3', style: { marginTop: '14px' } },
      h('div', { class: 'card span-2' }, h('h2', null, 'Tokens per day by model · last 30 days'), barsEl),
      (() => {
        const dEl = h('div');
        const items = Object.entries(all.byModel).filter(([, v]) => v.tokens > 0)
          .sort((a, b) => b[1].tokens - a[1].tokens)
          .map(([k, v]) => ({ label: f.shortModel(k), value: v.tokens, color: modelColor(k) }));
        queueMicrotask(() => donut(dEl, { items, centerLabel: 'tokens, all time' }));
        return h('div', { class: 'card' }, h('h2', null, 'Model split'), dEl);
      })()));
    requestAnimationFrame(() => stackedBars(barsEl, { days: last30(m.byDay), keys: models }));

    const heatEl = h('div');
    el.append(h('div', { class: 'card', style: { marginTop: '14px', overflowX: 'auto' } }, h('h2', null, 'Activity · last 12 months'), heatEl));
    heatmap(heatEl, { byDay: all.byDay });

    const recent = (await api('sessions.list')).slice(0, 8);
    el.append(h('div', { class: 'card', style: { marginTop: '14px' } },
      h('div', { class: 'row' }, h('h2', { class: 'grow' }, 'Recent sessions'), h('a', { href: '#/sessions', class: 'small' }, 'All sessions →')),
      recent.length ? h('table', { class: 'tbl' },
        h('tr', null, h('th', null, 'Session'), h('th', null, 'Project'), h('th', { class: 'num' }, 'Tokens'), h('th', { class: 'num' }, 'Est. cost'), h('th', { class: 'num' }, 'Last active')),
        recent.map((s) => h('tr', { class: 'click', onclick: () => { location.hash = `#/session/${s.id}`; } },
          h('td', null, s.title || h('span', { class: 'muted' }, s.id)),
          h('td', { class: 'secondary' }, f.projectName(s.cwd)),
          h('td', { class: 'num' }, f.tokens(f.totalTokens(s.tokens))),
          h('td', { class: 'num' }, f.usd(s.costUsd)),
          h('td', { class: 'num muted' }, f.ago(s.end))))) : h('div', { class: 'empty' }, 'No sessions found in ~/.claude/projects')));
  };
  await draw();
  const off = window.api.on('transcripts-changed', () => { draw(); });
  const onResize = () => draw();
  let t; const rs = () => { clearTimeout(t); t = setTimeout(onResize, 250); };
  window.addEventListener('resize', rs);
  return () => { off(); window.removeEventListener('resize', rs); };
}
