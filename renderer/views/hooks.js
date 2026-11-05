import { h, clear, modal } from '../lib/dom.js';
import { settingsScopes, scopeSelect, loadJson, saveJson, invalidJsonGuard } from '../lib/jsonedit.js';

const EVENTS = [
  ['PreToolUse', 'Before a tool runs (can block it). Matcher = tool name.'],
  ['PostToolUse', 'After a tool succeeds. Matcher = tool name.'],
  ['UserPromptSubmit', 'When you submit a prompt (can add context or block).'],
  ['Notification', 'When Claude sends a notification (needs input, idle).'],
  ['Stop', 'When Claude finishes responding.'],
  ['SubagentStop', 'When a subagent finishes.'],
  ['PreCompact', 'Before context compaction. Matcher = manual | auto.'],
  ['SessionStart', 'When a session starts or resumes. Matcher = startup | resume | clear | compact.'],
  ['SessionEnd', 'When a session ends.'],
];
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);

const TEMPLATES = [
  { name: 'Log every Bash command to a file', event: 'PreToolUse', matcher: 'Bash',
    command: 'powershell -NoProfile -Command "$input | Out-String | Add-Content -Path $env:USERPROFILE\\.claude\\bash-log.jsonl"' },
  { name: 'Windows toast when Claude stops', event: 'Stop', matcher: '',
    command: 'powershell -NoProfile -Command "[void][Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]; $x=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(1); $x.GetElementsByTagName(\'text\')[0].AppendChild($x.CreateTextNode(\'Claude finished\')) > $null; [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(\'Claude Code\').Show([Windows.UI.Notifications.ToastNotification]::new($x))"' },
  { name: 'Block edits to .env files', event: 'PreToolUse', matcher: 'Edit|Write',
    command: 'node -e "let d=\'\';process.stdin.on(\'data\',c=>d+=c).on(\'end\',()=>{const p=(JSON.parse(d).tool_input||{}).file_path||\'\';if(/\\.env($|\\.)/.test(p)){console.error(\'Editing .env files is blocked by a hook\');process.exit(2)}})"' },
  { name: 'Run Prettier after edits', event: 'PostToolUse', matcher: 'Edit|Write',
    command: 'npx prettier --write --ignore-unknown "$CLAUDE_PROJECT_DIR"' },
];

async function editHook(initial) {
  const ev = h('select', null, EVENTS.map(([e]) => h('option', { value: e }, e)));
  ev.value = initial.event;
  const matcher = h('input', { type: 'text', value: initial.matcher || '', placeholder: 'e.g. Bash or Edit|Write (empty = all)', class: 'mono' });
  const command = h('textarea', { rows: 5 }, initial.command || '');
  const timeout = h('input', { type: 'number', value: initial.timeout || '', placeholder: '60' });
  const help = h('div', { class: 'muted small' });
  const upd = () => { help.textContent = EVENTS.find(([e]) => e === ev.value)[1]; };
  ev.addEventListener('change', upd); upd();
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    h('label', { class: 'field' }, 'Event', ev, help), h('label', { class: 'field' }, 'Matcher', matcher),
    h('label', { class: 'field' }, 'Command (receives the event as JSON on stdin; exit code 2 blocks)', command),
    h('label', { class: 'field' }, 'Timeout (seconds)', timeout));
  const r = await modal({ title: initial.command ? 'Edit hook' : 'New hook', body, actions: [{ label: 'Cancel', value: null }, { label: 'OK', value: 'ok', primary: true }] });
  if (r !== 'ok' || !command.value.trim()) return null;
  return { event: ev.value, matcher: matcher.value.trim(), command: command.value.trim(), timeout: timeout.value ? Number(timeout.value) : undefined };
}

export async function render(el, _p, query) {
  const scopes = await settingsScopes();
  let current = query.get('file') || scopes[0].path;
  const body = h('div');
  el.append(h('h1', null, 'Hooks'), h('p', { class: 'sub' }, 'Shell commands Claude Code runs automatically at points in its lifecycle.'),
    h('div', { class: 'row', style: { marginBottom: '12px' } }, scopeSelect(scopes, current, (v) => { current = v; draw(); })), body);

  async function draw() {
    clear(body);
    const r = await loadJson(current);
    if (invalidJsonGuard(body, current, r, draw)) return;
    const data = r.data || {};
    // Flatten to a working list
    const list = [];
    for (const [event, groups] of Object.entries(data.hooks || {})) {
      if (!EVENTS.some(([x]) => x === event)) continue;
      for (const g of groups || []) for (const hk of g.hooks || []) {
        list.push({ event, matcher: g.matcher || '', command: hk.command, timeout: hk.timeout, type: hk.type || 'command', raw: hk });
      }
    }
    const save = async (nextList) => {
      const next = JSON.parse(JSON.stringify(data));
      // Keep events this editor doesn't model exactly as they were.
      const hooks = Object.fromEntries(Object.entries(data.hooks || {}).filter(([e]) => !EVENTS.some(([x]) => x === e)));
      for (const it of nextList) {
        const groups = hooks[it.event] || (hooks[it.event] = []);
        let g = groups.find((x) => (x.matcher || '') === it.matcher);
        if (!g) { g = TOOL_EVENTS.has(it.event) || it.matcher ? { matcher: it.matcher, hooks: [] } : { hooks: [] }; groups.push(g); }
        const hk = { ...(it.raw || {}), type: it.type || 'command', command: it.command };
        if (it.timeout) hk.timeout = it.timeout; else delete hk.timeout;
        g.hooks.push(hk);
      }
      if (Object.keys(hooks).length) next.hooks = hooks; else delete next.hooks;
      if (await saveJson(current, next)) draw();
    };
    const add = async (tpl) => { const n = await editHook(tpl || { event: 'PreToolUse', matcher: '' }); if (n) save([...list, n]); };

    body.append(h('div', { class: 'row', style: { marginBottom: '12px' } },
      h('button', { class: 'btn primary', onclick: () => add() }, '+ New hook'),
      h('select', { onchange: (e) => { const t = TEMPLATES[e.target.value]; e.target.value = ''; if (t) add(t); } },
        h('option', { value: '' }, 'Add from template…'), TEMPLATES.map((t, i) => h('option', { value: i }, t.name)))));
    if (!list.length) { body.append(h('div', { class: 'card empty' }, 'No hooks in this settings file.')); return; }
    for (const [event, desc] of EVENTS) {
      const items = list.map((it, i) => ({ it, i })).filter((x) => x.it.event === event);
      if (!items.length) continue;
      body.append(h('div', { class: 'card', style: { marginBottom: '12px' } },
        h('h2', null, event, h('span', { class: 'muted small', style: { fontWeight: 400, marginLeft: '8px' } }, desc)),
        h('table', { class: 'tbl' }, h('tr', null, h('th', null, 'Matcher'), h('th', null, 'Command'), h('th', null, '')),
          items.map(({ it, i }) => h('tr', null,
            h('td', null, it.matcher ? h('code', null, it.matcher) : h('span', { class: 'muted' }, 'all')),
            h('td', null, h('pre', { class: 'mono', style: { maxHeight: '6em', overflow: 'auto' } }, it.command)),
            h('td', { style: { whiteSpace: 'nowrap', width: '1%' } },
              h('button', { class: 'btn sm', onclick: async () => { const n = await editHook(it); if (n) { const nl = [...list]; nl[i] = { ...it, ...n }; save(nl); } } }, 'Edit'), ' ',
              h('button', { class: 'btn sm danger', onclick: () => save(list.filter((_, j) => j !== i)) }, 'Remove')))))));
    }
    const unknown = Object.keys(data.hooks || {}).filter((e) => !EVENTS.some(([x]) => x === e));
    if (unknown.length) body.append(h('p', { class: 'muted small' }, `Also present (edit via Settings → Raw JSON): ${unknown.join(', ')}`));
  }
  await draw();
}
