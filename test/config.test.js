const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccd-'));
const HOME = path.join(tmp, 'home');
const PROJ = path.join(tmp, 'proj');
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.mkdirSync(PROJ, { recursive: true });
process.env.CCD_USER_HOME = HOME;
process.env.CCD_HOME = path.join(tmp, 'app');

const guard = require('../main/data/guard');
const backup = require('../main/data/backup');
const config = require('../main/data/config');

const SETTINGS = path.join(HOME, '.claude', 'settings.json');

test('assertWritable allows claude dir, claude.json and known project files only', () => {
  assert.doesNotThrow(() => guard.assertWritable(SETTINGS, []));
  assert.doesNotThrow(() => guard.assertWritable(path.join(HOME, '.claude.json'), []));
  assert.throws(() => guard.assertWritable(path.join(HOME, '.claude', '..', '..', 'evil.txt'), []), /Path not allowed/);
  assert.throws(() => guard.assertWritable(path.join(HOME, '.claude.json.bak'), []), /Path not allowed/);
  assert.throws(() => guard.assertWritable(path.join(PROJ, '.mcp.json'), []), /Path not allowed/);
  assert.doesNotThrow(() => guard.assertWritable(path.join(PROJ, '.mcp.json'), [PROJ]));
  assert.doesNotThrow(() => guard.assertWritable(path.join(PROJ, 'CLAUDE.md'), [PROJ]));
  assert.doesNotThrow(() => guard.assertWritable(path.join(PROJ, '.claude', 'settings.local.json'), [PROJ]));
  assert.throws(() => guard.assertWritable(path.join(PROJ, 'src', 'index.js'), [PROJ]), /Path not allowed/);
});

test('invalid JSON write throws, leaves file unchanged, creates no backup', () => {
  fs.writeFileSync(SETTINGS, '{"a":1}');
  const before = backup.list().length;
  assert.throws(() => config.writeText(SETTINGS, '{bad', { json: true, knownProjects: [] }));
  assert.equal(fs.readFileSync(SETTINGS, 'utf8'), '{"a":1}');
  assert.equal(backup.list().length, before);
});

test('successful write backs up old content and leaves no temp file', () => {
  fs.writeFileSync(SETTINGS, '{"a":1}');
  const { backupPath } = config.writeText(SETTINGS, '{"a":2}', { json: true, knownProjects: [] });
  assert.equal(fs.readFileSync(backupPath, 'utf8'), '{"a":1}');
  assert.equal(fs.readFileSync(SETTINGS, 'utf8'), '{"a":2}');
  assert.deepEqual(fs.readdirSync(path.dirname(SETTINGS)).filter((f) => f.includes('.tmp')), []);
});

test('writing a new file returns null backup', () => {
  const p = path.join(HOME, '.claude', 'CLAUDE.md');
  const { backupPath } = config.writeText(p, '# hi', { json: false, knownProjects: [] });
  assert.equal(backupPath, null);
  assert.equal(fs.readFileSync(p, 'utf8'), '# hi');
});

test('write with stale expected content is rejected and file untouched', () => {
  fs.writeFileSync(SETTINGS, '{"changed":"by claude"}');
  assert.throws(() => config.writeText(SETTINGS, '{"mine":1}', { json: true, knownProjects: [], expected: '{"old":1}' }), /changed on disk/);
  assert.equal(fs.readFileSync(SETTINGS, 'utf8'), '{"changed":"by claude"}');
  assert.doesNotThrow(() => config.writeText(SETTINGS, '{"mine":1}', { json: true, knownProjects: [], expected: '{"changed":"by claude"}' }));
  // expected '' means "file must not exist yet"
  const p = path.join(HOME, '.claude', 'fresh.json');
  assert.doesNotThrow(() => config.writeText(p, '{}', { json: true, knownProjects: [], expected: '' }));
});

test('write outside allowed roots is rejected', () => {
  assert.throws(() => config.writeText(path.join(tmp, 'x.txt'), 'x', { json: false, knownProjects: [] }), /Path not allowed/);
});

test('readJson reports parse errors without throwing', () => {
  fs.writeFileSync(SETTINGS, '{oops');
  const r = config.readJson(SETTINGS);
  assert.equal(r.exists, true);
  assert.equal(r.data, null);
  assert.ok(r.error);
  assert.equal(r.raw, '{oops');
  assert.deepEqual(config.readJson(path.join(HOME, 'missing.json')), { exists: false, raw: '', data: null, error: null });
});

test('restore round-trip restores content and backs up the replaced version', () => {
  fs.writeFileSync(SETTINGS, '{"v":"original"}');
  config.writeText(SETTINGS, '{"v":"changed"}', { json: true, knownProjects: [] });
  const b = backup.list().find((x) => x.original === SETTINGS && backup.read(x.id) === '{"v":"original"}');
  assert.ok(b);
  const n = backup.list().length;
  backup.restore(b.id, []);
  assert.equal(fs.readFileSync(SETTINGS, 'utf8'), '{"v":"original"}');
  assert.equal(backup.list().length, n + 1);
  assert.ok(backup.list().some((x) => backup.read(x.id) === '{"v":"changed"}'));
});

test('diffLines produces an LCS line diff', () => {
  assert.deepEqual(config.diffLines('a\nb\nc', 'a\nx\nc'), [
    { op: '=', line: 'a' }, { op: '-', line: 'b' }, { op: '+', line: 'x' }, { op: '=', line: 'c' },
  ]);
});

test('locations lists user and per-project config files', () => {
  const locs = config.locations([PROJ]);
  const paths = locs.map((l) => l.path);
  assert.ok(paths.includes(SETTINGS));
  assert.ok(paths.includes(path.join(HOME, '.claude.json')));
  assert.ok(paths.includes(path.join(PROJ, '.mcp.json')));
  assert.ok(paths.includes(path.join(PROJ, '.claude', 'settings.local.json')));
  assert.equal(locs.find((l) => l.path === SETTINGS).scope, 'user');
  assert.equal(locs.find((l) => l.path === path.join(PROJ, '.claude', 'settings.local.json')).scope, 'local');
});
