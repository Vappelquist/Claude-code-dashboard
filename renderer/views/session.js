import { h, clear, api, toast, guarded } from '../lib/dom.js';
import * as f from '../lib/format.js';
import { render as md } from '../lib/md.js';
import { costOfClient } from '../lib/cost.js';

const MAX_RESULT = 4000;

function resultText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (b && b.type === 'text' ? b.text : b && b.type === 'image' ? '[image]' : JSON.stringify(b))).join('\n');
  return JSON.stringify(c, null, 2);
}

function clipBlock(text) {
  const pre = h('pre', { class: 'mono' }, text.length > MAX_RESULT ? text.slice(0, MAX_RESULT) : text);
  if (text.length <= MAX_RESULT) return pre;
  const more = h('button', { class: 'btn sm', onclick: () => { pre.textContent = text; more.remove(); } }, `Show all (${f.int(text.length)} chars)`);
  return h('div', null, pre, more);
}

function toolSummary(b) {
  const i = b.input || {};
  return i.command || i.file_path || i.pattern || i.url || i.query || i.description || i.prompt || i.skill || '';
}

/** Turn raw transcript entries into display items (deduping repeated assistant lines). */
export function buildItems(entries) {
  const results = new Map();
  for (const e of entries) {
    const c = e.type === 'user' && e.message && Array.isArray(e.message.content) ? e.message.content : [];
    for (const b of c) if (b && b.type === 'tool_result') results.set(b.tool_use_id, b);
  }
  const items = [];
  const seenBlocks = new Set();
  const usageSeen = new Set();
  for (const e of entries) {
    const side = !!e.isSidechain;
    if (e.type === 'user' && e.message) {
      const c = e.message.content;
      if (e.isMeta) continue;
      if (typeof c === 'string' || (Array.isArray(c) && c.some((b) => b && b.type === 'text'))) {
        const text = typeof c === 'string' ? c : c.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        if (/^\s*<(local-command-caveat|system-reminder)/.test(text)) continue;
        items.push({ kind: 'user', text, ts: e.timestamp, side, compact: !!e.isCompactSummary });
      }
    } else if (e.type === 'assistant' && e.message && Array.isArray(e.message.content)) {
      const m = e.message;
      for (const b of m.content) {
        if (!b) continue;
        const key = `${m.id}:${b.type}:${b.id || b.text || b.thinking || ''}`.slice(0, 300);
        if (seenBlocks.has(key)) continue;
        seenBlocks.add(key);
        if (b.type === 'text' && b.text) items.push({ kind: 'text', text: b.text, ts: e.timestamp, side, model: m.model });
        else if (b.type === 'thinking' && b.thinking) items.push({ kind: 'thinking', text: b.thinking, ts: e.timestamp, side });
        else if (b.type === 'tool_use') items.push({ kind: 'tool', block: b, result: results.get(b.id), ts: e.timestamp, side });
      }
      if (m.usage && m.id && !usageSeen.has(m.id)) {
        usageSeen.add(m.id);
        items.push({ kind: 'usage', usage: m.usage, model: m.model, side });
      }
    } else if (e.type === 'system' && e.subtype === 'compact_boundary') {
      items.push({ kind: 'marker', text: 'Conversation compacted', ts: e.timestamp });
    }
  }
  return items;
}

function itemNode(it) {
  const sideTag = it.side ? h('span', { class: 'pill' }, 'subagent') : null;
  if (it.kind === 'user') {
    return h('div', { class: `msg user ${it.side ? 'side' : ''}` },
      h('div', { class: 'who' }, it.compact ? 'Compaction summary' : 'You', sideTag, h('span', null, f.datetime(Date.parse(it.ts)))),
      h('div', { class: 'md', html: md(it.text) }));
  }
  if (it.kind === 'text') {
    return h('div', { class: `msg ${it.side ? 'side' : ''}` },
      h('div', { class: 'who' }, 'Claude', sideTag, it.model ? h('span', { class: 'pill' }, f.shortModel(it.model)) : null),
      h('div', { class: 'md', html: md(it.text) }));
  }
  if (it.kind === 'thinking') {
    return h('details', { class: `tool thinking ${it.side ? 'msg side' : ''}` }, h('summary', null, '💭 Thinking', sideTag),
      h('div', { class: 'tbody' }, h('pre', { class: 'secondary' }, it.text)));
  }
  if (it.kind === 'tool') {
    const b = it.block, r = it.result;
    const isErr = r && r.is_error;
    return h('details', { class: `tool ${isErr ? 'error' : ''}`, style: it.side ? { marginLeft: '28px' } : null },
      h('summary', null, h('span', { class: `pill ${isErr ? 'bad' : 'accent'}` }, b.name), sideTag,
        h('span', { class: 'mono secondary', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, String(toolSummary(b)).split('\n')[0].slice(0, 160)),
        !r ? h('span', { class: 'muted small' }, '(no result)') : null),
      h('div', { class: 'tbody' },
        h('div', { class: 'muted small' }, 'Input'), h('pre', { class: 'mono' }, JSON.stringify(b.input, null, 2)),
        r ? h('div', { class: 'muted small' }, isErr ? 'Result (error)' : 'Result') : null,
        r ? clipBlock(resultText(r.content)) : null));
  }
  if (it.kind === 'usage') {
    const u = it.usage;
    return h('div', { class: 'chip', style: { textAlign: 'right', marginTop: '-6px', marginLeft: it.side ? '28px' : 0 } },
      `in ${f.tokens(u.input_tokens)} · out ${f.tokens(u.output_tokens)} · cache read ${f.tokens(u.cache_read_input_tokens)} · write ${f.tokens(u.cache_creation_input_tokens)}`,
      it.cost != null ? ` · ${f.usd(it.cost)}` : '');
  }
  if (it.kind === 'marker') return h('div', { class: 'muted small', style: { textAlign: 'center', padding: '6px' } }, `— ${it.text} —`);
  return null;
}

export async function render(el, id) {
  const s = await api('sessions.get', id);
  if (!s) { el.append(h('h1', null, 'Session not found'), h('p', { class: 'muted' }, id)); return; }
  const pricing = await api('pricing.get');
  const items = buildItems(s.entries);
  for (const it of items) if (it.kind === 'usage') it.cost = costOfClient(it.model, it.usage, pricing);

  const showSide = h('input', { type: 'checkbox', checked: true });
  const showThinking = h('input', { type: 'checkbox', checked: true });
  const showUsage = h('input', { type: 'checkbox', checked: false });
  const conv = h('div', { class: 'conv' });
  let shown = 0;
  const PAGE = 200;
  const visible = () => items.filter((it) => (showSide.checked || !it.side) && (showThinking.checked || it.kind !== 'thinking') && (showUsage.checked || it.kind !== 'usage'));
  const moreBtn = h('button', { class: 'btn', style: { margin: '12px auto', display: 'block' } }, 'Load more');
  const drawMore = () => {
    const v = visible();
    v.slice(shown, shown + PAGE).forEach((it) => { const n = itemNode(it); if (n) conv.append(n); });
    shown = Math.min(v.length, shown + PAGE);
    moreBtn.style.display = shown < v.length ? 'block' : 'none';
    moreBtn.textContent = `Load more (${v.length - shown} remaining)`;
  };
  const redraw = () => { clear(conv); shown = 0; drawMore(); };
  moreBtn.onclick = drawMore;
  for (const c of [showSide, showThinking, showUsage]) c.addEventListener('change', redraw);

  const resume = () => { location.hash = `#/run?resume=${encodeURIComponent(s.id)}&cwd=${encodeURIComponent(s.cwd || '')}`; };
  const term = () => guarded(() => api('terminal.open', { cwd: s.cwd, resume: s.id }), 'Opening terminal…');
  const exportMd = async () => {
    const mdText = await api('sessions.exportMarkdown', s.id);
    const p = await guarded(() => api('dialog.saveText', `${(s.title || s.id).replace(/[^\w\- ]+/g, '').slice(0, 60).trim() || s.id}.md`, mdText));
    if (p) toast(`Exported to ${p}`, 'good');
  };

  el.append(
    h('div', { class: 'row', style: { marginBottom: '4px' } },
      h('a', { href: '#/sessions', class: 'small' }, '← Sessions')),
    h('h1', null, s.title || s.id),
    h('div', { class: 'row secondary small', style: { margin: '6px 0 14px' } },
      h('span', { class: 'mono' }, s.id), '·', h('span', { title: s.cwd }, f.projectName(s.cwd)),
      s.gitBranch ? h('span', { class: 'pill' }, s.gitBranch) : null,
      s.version ? h('span', { class: 'pill' }, `v${s.version}`) : null,
      '·', f.datetime(s.start), '→', f.datetime(s.end), `(${f.duration(s.end - s.start)})`),
    h('div', { class: 'grid cols-4', style: { marginBottom: '14px' } },
      h('div', { class: 'card kpi' }, h('div', { class: 'label' }, 'Tokens'), h('div', { class: 'value' }, f.tokens(f.totalTokens(s.tokens))),
        h('div', { class: 'meta' }, `in ${f.tokens(s.tokens.input)} · out ${f.tokens(s.tokens.output)} · cache ${f.tokens(s.tokens.cacheRead + s.tokens.cacheWrite)}`)),
      h('div', { class: 'card kpi' }, h('div', { class: 'label' }, 'Est. cost (API-equivalent)'), h('div', { class: 'value' }, f.usd(s.costUsd)),
        h('div', { class: 'meta' }, Object.keys(s.models).map(f.shortModel).join(', ') || '—')),
      h('div', { class: 'card kpi' }, h('div', { class: 'label' }, 'Messages'), h('div', { class: 'value' }, f.int(s.userMsgs)),
        h('div', { class: 'meta' }, `${f.int(s.assistantMsgs)} assistant responses`)),
      h('div', { class: 'card kpi' }, h('div', { class: 'label' }, 'Tool calls'), h('div', { class: 'value' }, f.int(Object.values(s.tools).reduce((a, b) => a + b, 0))),
        h('div', { class: 'meta' }, s.toolErrors ? `${s.toolErrors} errors` : 'no errors'))),
    h('div', { class: 'row', style: { marginBottom: '14px' } },
      h('button', { class: 'btn primary', onclick: resume }, '▶ Resume in Command Center'),
      h('button', { class: 'btn', onclick: term, disabled: !s.cwd }, 'Open in terminal'),
      h('button', { class: 'btn', onclick: exportMd }, 'Export Markdown'),
      h('button', { class: 'btn', onclick: () => guarded(() => api('clipboard.write', s.id), 'Session id copied') }, 'Copy id'),
      h('div', { class: 'grow' }),
      h('label', { class: 'check small' }, showSide, 'Subagents'),
      h('label', { class: 'check small' }, showThinking, 'Thinking'),
      h('label', { class: 'check small' }, showUsage, 'Per-turn usage')),
    conv, moreBtn);
  if (s.skippedLines) el.insertBefore(h('div', { class: 'banner info' }, `${s.skippedLines} unreadable line(s) in this transcript were skipped.`), conv);
  drawMore();
}
