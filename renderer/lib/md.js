import { escapeHtml } from './dom.js';

// Minimal, safe markdown: everything is escaped first; only known constructs are re-introduced.
function inline(t) {
  t = escapeHtml(t);
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

export function render(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let para = [], list = null;
  const flushP = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushL = () => { if (list) { out.push(`<${list.t}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.t}>`); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fence = /^\s*```(\w*)/.exec(l);
    if (fence) {
      flushP(); flushL();
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const hd = /^(#{1,4})\s+(.*)/.exec(l);
    if (hd) { flushP(); flushL(); out.push(`<h${hd[1].length + 1}>${inline(hd[2])}</h${hd[1].length + 1}>`); continue; }
    const ul = /^\s*[-*]\s+(.*)/.exec(l), ol = /^\s*\d+[.)]\s+(.*)/.exec(l);
    if (ul || ol) {
      flushP();
      const t = ul ? 'ul' : 'ol';
      if (!list || list.t !== t) { flushL(); list = { t, items: [] }; }
      list.items.push((ul || ol)[1]);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(l)) {
      flushP(); flushL();
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
      i--;
      const cells = (r) => r.trim().slice(1, -1).split('|').map((c) => c.trim());
      const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
      out.push('<table>' + body.map((r, ri) => '<tr>' + cells(r).map((c) => ri === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</table>');
      continue;
    }
    if (!l.trim()) { flushP(); flushL(); continue; }
    flushL();
    para.push(l);
  }
  flushP(); flushL();
  return out.join('');
}
