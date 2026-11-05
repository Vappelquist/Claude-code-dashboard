import { h, clear, api } from '../lib/dom.js';
import * as f from '../lib/format.js';
import { hbars, modelColor } from '../lib/charts.js';

export async function render(el) {
  const range = h('select', null, [['all', 'All time'], ['30d', 'Last 30 days'], ['7d', 'Last 7 days'], ['today', 'Today']].map(([v, l]) => h('option', { value: v }, l)));
  const body = h('div');
  el.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h1', null, 'Tools & Models'),
    h('p', { class: 'sub' }, 'What Claude actually does in your sessions.')), range), body);

  const draw = async () => {
    const st = await api('stats.get', range.value);
    clear(body);
    const tools = Object.entries(st.byTool).sort((a, b) => b[1].count - a[1].count);
    const totalCalls = tools.reduce((a, [, v]) => a + v.count, 0);
    const totalErr = tools.reduce((a, [, v]) => a + v.errors, 0);
    const toolsEl = h('div');
    hbars(toolsEl, { rows: tools.slice(0, 25).map(([k, v]) => ({ label: k, value: v.count, err: v.errors })), fmt: f.int });

    const bashEl = h('div');
    hbars(bashEl, { rows: st.topBash.map((b) => ({ label: b.cmd, value: b.count })), fmt: f.int });
    const filesEl = h('div');
    hbars(filesEl, { rows: st.topFiles.map((b) => ({ label: b.path, value: b.count })), fmt: f.int });

    const models = Object.entries(st.byModel).sort((a, b) => b[1].tokens - a[1].tokens);
    const mcp = Object.entries(st.mcpTools).sort((a, b) => b[1] - a[1]);

    body.append(
      h('div', { class: 'grid cols-4', style: { marginBottom: '14px' } },
        h('div', { class: 'card kpi' }, h('div', { class: 'label' }, 'Tool calls'), h('div', { class: 'value' }, f.int(totalCalls))),
        h('div', { class: 'card kpi' }, h('div', { class: 'label' }, 'Tool errors'), h('div', { class: 'value' }, f.int(totalErr)),
          h('div', { class: 'meta' }, totalCalls ? `${f.pct(totalErr / totalCalls)} of calls` : '—')),
        h('div', { class: 'card kpi' }, h('div', { class: 'label' }, 'Distinct tools'), h('div', { class: 'value' }, f.int(tools.length))),
        h('div', { class: 'card kpi' }, h('div', { class: 'label' }, 'MCP tool calls'), h('div', { class: 'value' }, f.int(mcp.reduce((a, [, v]) => a + v, 0))))),
      h('div', { class: 'grid cols-2' },
        h('div', { class: 'card' }, h('h2', null, 'Tool usage'), h('div', { class: 'muted small', style: { marginBottom: '6px' } }, 'Bar = calls · red line = errors'), toolsEl),
        h('div', { class: 'card' }, h('h2', null, 'Models'),
          models.length ? h('table', { class: 'tbl' },
            h('tr', null, h('th', null, 'Model'), h('th', { class: 'num' }, 'Responses'), h('th', { class: 'num' }, 'Tokens'), h('th', { class: 'num' }, 'Est. cost')),
            models.map(([m, v]) => h('tr', null,
              h('td', null, h('span', { class: 'dot', style: { background: modelColor(m) } }), f.shortModel(m)),
              h('td', { class: 'num' }, f.int(v.messages)), h('td', { class: 'num' }, f.tokens(v.tokens)), h('td', { class: 'num' }, f.usd(v.costUsd))))) : h('div', { class: 'empty' }, 'No data'),
          h('h2', { style: { marginTop: '18px' } }, 'MCP tools'),
          mcp.length ? h('table', { class: 'tbl' }, h('tr', null, h('th', null, 'Server'), h('th', null, 'Tool'), h('th', { class: 'num' }, 'Calls')),
            mcp.map(([k, v]) => { const [, server, ...tool] = k.split('__'); return h('tr', null, h('td', null, server), h('td', { class: 'mono small' }, tool.join('__')), h('td', { class: 'num' }, f.int(v))); }))
            : h('div', { class: 'muted small' }, 'No MCP tools used in this range.')),
        h('div', { class: 'card' }, h('h2', null, 'Top Bash commands'), bashEl),
        h('div', { class: 'card' }, h('h2', null, 'Most edited files'), filesEl)));
  };
  range.addEventListener('change', draw);
  await draw();
}
