import { h, clear, api, toast, guarded } from '../lib/dom.js';
import * as f from '../lib/format.js';
import { render as md } from '../lib/md.js';

// Run state lives at module level so runs survive navigating to other pages.
const tabs = []; // { id, title, cwd, model, mode, sessionId, turns:[{prompt, runId, events:[], status, stderr, result}], usage }
let activeTab = null;
let seq = 0;
let rerender = null;
const byRunId = new Map();

window.api.on('runner-event', (ev) => {
  const ref = byRunId.get(ev.runId);
  if (!ref) return;
  const { tab, turn } = ref;
  if (ev.type === 'event') {
    const d = ev.data;
    turn.events.push(d);
    if (d.type === 'system' && d.subtype === 'init') { tab.sessionId = d.session_id; turn.model = d.model; }
    if (d.type === 'assistant' && d.message && d.message.usage) addUsage(tab, d.message.usage, d.message.id);
    if (d.type === 'result') { turn.result = d; if (d.session_id) tab.sessionId = d.session_id; }
  } else if (ev.type === 'stderr') turn.stderr += ev.text;
  else if (ev.type === 'exit' || ev.type === 'error') {
    turn.status = ev.type === 'error' ? 'error' : ev.code === 0 ? 'done' : 'failed';
    if (ev.type === 'error') turn.stderr += `\n${ev.message}`;
    if (ev.type === 'exit' && ev.code !== 0 && ev.code !== -1) turn.stderr += `\n(exit code ${ev.code})`;
    byRunId.delete(ev.runId);
  }
  if (rerender) rerender(tab, turn);
});

function addUsage(tab, u, id) {
  tab.seenMsg = tab.seenMsg || new Set();
  if (id && tab.seenMsg.has(id)) return;
  if (id) tab.seenMsg.add(id);
  tab.usage.input += u.input_tokens || 0;
  tab.usage.output += u.output_tokens || 0;
  tab.usage.cacheRead += u.cache_read_input_tokens || 0;
  tab.usage.cacheWrite += u.cache_creation_input_tokens || 0;
}

function newTab(opts = {}) {
  const t = { id: ++seq, title: `Run ${seq}`, cwd: opts.cwd || '', model: opts.model || '', mode: opts.mode || 'default',
    sessionId: opts.resume || null, resumedFrom: opts.resume || null, turns: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, draft: opts.prompt || '' };
  tabs.push(t);
  activeTab = t.id;
  return t;
}

function eventNodes(d, toolResults) {
  if (d.type === 'assistant' && d.message && Array.isArray(d.message.content)) {
    return d.message.content.map((b) => {
      if (b.type === 'text' && b.text) return h('div', { class: 'msg' }, h('div', { class: 'who' }, 'Claude'), h('div', { class: 'md', html: md(b.text) }));
      if (b.type === 'thinking' && b.thinking) return h('details', { class: 'tool thinking' }, h('summary', null, '💭 Thinking'), h('div', { class: 'tbody' }, h('pre', { class: 'secondary' }, b.thinking)));
      if (b.type === 'tool_use') {
        const r = toolResults.get(b.id);
        const inp = b.input || {};
        const sum = inp.command || inp.file_path || inp.pattern || inp.url || inp.description || '';
        const resText = r ? (typeof r.content === 'string' ? r.content : Array.isArray(r.content) ? r.content.map((c) => c.text || `[${c.type}]`).join('\n') : JSON.stringify(r.content)) : null;
        return h('details', { class: `tool ${r && r.is_error ? 'error' : ''}` },
          h('summary', null, h('span', { class: `pill ${r && r.is_error ? 'bad' : 'accent'}` }, b.name),
            h('span', { class: 'mono secondary', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, String(sum).split('\n')[0].slice(0, 150)),
            r ? null : h('span', { class: 'spinner' })),
          h('div', { class: 'tbody' }, h('pre', { class: 'mono' }, JSON.stringify(inp, null, 2)),
            resText != null ? h('pre', { class: 'mono secondary', style: { maxHeight: '320px', overflow: 'auto' } }, resText.slice(0, 20000)) : null));
      }
      return null;
    });
  }
  if (d.type === 'system' && d.subtype === 'init') {
    return [h('div', { class: 'muted small' }, `Session ${d.session_id || ''} · ${f.shortModel(d.model)} · ${(d.tools || []).length} tools · ${d.permissionMode || ''}`)];
  }
  return [];
}

function turnNode(tab, turn) {
  const box = h('div', { class: 'conv', 'data-turn': turn.runId || '' });
  box.append(h('div', { class: 'msg user' }, h('div', { class: 'who' }, 'You'), h('div', { class: 'md', html: md(turn.prompt) })));
  const toolResults = new Map();
  for (const d of turn.events) if (d.type === 'user' && d.message && Array.isArray(d.message.content)) {
    for (const b of d.message.content) if (b.type === 'tool_result') toolResults.set(b.tool_use_id, b);
  }
  for (const d of turn.events) for (const n of eventNodes(d, toolResults)) if (n) box.append(n);
  if (turn.status === 'running') box.append(h('div', { class: 'muted small row' }, h('span', { class: 'spinner' }), 'Claude is working…'));
  if (turn.result) {
    const r = turn.result;
    box.append(h('div', { class: `small ${r.is_error ? 'err' : 'muted'}`, style: { textAlign: 'right' } },
      `${r.subtype || 'done'} · ${r.num_turns || 0} turns · ${f.duration(r.duration_ms)}`, r.total_cost_usd != null ? ` · ${f.usd(r.total_cost_usd)} (reported)` : ''));
  }
  if (turn.stderr.trim()) {
    box.append(h('details', { class: 'tool error', open: turn.status !== 'running' && turn.status !== 'done' },
      h('summary', null, h('span', { class: 'pill bad' }, 'stderr')), h('div', { class: 'tbody' }, h('pre', { class: 'mono' }, turn.stderr.trim()))));
  }
  return box;
}

export async function render(el, _p, query) {
  if (query.get('resume') || query.get('prompt') || query.get('cwd') || !tabs.length) {
    const existing = query.get('resume') && tabs.find((t) => t.sessionId === query.get('resume'));
    if (existing) activeTab = existing.id;
    else newTab({ resume: query.get('resume'), cwd: query.get('cwd'), prompt: query.get('prompt') });
    if (location.hash.includes('?')) history.replaceState(null, '', '#/run');
  }
  const [projects, version] = await Promise.all([api('projects.known'), api('runner.version')]);
  const tabBar = h('div', { class: 'tabs' });
  const area = h('div');
  el.append(h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h1', null, 'Command Center'),
    h('p', { class: 'sub' }, version ? `Runs ${version} headless (claude -p) and streams the result. Use "Open in terminal" for the full interactive UI.` : '')),
  ), tabBar, area);
  if (!version) {
    area.append(h('div', { class: 'banner' }, 'The claude command was not found on PATH. Install it with ', h('code', null, 'npm install -g @anthropic-ai/claude-code'), ' and restart the dashboard.'));
  }

  let streamEl = null, meterEl = null, sendBtn = null, stopBtn = null;
  const drawTabs = () => {
    clear(tabBar);
    for (const t of tabs) {
      const running = t.turns.some((x) => x.status === 'running');
      tabBar.append(h('button', { class: t.id === activeTab ? 'active' : '', onclick: () => { activeTab = t.id; drawTabs(); drawArea(); } },
        running ? h('span', { class: 'spinner', style: { marginRight: '6px' } }) : null, t.title,
        tabs.length > 1 ? h('span', { class: 'muted', style: { marginLeft: '8px' }, title: 'Close', onclick: (e) => {
          e.stopPropagation();
          if (running) { toast('Stop the run before closing this tab'); return; }
          tabs.splice(tabs.indexOf(t), 1);
          if (activeTab === t.id) activeTab = tabs[tabs.length - 1].id;
          drawTabs(); drawArea();
        } }, '×') : null));
    }
    tabBar.append(h('button', { onclick: () => { newTab(); drawTabs(); drawArea(); } }, '+ New'));
  };

  const meterText = (t) => {
    const lastResult = [...t.turns].reverse().find((x) => x.result);
    const cost = t.turns.reduce((a, x) => a + ((x.result && x.result.total_cost_usd) || 0), 0);
    return [
      h('span', null, 'Session ', h('b', { class: 'mono' }, t.sessionId ? t.sessionId.slice(0, 8) : '—')),
      h('span', null, 'In ', h('b', null, f.tokens(t.usage.input))), h('span', null, 'Out ', h('b', null, f.tokens(t.usage.output))),
      h('span', null, 'Cache ', h('b', null, f.tokens(t.usage.cacheRead + t.usage.cacheWrite))),
      h('span', null, 'Cost ', h('b', null, f.usd(cost)), h('span', { class: 'muted' }, ' (as reported by claude)')),
      lastResult ? h('span', { class: 'muted' }, `last: ${f.duration(lastResult.result.duration_ms)}`) : null,
    ];
  };

  const drawArea = () => {
    clear(area);
    const t = tabs.find((x) => x.id === activeTab);
    if (!t) return;
    const cwd = h('select', { style: { maxWidth: '320px' } }, h('option', { value: '' }, '(choose working folder)'),
      [...new Set([t.cwd, ...projects].filter(Boolean))].map((p) => h('option', { value: p }, p)));
    cwd.value = t.cwd;
    cwd.addEventListener('change', () => { t.cwd = cwd.value; });
    const browse = h('button', { class: 'btn', onclick: async () => { const p = await api('dialog.pickFolder'); if (p) { t.cwd = p; drawArea(); } } }, 'Browse…');
    const model = h('select', null, [['', 'Model: default'], ['claude-opus-5-5', 'Opus 5.5'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-haiku-5-5', 'Haiku 5.5'], ['claude-fable-5-1', 'Fable 5.1']]
      .map(([v, l]) => h('option', { value: v }, l)));
    model.value = t.model;
    model.addEventListener('change', () => { t.model = model.value; });
    const mode = h('select', { title: 'In headless mode, tools that would need approval are refused unless the mode allows them.' },
      [['default', 'Permissions: default'], ['acceptEdits', 'acceptEdits'], ['plan', 'plan (read-only)'], ['auto', 'auto'], ['bypassPermissions', 'bypassPermissions ⚠']].map(([v, l]) => h('option', { value: v }, l)));
    mode.value = t.mode;
    mode.addEventListener('change', () => { t.mode = mode.value; });
    const locked = t.turns.length > 0;
    cwd.disabled = locked; browse.disabled = locked;

    streamEl = h('div', { class: 'run-stream' });
    meterEl = h('div', { class: 'meter' }, meterText(t));
    const input = h('textarea', { rows: 3, placeholder: t.sessionId ? 'Follow-up (continues this session)…  Ctrl+Enter to send' : 'Ask Claude to do something in this folder…  Ctrl+Enter to send' }, t.draft);
    input.addEventListener('input', () => { t.draft = input.value; });
    const running = () => t.turns.some((x) => x.status === 'running');
    const send = async () => {
      const prompt = input.value.trim();
      if (!prompt || running()) return;
      if (!t.cwd) { toast('Choose a working folder first', 'error'); return; }
      const turn = { prompt, events: [], status: 'running', stderr: '', result: null, runId: null };
      t.turns.push(turn);
      if (t.turns.length === 1) t.title = f.projectName(t.cwd) + ': ' + prompt.slice(0, 24);
      t.draft = ''; input.value = '';
      const runId = await guarded(() => api('runner.start', { prompt, cwd: t.cwd, model: t.model || undefined, permissionMode: t.mode, resume: t.sessionId || undefined }));
      if (!runId) { turn.status = 'error'; turn.stderr = 'Failed to start'; drawArea(); return; }
      turn.runId = runId;
      byRunId.set(runId, { tab: t, turn });
      drawTabs(); drawArea();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
    sendBtn = h('button', { class: 'btn primary', onclick: send, disabled: running() || !version }, t.sessionId ? 'Send follow-up' : 'Run');
    stopBtn = h('button', { class: 'btn danger', disabled: !running(), onclick: () => { const r = t.turns.find((x) => x.status === 'running'); if (r && r.runId) api('runner.stop', r.runId); } }, 'Stop');

    area.append(h('div', { class: 'run-layout' },
      h('div', null,
        h('div', { class: 'row', style: { marginBottom: '8px' } }, cwd, browse, model, mode, h('div', { class: 'grow' }),
          h('button', { class: 'btn', disabled: !t.cwd, onclick: () => guarded(() => api('terminal.open', { cwd: t.cwd, resume: t.sessionId || undefined }), 'Opening terminal…') }, 'Open in terminal'),
          t.sessionId ? h('a', { class: 'btn', href: `#/session/${t.sessionId}` }, 'Transcript') : null),
        t.resumedFrom && !t.turns.length ? h('div', { class: 'banner info' }, `Resuming session ${t.resumedFrom}. Your next message continues that conversation.`) : null,
        meterEl),
      streamEl,
      h('div', { class: 'run-input' }, input, h('div', { class: 'row', style: { marginTop: '6px' } }, sendBtn, stopBtn,
        h('span', { class: 'muted small' }, 'Headless runs cannot answer permission prompts. Pick a permission mode that allows what you need.')))));
    for (const turn of t.turns) streamEl.append(turnNode(t, turn));
    if (!t.turns.length) streamEl.append(h('div', { class: 'empty' }, version ? 'Nothing run yet in this tab.' : ''));
    streamEl.scrollTop = streamEl.scrollHeight;
    input.focus();
  };

  rerender = (tab, turn) => {
    if (tab.id !== activeTab || !streamEl || !streamEl.isConnected) { drawTabs(); return; }
    const atBottom = streamEl.scrollHeight - streamEl.scrollTop - streamEl.clientHeight < 80;
    const old = streamEl.querySelector(`[data-turn="${turn.runId}"]`);
    const node = turnNode(tab, turn);
    if (old) old.replaceWith(node); else streamEl.append(node);
    clear(meterEl).append(...meterText(tab).filter(Boolean));
    if (turn.status !== 'running') { drawTabs(); sendBtn.disabled = false; stopBtn.disabled = true; sendBtn.textContent = 'Send follow-up'; }
    if (atBottom) streamEl.scrollTop = streamEl.scrollHeight;
  };
  drawTabs();
  drawArea();
  return () => { rerender = null; };
}
