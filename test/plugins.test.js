const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccd-pl-'));
const HOME = path.join(tmp, 'home');
const C = path.join(HOME, '.claude');
const PROJ = path.join(tmp, 'proj');
process.env.CCD_USER_HOME = HOME;
process.env.CCD_HOME = path.join(tmp, 'app');

const put = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
put(path.join(C, 'skills', 'my-skill', 'SKILL.md'), '---\nname: my-skill\ndescription: "Does: things, quoted"\n---\nbody');
put(path.join(C, 'plugins', 'synced', 'org', 'p1', 'plugin.json'), JSON.stringify({ name: 'p1', version: '1.0.0', description: 'Plugin one' }));
put(path.join(C, 'plugins', 'synced', 'org', 'p1', 'skills', 'ps', 'SKILL.md'), '---\nname: ps\ndescription: plugin skill\n---\n');
put(path.join(C, 'plugins', 'marketplaces', 'mk', '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'mk', plugins: [{ name: 'a' }, { name: 'b' }] }));
put(path.join(C, 'plugins', 'marketplaces', 'mk', 'x', 'skills', 'cat', 'SKILL.md'), '---\nname: catalog-only\n---\n');
put(path.join(C, 'plugins', 'known_marketplaces.json'), JSON.stringify({ mk: { source: { source: 'github', repo: 'o/mk' }, installLocation: path.join(C, 'plugins', 'marketplaces', 'mk') } }));
put(path.join(C, 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: Reviews code\n---\n');
put(path.join(C, 'commands', 'ship.md'), '---\ndescription: Ship it\n---\n');
put(path.join(C, 'settings.json'), JSON.stringify({ enabledPlugins: { 'p1@mk': false } }));
put(path.join(C, 'projects', 'C--proj', 'memory', 'MEMORY.md'), '- x');
put(path.join(PROJ, '.claude', 'skills', 'proj-skill', 'SKILL.md'), '---\nname: proj-skill\ndescription: project skill\n---\n');

const pl = require('../main/data/plugins');

test('parseFrontmatter handles quoted values containing colons', () => {
  assert.deepEqual(pl.parseFrontmatter('---\nname: a\ndescription: "x: y"\n---\nbody'), { name: 'a', description: 'x: y' });
  assert.deepEqual(pl.parseFrontmatter('no frontmatter'), {});
  assert.equal(pl.parseFrontmatter('---\ndescription: "say \\"hi\\" now"\n---').description, 'say "hi" now');
});

test('inventory finds skills from user, plugins and projects but not marketplace catalogs', () => {
  const inv = pl.inventory([PROJ]);
  const names = inv.skills.map((s) => s.name).sort();
  assert.deepEqual(names, ['my-skill', 'proj-skill', 'ps']);
  assert.equal(inv.skills.find((s) => s.name === 'my-skill').description, 'Does: things, quoted');
  assert.equal(inv.skills.find((s) => s.name === 'proj-skill').scope, 'project');
  assert.equal(inv.skills.find((s) => s.name === 'ps').scope, 'plugin:p1');
});

test('inventory lists plugins, marketplaces, agents, commands, memory', () => {
  const inv = pl.inventory([PROJ]);
  assert.equal(inv.plugins.length, 1);
  assert.equal(inv.plugins[0].name, 'p1');
  assert.equal(inv.marketplaces[0].name, 'mk');
  assert.equal(inv.marketplaces[0].available, 2);
  assert.equal(inv.agents[0].name, 'reviewer');
  assert.equal(inv.commands[0].name, 'ship');
  assert.equal(inv.commands[0].description, 'Ship it');
  assert.equal(inv.memory.length, 1);
  assert.equal(inv.memory[0].files.length, 1);
});

test('missing directories yield empty arrays', () => {
  const saved = process.env.CCD_USER_HOME;
  process.env.CCD_USER_HOME = path.join(tmp, 'empty-home');
  const inv = pl.inventory([]);
  process.env.CCD_USER_HOME = saved;
  for (const k of ['plugins', 'marketplaces', 'skills', 'agents', 'commands', 'memory']) assert.deepEqual(inv[k], []);
});

test('createFromTemplate writes a starter file with frontmatter', () => {
  const p = pl.createFromTemplate('skill', 'user', 'new-thing', []);
  assert.equal(p, path.join(C, 'skills', 'new-thing', 'SKILL.md'));
  assert.ok(fs.readFileSync(p, 'utf8').startsWith('---\nname: new-thing'));
  const a = pl.createFromTemplate('agent', 'project', 'helper', [PROJ], PROJ);
  assert.equal(a, path.join(PROJ, '.claude', 'agents', 'helper.md'));
  assert.throws(() => pl.createFromTemplate('skill', 'user', '../evil', []), /Invalid name/);
  assert.throws(() => pl.createFromTemplate('skill', 'user', 'new-thing', []), /already exists/);
});
