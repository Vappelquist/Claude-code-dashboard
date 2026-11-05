// Regression tests for findings from the final code review.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccd-rf-'));
const HOME = path.join(tmp, 'home');
const C = path.join(HOME, '.claude');
fs.mkdirSync(C, { recursive: true });
process.env.CCD_USER_HOME = HOME;
process.env.CCD_HOME = path.join(tmp, 'app');

const put = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const day = (offset) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + offset); return d.toISOString(); };

test('range stats only count activity inside the range (multi-day session)', () => {
  const T = require('../main/data/transcripts');
  const base = { sessionId: 'm', cwd: 'C:\\p', isSidechain: false };
  const lines = [
    { ...base, type: 'user', timestamp: day(-3), message: { role: 'user', content: 'old prompt' } },
    { ...base, type: 'assistant', timestamp: day(-3), message: { id: 'a1', model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 900, output_tokens: 0 } } },
    { ...base, type: 'user', timestamp: day(0), message: { role: 'user', content: 'new prompt' } },
    { ...base, type: 'assistant', timestamp: day(0), message: { id: 'a2', model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text: 'y' }], usage: { input_tokens: 100, output_tokens: 0 } } },
  ];
  put(path.join(tmp, 'proj', 'P', 'm.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const s = T.parseSessionFile(path.join(tmp, 'proj', 'P', 'm.jsonl'));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const st = T.computeStats([s], { from: today.getTime() });
  assert.equal(st.tokens.total, 100);
  assert.equal(st.tokens.input, 100);
  assert.ok(Math.abs(st.costUsd - 100 * 4 / 1e6) < 1e-12);
  assert.equal(st.prompts, 1);
  assert.equal(st.byModel['claude-opus-5-5'].tokens, 100);
  assert.ok(Math.abs(st.byModel['claude-opus-5-5'].costUsd - 100 * 4 / 1e6) < 1e-12);
  assert.equal(st.byProject[0].tokens, 100);
  const all = T.computeStats([s], {});
  assert.equal(all.tokens.total, 1000);
  assert.equal(all.prompts, 2);
});

test('plugins: sibling .codex-plugin etc. manifests do not create duplicate rows', () => {
  const root = path.join(C, 'plugins', 'synced', 'org', 'sp');
  put(path.join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'superpowers' }));
  for (const x of ['.codex-plugin', '.cursor-plugin', '.muse-plugin']) put(path.join(root, x, 'plugin.json'), JSON.stringify({ name: 'superpowers' }));
  const inv = require('../main/data/plugins').inventory([]);
  const sp = inv.plugins.filter((p) => p.name === 'superpowers');
  assert.equal(sp.length, 1);
  assert.equal(sp[0].path, root);
});

test('readJson strips a UTF-8 BOM for parsing but keeps raw for concurrency', () => {
  const config = require('../main/data/config');
  const p = path.join(C, 'bom.json');
  fs.writeFileSync(p, '\uFEFF{"a":1}');
  const r = config.readJson(p);
  assert.equal(r.error, null);
  assert.deepEqual(r.data, { a: 1 });
  assert.equal(r.raw, '\uFEFF{"a":1}');
});

test('app data defaults outside the repo (not OneDrive) when CCD_HOME is unset', () => {
  const saved = process.env.CCD_HOME;
  delete process.env.CCD_HOME;
  const paths = require('../main/paths');
  const d = paths.appDataDir();
  process.env.CCD_HOME = saved;
  assert.ok(!path.resolve(d).toLowerCase().startsWith(path.resolve(__dirname, '..').toLowerCase()), d);
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) assert.ok(d.toLowerCase().startsWith(process.env.LOCALAPPDATA.toLowerCase()));
});

test('backups are pruned to the newest N per original file', () => {
  const backup = require('../main/data/backup');
  const p = path.join(C, 'prune.json');
  for (let i = 0; i < backup.MAX_PER_FILE + 5; i++) { fs.writeFileSync(p, `{"v":${i}}`); backup.backupFile(p); }
  const mine = backup.list().filter((b) => b.original === path.resolve(p));
  assert.equal(mine.length, backup.MAX_PER_FILE);
  assert.ok(mine.some((b) => backup.read(b.id) === `{"v":${backup.MAX_PER_FILE + 4}}`));
  assert.ok(!mine.some((b) => backup.read(b.id) === '{"v":0}'));
});

test('backup list survives ids whose base64 contains "__"', () => {
  const backup = require('../main/data/backup');
  const paths = require('../main/paths');
  // Find a path whose base64url contains "__"
  let name = null;
  for (let i = 0; i < 5000 && !name; i++) {
    const cand = path.join(C, `ö${i}?.json`);
    if (Buffer.from(path.resolve(cand)).toString('base64url').includes('__')) name = cand;
  }
  if (!name) return; // extremely unlikely
  const id = `2026-01-01T00-00-00-000Z__00001__${Buffer.from(path.resolve(name)).toString('base64url')}`;
  fs.mkdirSync(paths.backupsDir(), { recursive: true });
  fs.writeFileSync(path.join(paths.backupsDir(), id), 'x');
  assert.ok(backup.list().some((b) => b.id === id && b.original === path.resolve(name)));
});

test('guard.isOpenable allows claude dir and known projects only', () => {
  const guard = require('../main/data/guard');
  const proj = path.join(tmp, 'proj');
  assert.equal(guard.isOpenable(path.join(C, 'settings.json'), [proj]), true);
  assert.equal(guard.isOpenable(proj, [proj]), true);
  assert.equal(guard.isOpenable(path.join(proj, 'src', 'a.js'), [proj]), true);
  assert.equal(guard.isOpenable('C:\\Windows\\System32\\calc.exe', [proj]), false);
  assert.equal(guard.isOpenable(path.join(tmp, 'evil.bat'), [proj]), false);
});

test('terminal fallback command quotes cwd and rejects cmd metacharacters', () => {
  const { terminalFallbackCommand } = require('../main/runner');
  assert.equal(terminalFallbackCommand('C:\\My Projects\\app', 'abc-123'),
    'start "" /D "C:\\My Projects\\app" cmd /k claude --resume abc-123');
  assert.equal(terminalFallbackCommand('C:\\a', null), 'start "" /D "C:\\a" cmd /k claude');
  for (const bad of ['C:\\R&D', 'C:\\a"b', 'C:\\x|y', 'C:\\%PATH%', 'C:\\a^b', 'C:\\a<b', 'C:\\a>b']) {
    assert.throws(() => terminalFallbackCommand(bad, null), /Unsupported characters/, bad);
  }
});
