import { h, clear, api, confirm, guarded } from '../lib/dom.js';
import { diffNode } from '../lib/diffview.js';
import * as f from '../lib/format.js';

export async function render(el) {
  const list = h('div', { class: 'filelist' });
  const detail = h('div');
  el.append(h('h1', null, 'Backups'), h('p', { class: 'sub' }, 'A copy of every file is taken before the dashboard changes it. Restoring also backs up the current version first.'),
    h('div', { class: 'split' }, h('div', { class: 'card', style: { padding: '8px' } }, list), detail));
  let selected = null;
  async function draw() {
    const backups = await api('backups.list');
    clear(list);
    if (!backups.length) { list.append(h('div', { class: 'empty' }, 'No backups yet.')); clear(detail); return; }
    if (!selected || !backups.some((b) => b.id === selected)) selected = backups[0].id;
    for (const b of backups) {
      list.append(h('button', { class: b.id === selected ? 'active' : '', title: b.original, onclick: () => { selected = b.id; draw(); } },
        h('div', null, b.original.split(/[\\/]/).slice(-2).join('/')), h('div', { class: 'muted small' }, f.datetime(b.time), ' · ', f.int(b.size), ' B')));
    }
    const b = backups.find((x) => x.id === selected);
    clear(detail);
    const [old, cur] = await Promise.all([api('backups.read', b.id), api('file.read', b.original).catch(() => null)]);
    const diff = await api('config.preview', b.original, old);
    const changes = diff.filter((d) => d.op !== '=').length;
    detail.append(h('div', { class: 'card' },
      h('div', { class: 'row', style: { marginBottom: '10px' } }, h('div', { class: 'grow' }, h('div', { class: 'mono small' }, b.original),
        h('div', { class: 'muted small' }, `Backed up ${f.datetime(b.time)} · ${cur == null ? 'file no longer exists' : changes ? `${changes} line(s) differ from the current file` : 'identical to the current file'}`)),
      h('button', { class: 'btn primary', disabled: changes === 0 && cur != null, onclick: async () => {
        if (!(await confirm('Restore backup', `Replace ${b.original} with this backup? The current version will be backed up first.`, { okLabel: 'Restore' }))) return;
        await guarded(() => api('backups.restore', b.id), 'Restored'); draw();
      } }, 'Restore this version')),
      h('div', { class: 'muted small', style: { marginBottom: '6px' } }, 'Diff: current file → backup (green = what restoring brings back)'),
      diffNode(diff)));
  }
  await draw();
}
