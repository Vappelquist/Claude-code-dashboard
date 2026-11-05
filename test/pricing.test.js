const test = require('node:test');
const assert = require('node:assert/strict');
const { costOf } = require('../main/data/pricing');

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('input + output priced per MTok', () => {
  const r = costOf('claude-opus-5-5', { input_tokens: 1e6, output_tokens: 1e6 });
  close(r.usd, 24); assert.equal(r.known, true);
});
test('cache read uses model-specific read price', () => {
  close(costOf('claude-opus-5-5', { cache_read_input_tokens: 1e6 }).usd, 0.20);
});
test('cache read defaults to 0.1x input', () => {
  close(costOf('claude-opus-4-8', { cache_read_input_tokens: 1e6 }).usd, 0.5);
});
test('1h cache write is 2x input', () => {
  close(costOf('claude-sonnet-5-5', { cache_creation_input_tokens: 1e6,
    cache_creation: { ephemeral_1h_input_tokens: 1e6, ephemeral_5m_input_tokens: 0 } }).usd, 4);
});
test('cache write without breakdown is 1.25x input', () => {
  close(costOf('claude-sonnet-5-5', { cache_creation_input_tokens: 1e6 }).usd, 2.5);
});
test('[1m] and date suffixes resolve to the base model', () => {
  close(costOf('claude-opus-5-5[1m]', { input_tokens: 1e6 }).usd, 4);
  close(costOf('claude-haiku-4-5-20251001', { input_tokens: 1e6 }).usd, 1);
});
test('unknown model costs 0 and is flagged', () => {
  assert.deepEqual(costOf('unknown-x', { input_tokens: 5 }), { usd: 0, known: false });
});
test('overrides change only the given rate', () => {
  const r = costOf('claude-opus-5-5', { input_tokens: 1e6, output_tokens: 1e6 }, { 'claude-opus-5-5': { input: 1 } });
  close(r.usd, 21);
});
test('missing usage is zero cost', () => {
  close(costOf('claude-opus-5-5', undefined).usd, 0);
});
