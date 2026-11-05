const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccd-mcp-'));
const HOME = path.join(tmp, 'home');
const PROJ = path.join(tmp, 'proj');
fs.mkdirSync(path.join(HOME, '.claude'), { recursive: true });
fs.mkdirSync(PROJ, { recursive: true });
process.env.CCD_USER_HOME = HOME;
process.env.CCD_HOME = path.join(tmp, 'app');
const CJ = path.join(HOME, '.claude.json');
fs.writeFileSync(CJ, JSON.stringify({
  numStartups: 5,
  mcpServers: { gh: { type: 'http', url: 'https://example.com/mcp' } },
  projects: { [PROJ]: { mcpServers: { local1: { command: 'node', args: ['x.js'] } }, other: 1 } },
}));
fs.writeFileSync(path.join(PROJ, '.mcp.json'), JSON.stringify({ mcpServers: { shared: { command: 'npx', args: ['y'] } } }));

const mcp = require('../main/data/mcp');

test('list returns user, local and project servers', () => {
  const l = mcp.list([PROJ]).servers;
  const by = Object.fromEntries(l.map((s) => [s.name, s]));
  assert.equal(by.gh.scope, 'user'); assert.equal(by.gh.config.url, 'https://example.com/mcp');
  assert.equal(by.local1.scope, 'local'); assert.equal(by.local1.project, PROJ);
  assert.equal(by.shared.scope, 'project'); assert.equal(by.shared.path, path.join(PROJ, '.mcp.json'));
});

test('apply upserts on the latest file content and preserves other keys', () => {
  // Simulate Claude Code changing the file after the dashboard listed servers.
  const j = JSON.parse(fs.readFileSync(CJ, 'utf8')); j.numStartups = 6; fs.writeFileSync(CJ, JSON.stringify(j));
  mcp.apply({ scope: 'user', name: 'new', config: { command: 'uvx', args: ['srv'] } }, [PROJ]);
  const after = JSON.parse(fs.readFileSync(CJ, 'utf8'));
  assert.equal(after.numStartups, 6);
  assert.deepEqual(after.mcpServers.new, { command: 'uvx', args: ['srv'] });
  assert.ok(after.mcpServers.gh);
  assert.equal(after.projects[PROJ].other, 1);
});

test('apply removes a local server and writes project .mcp.json', () => {
  mcp.apply({ scope: 'local', project: PROJ, name: 'local1', config: null }, [PROJ]);
  assert.deepEqual(JSON.parse(fs.readFileSync(CJ, 'utf8')).projects[PROJ].mcpServers, {});
  mcp.apply({ scope: 'project', project: PROJ, name: 'shared2', config: { type: 'http', url: 'https://x' } }, [PROJ]);
  const pj = JSON.parse(fs.readFileSync(path.join(PROJ, '.mcp.json'), 'utf8'));
  assert.deepEqual(Object.keys(pj.mcpServers).sort(), ['shared', 'shared2']);
});

test('local scope reuses the existing project key regardless of slash style', () => {
  const alt = PROJ.split(path.sep).join('/');
  const j = JSON.parse(fs.readFileSync(CJ, 'utf8'));
  j.projects = { [alt]: j.projects[PROJ] || {} };
  fs.writeFileSync(CJ, JSON.stringify(j));
  mcp.apply({ scope: 'local', project: PROJ, name: 'slashy', config: { command: 'x' } }, [PROJ]);
  const after = JSON.parse(fs.readFileSync(CJ, 'utf8'));
  assert.deepEqual(Object.keys(after.projects), [alt]);
  assert.ok(after.projects[alt].mcpServers.slashy);
});

test('plan returns a diff without writing', () => {
  const before = fs.readFileSync(CJ, 'utf8');
  const p = mcp.plan({ scope: 'user', name: 'gh', config: null }, [PROJ]);
  assert.equal(p.path, CJ);
  assert.ok(p.diff.some((d) => d.op === '-' && d.line.includes('example.com')));
  assert.equal(fs.readFileSync(CJ, 'utf8'), before);
});

test('invalid names and project scope without known project are rejected', () => {
  assert.throws(() => mcp.plan({ scope: 'user', name: '', config: {} }, []), /name/i);
  assert.throws(() => mcp.plan({ scope: 'project', project: path.join(tmp, 'unknown'), name: 'a', config: {} }, []), /Path not allowed/);
});
