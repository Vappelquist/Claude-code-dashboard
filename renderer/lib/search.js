import { h, clear, api, debounce } from './dom.js';
import { ago } from './format.js';

let open = false;

/** Ctrl+K command palette over nav items, sessions and prompt history. */
export async function openPalette(nav) {
  if (open) return;
  open = true;
  const input = h('input', { type: 'text', placeholder: 'Search sessions, prompts, pages…' });
  const results = h('div', { class: 'results' });
  const bg = h('div', { class: 'palette-bg' }, h('div', { class: 'palette' }, input, results));
  const close = () => { bg.remove(); open = false; };
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });

  const navItems = nav.flatMap((g) => g.items.map((it) => ({ kind: 'page', text: `${g.group} › ${it.label}`, go: () => { location.hash = `#/${it.id}`; } })));
  let sessions = [];
  let items = [];
  let sel = 0;
  api('sessions.list').then((s) => { sessions = s; update(); }).catch(() => {});

  const draw = () => {
    clear(results);
    items.slice(0, 60).forEach((it, i) => {
      const row = h('div', { class: `item ${i === sel ? 'sel' : ''}`, onclick: () => { close(); it.go(); } },
        h('span', { class: 'kind' }, it.kind), h('span', { class: 'txt' }, it.text), it.meta ? h('span', { class: 'muted small' }, it.meta) : null);
      results.append(row);
    });
    if (!items.length) results.append(h('div', { class: 'item muted' }, 'No matches'));
    const s = results.querySelector('.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
  };
  const update = debounce(async () => {
    const q = input.value.trim().toLowerCase();
    const m = (t) => !q || String(t || '').toLowerCase().includes(q);
    const ss = sessions.filter((s) => m(s.title) || m(s.cwd) || m(s.id)).slice(0, 25)
      .map((s) => ({ kind: 'session', text: s.title || s.id, meta: ago(s.end), go: () => { location.hash = `#/session/${s.id}`; } }));
    let hs = [];
    if (q.length >= 2) {
      try {
        hs = (await api('history.list', q)).slice(0, 25).map((p) => ({ kind: 'prompt', text: p.text.replace(/\s+/g, ' '), meta: ago(p.timestamp),
          go: () => { location.hash = `#/history?q=${encodeURIComponent(q)}`; } }));
      } catch { /* ignore */ }
    }
    items = [...navItems.filter((n) => m(n.text)), ...ss, ...hs];
    sel = 0;
    draw();
  }, 120);

  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && items[sel]) { close(); items[sel].go(); }
  });
  document.body.append(bg);
  input.focus();
  update();
}
