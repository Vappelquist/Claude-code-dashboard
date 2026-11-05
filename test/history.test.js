const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readHistory, searchHistory } = require('../main/data/history');
const F = path.join(__dirname, 'fixtures', 'history.jsonl');

test('reads newest first, skipping malformed lines', () => {
  const h = readHistory(F);
  assert.deepEqual(h.map((x) => x.text), ['Second about README', 'third', 'first prompt']);
  assert.deepEqual(h[0], { text: 'Second about README', timestamp: 3000, project: 'C:\\b', sessionId: 'y' });
});
test('search is case-insensitive over text and project', () => {
  const r = searchHistory(readHistory(F), 'readme');
  assert.deepEqual(r.map((x) => x.text), ['Second about README', 'third']);
});
test('empty query returns everything', () => {
  assert.equal(searchHistory(readHistory(F), '').length, 3);
});
test('missing file returns empty array', () => {
  assert.deepEqual(readHistory(path.join(__dirname, 'nope.jsonl')), []);
});
