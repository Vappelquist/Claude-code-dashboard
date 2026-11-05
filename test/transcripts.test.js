const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const T = require('../main/data/transcripts');

const PROJ = path.join(__dirname, 'fixtures', 'projects');
const S1 = path.join(PROJ, 'C--proj-a', 's1.jsonl');

test('repeated assistant message id counts usage once', () => {
  const s = T.parseSessionFile(S1);
  assert.equal(s.tokens.output, 150);
  assert.equal(s.tokens.input, 15);
  assert.equal(s.tokens.cacheRead, 1000);
  assert.equal(s.tokens.cacheWrite, 500);
  assert.equal(s.assistantMsgs, 2);
});
test('tool counts, errors, bash commands, edited files, mcp', () => {
  const s = T.parseSessionFile(S1);
  assert.equal(s.tools.Bash, 1);
  assert.equal(s.tools.Edit, 1);
  assert.equal(s.tools['mcp__x__y'], 1);
  assert.equal(s.toolErrors, 1);
  assert.deepEqual(s.bashCommands, ['npm test']);
  assert.deepEqual(s.editedFiles, ['src/a.js']);
});
test('malformed line counted, truncated tail not counted', () => {
  assert.equal(T.parseSessionFile(S1).skippedLines, 1);
});
test('prompts exclude tool results and meta; title is first prompt truncated to 80', () => {
  const s = T.parseSessionFile(S1);
  assert.equal(s.userMsgs, 2);
  assert.equal(s.title.length, 80);
  assert.ok(s.title.startsWith('Please fix the failing tests'));
});
test('metadata and cost', () => {
  const s = T.parseSessionFile(S1);
  assert.equal(s.id, 's1'); assert.equal(s.cwd, 'C:\\proj\\a'); assert.equal(s.gitBranch, 'main');
  assert.equal(s.projectKey, 'C--proj-a');
  assert.equal(s.models['claude-opus-5-5'], 2);
  // opus 5.5: in 15*4 + out 150*20 + read 1000*0.2 + 1h write 500*8
  assert.ok(Math.abs(s.costUsd - (15*4 + 150*20 + 1000*0.2 + 500*8) / 1e6) < 1e-12);
  assert.equal(s.unknownModel, false);
  assert.ok(Array.isArray(s.entries) && s.entries.length > 0);
});
test('index refresh, stats by day, cache hit rate, caching', async () => {
  const idx = T.createIndex(PROJ);
  const list = await idx.refresh();
  assert.equal(list.length, 2);
  assert.equal(list[0].entries, undefined);
  const st = idx.stats({});
  assert.equal(st.sessions, 2);
  assert.equal(st.prompts, 2); // sidechain prompts are agent-authored, not counted
  assert.equal(st.byDay.length, 2);
  assert.ok(Math.abs(st.cacheHitRate - 1000 / (1000 + 500 + 1000015)) < 1e-12);
  assert.equal(st.byTool.Bash.errors, 1);
  assert.equal(st.topBash[0].cmd, 'npm test');
  assert.equal(st.mcpTools['mcp__x__y'], 1);
  assert.equal(st.byProject.length, 1);
  const before = idx.parseCount();
  await idx.refresh();
  assert.equal(idx.parseCount(), before);
  assert.ok(idx.getSession('s1').entries.length > 0);
  assert.equal(idx.getSession('nope'), null);
});
test('stats date range filters sessions', async () => {
  const idx = T.createIndex(PROJ);
  await idx.refresh();
  const st = idx.stats({ from: Date.parse('2026-11-02T00:00:00Z') });
  assert.equal(st.sessions, 1);
});
test('missing projects dir gives empty list', async () => {
  const idx = T.createIndex(path.join(PROJ, 'does-not-exist'));
  assert.deepEqual(await idx.refresh(), []);
});
