import { h, s, clear } from './dom.js';
import { tokens as fmtTokens, shortModel } from './format.js';

// Color follows the entity: fixed slot per model family, never by rank.
const MODEL_SLOTS = ['opus-5-5', 'sonnet-5-5', 'haiku-5-5', 'fable-5-1', 'opus-5', 'sonnet-5', 'opus-4', 'sonnet-4'];
export function modelColor(model) {
  const m = shortModel(model);
  for (let i = 0; i < MODEL_SLOTS.length; i++) {
    const k = MODEL_SLOTS[i];
    if (m === k || m.startsWith(k + '-') || (k.endsWith('-4') && m.startsWith(k))) return `var(--series-${i + 1})`;
  }
  if (m.startsWith('haiku')) return 'var(--series-3)';
  if (m.startsWith('fable') || m.startsWith('mythos')) return 'var(--series-4)';
  return 'var(--series-other)';
}

let tipEl = null;
export function showTip(evt, title, rows) {
  if (!tipEl) { tipEl = h('div', { class: 'tooltip' }); document.body.append(tipEl); }
  clear(tipEl);
  tipEl.append(h('div', { class: 't' }, title));
  for (const [k, v, color] of rows) {
    tipEl.append(h('div', { class: 'r' }, h('span', null, color ? h('span', { class: 'dot', style: { background: color } }) : null, k), h('b', null, v)));
  }
  tipEl.style.display = 'block';
  const pad = 14, w = tipEl.offsetWidth, ht = tipEl.offsetHeight;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + w > innerWidth - 8) x = evt.clientX - w - pad;
  if (y + ht > innerHeight - 8) y = evt.clientY - ht - pad;
  tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
}
export function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export function legend(items) {
  return h('div', { class: 'legend' }, items.map(([label, color]) => h('span', null, h('span', { class: 'sw', style: { background: color } }), label)));
}

/**
 * Stacked vertical bars. days: [{date, byModel:{m:v}}]; keys: model list (stack order).
 */
export function stackedBars(el, { days, keys, height = 220, valueFmt = fmtTokens, labelFmt = (d) => d.slice(5) }) {
  clear(el);
  el.classList.add('chart');
  if (!days.length) { el.append(h('div', { class: 'empty' }, 'No activity in this range')); return; }
  const W = Math.max(el.clientWidth || 600, 300), H = height, L = 48, R = 8, T = 8, B = 22;
  const totals = days.map((d) => keys.reduce((a, k) => a + (d.byModel[k] || 0), 0));
  const max = niceMax(Math.max(...totals));
  const pw = W - L - R, ph = H - T - B;
  const step = pw / days.length;
  const bw = Math.max(2, Math.min(28, step - 2));
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, height: H });
  const gAxis = s('g', { class: 'axis' });
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, y = T + ph - (v / max) * ph;
    gAxis.append(s('line', { class: 'gridline', x1: L, x2: W - R, y1: y, y2: y }));
    gAxis.append(s('text', { x: L - 6, y: y + 4, 'text-anchor': 'end' }, valueFmt(v)));
  }
  const labelEvery = Math.ceil(days.length / Math.floor(pw / 46));
  days.forEach((d, i) => {
    if (i % labelEvery === 0) gAxis.append(s('text', { x: L + i * step + step / 2, y: H - 6, 'text-anchor': 'middle' }, labelFmt(d.date)));
  });
  svg.append(gAxis);
  days.forEach((d, i) => {
    const x = L + i * step + (step - bw) / 2;
    let y = T + ph;
    const g = s('g');
    const present = keys.filter((k) => d.byModel[k] > 0);
    present.forEach((k, j) => {
      const hgt = (d.byModel[k] / max) * ph;
      const top = j === present.length - 1;
      const gap = j > 0 ? 2 : 0; // 2px surface gap between stacked segments
      const hh = Math.max(0, hgt - gap);
      y -= hgt;
      if (top && hh > 4) {
        const r = Math.min(4, bw / 2);
        g.append(s('path', { fill: modelColor(k), d: `M${x},${y + hh}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${y + hh}Z` }));
      } else g.append(s('rect', { x, y, width: bw, height: hh, fill: modelColor(k) }));
    });
    // Hit target bigger than the mark: full column.
    const hit = s('rect', { x: L + i * step, y: T, width: step, height: ph, fill: 'transparent' });
    hit.addEventListener('mousemove', (e) => showTip(e, d.date, [
      ...present.slice().reverse().map((k) => [shortModel(k), valueFmt(d.byModel[k]), modelColor(k)]),
      ['Total', valueFmt(totals[i])],
    ]));
    hit.addEventListener('mouseleave', hideTip);
    g.append(hit);
    svg.append(g);
  });
  el.append(svg);
  if (keys.length > 1) el.append(legend(keys.map((k) => [shortModel(k), modelColor(k)])));
}

/** GitHub-style activity heatmap over the last `weeks` weeks. byDay: [{date, tokens, sessions}] */
export function heatmap(el, { byDay, weeks = 53, metric = 'tokens', fmt = fmtTokens }) {
  clear(el);
  el.classList.add('chart');
  const map = new Map(byDay.map((d) => [d.date, d]));
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const end = new Date(); end.setHours(0, 0, 0, 0);
  const start = new Date(end); start.setDate(start.getDate() - (weeks * 7 - 1) - start.getDay());
  const vals = byDay.map((d) => d[metric] || 0).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p) => vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : 0;
  const thresholds = [q(0.2), q(0.45), q(0.7), q(0.9)];
  const level = (v) => (v <= 0 ? 0 : 1 + thresholds.filter((t) => v > t).length);
  const cell = 11, gap = 3, L = 26, T = 16;
  const W = L + weeks * (cell + gap) + 4, H = T + 7 * (cell + gap);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, height: H, style: `max-width:${W * 1.4}px` });
  const ax = s('g', { class: 'axis' });
  ['Mon', 'Wed', 'Fri'].forEach((d, i) => ax.append(s('text', { x: 0, y: T + (i * 2 + 1) * (cell + gap) + cell - 2 }, d)));
  svg.append(ax);
  const d = new Date(start);
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) for (let wd = 0; wd < 7; wd++) {
    if (d > end) break;
    const x = L + w * (cell + gap), y = T + wd * (cell + gap);
    if (wd === 0 && d.getMonth() !== lastMonth && d.getDate() <= 7) {
      lastMonth = d.getMonth();
      ax.append(s('text', { x, y: 10 }, d.toLocaleDateString(undefined, { month: 'short' })));
    }
    const rec = map.get(key(d));
    const v = rec ? rec[metric] || 0 : 0;
    const r = s('rect', { x, y, width: cell, height: cell, rx: 2, fill: `var(--seq-${level(v)})` });
    const label = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const rows = rec ? [['Tokens', fmtTokens(rec.tokens)], ['Sessions', String(rec.sessions || 0)], ['Est. cost', '$' + (rec.costUsd || 0).toFixed(2)]] : [['No activity', '']];
    r.addEventListener('mousemove', (e) => showTip(e, label, rows));
    r.addEventListener('mouseleave', hideTip);
    svg.append(r);
    d.setDate(d.getDate() + 1);
  }
  el.append(svg);
  el.append(h('div', { class: 'legend' }, h('span', null, 'Less'),
    [0, 1, 2, 3, 4, 5].map((i) => h('span', { class: 'sw', style: { background: `var(--seq-${i})`, marginRight: '2px' } })), h('span', null, 'More')));
}

/** Donut: items [{label, value, color}] */
export function donut(el, { items, size = 170, fmt = fmtTokens, centerLabel = 'total' }) {
  clear(el);
  el.classList.add('chart');
  const total = items.reduce((a, b) => a + b.value, 0);
  if (!total) { el.append(h('div', { class: 'empty' }, 'No data')); return; }
  const r = size / 2, ir = r * 0.62;
  const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, style: 'width:auto' });
  let a0 = -Math.PI / 2;
  const pt = (a, rad) => [r + rad * Math.cos(a), r + rad * Math.sin(a)];
  for (const it of items) {
    const frac = it.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r), [x2, y2] = pt(a1, ir), [x3, y3] = pt(a0, ir);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const d = frac >= 0.9999
      ? `M${r},0A${r},${r} 0 1 1 ${r},${size}A${r},${r} 0 1 1 ${r},0Z M${r},${r - ir}A${ir},${ir} 0 1 0 ${r},${r + ir}A${ir},${ir} 0 1 0 ${r},${r - ir}Z`
      : `M${x0},${y0}A${r},${r} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${ir},${ir} 0 ${large} 0 ${x3},${y3}Z`;
    const p = s('path', {
      d, 'fill-rule': 'evenodd', fill: it.color,
      stroke: frac >= 0.9999 ? 'none' : 'var(--surface-1)', 'stroke-width': 2,
    });
    p.addEventListener('mousemove', (e) => showTip(e, it.label, [['Value', fmt(it.value)], ['Share', (frac * 100).toFixed(1) + '%']]));
    p.addEventListener('mouseleave', hideTip);
    svg.append(p);
    a0 = a1;
  }
  svg.append(s('text', { x: r, y: r - 2, 'text-anchor': 'middle', fill: 'var(--text-primary)', 'font-size': 18, 'font-weight': 600 }, fmt(total)));
  svg.append(s('text', { x: r, y: r + 15, 'text-anchor': 'middle', fill: 'var(--text-muted)', 'font-size': 11 }, centerLabel));
  el.append(h('div', { class: 'row', style: { alignItems: 'center', gap: '18px' } }, svg,
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' } },
      items.map((it) => h('div', null, h('span', { class: 'sw', style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', marginRight: '6px', background: it.color } }),
        h('span', { class: 'secondary' }, it.label), ' ', h('b', null, ((it.value / total) * 100).toFixed(1) + '%'))))));
}

/** Horizontal bars: rows [{label, value, sub?, err?}] */
export function hbars(el, { rows, fmt = (v) => String(v), max }) {
  clear(el);
  if (!rows.length) { el.append(h('div', { class: 'empty' }, 'No data')); return; }
  const m = max || Math.max(...rows.map((r) => r.value), 1);
  for (const r of rows) {
    const fill = h('div', { class: 'fill', style: { width: `${Math.max(1, (r.value / m) * 100)}%` } });
    const errFill = r.err ? h('div', { class: 'fill err', style: { width: `${Math.max(1, (r.err / m) * 100)}%`, marginTop: '2px', height: '4px' } }) : null;
    const row = h('div', { class: 'hbar' },
      h('div', { class: 'name', title: r.label }, r.label),
      h('div', { class: 'track' }, fill, errFill),
      h('div', { class: 'val' }, fmt(r.value)));
    row.addEventListener('mousemove', (e) => showTip(e, r.label, [['Count', fmt(r.value)], ...(r.err != null ? [['Errors', String(r.err)]] : []), ...(r.sub ? [[r.sub, '']] : [])]));
    row.addEventListener('mouseleave', hideTip);
    el.append(row);
  }
}
