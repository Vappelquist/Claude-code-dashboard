const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createRunner, parseLines, buildArgs } = require('../main/runner');

const FAKE = { cmd: process.execPath, args: [path.join(__dirname, 'fixtures', 'fake-claude.js')], shell: false };

function collect(runner, opts, env) {
  return new Promise((resolve) => {
    const events = [];
    const old = process.env.FAKE_CLAUDE_MODE;
    process.env.FAKE_CLAUDE_MODE = env || 'ok';
    runner.start({ runId: 'r1', cwd: __dirname, ...opts }, (e) => {
      events.push(e);
      if (e.type === 'exit' || e.type === 'error') resolve(events);
    });
    process.env.FAKE_CLAUDE_MODE = old;
  });
}

test('parseLines splits complete lines and keeps the rest', () => {
  assert.deepEqual(parseLines('{"a":1}\n{"b"'), { lines: ['{"a":1}'], rest: '{"b"' });
  assert.deepEqual(parseLines('x\r\ny\n'), { lines: ['x', 'y'], rest: '' });
});

test('buildArgs maps options to CLI flags', () => {
  assert.deepEqual(buildArgs({ model: 'claude-opus-5-5', permissionMode: 'plan', resume: 'abc' }),
    ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'claude-opus-5-5', '--permission-mode', 'plan', '--resume', 'abc']);
  assert.deepEqual(buildArgs({}), ['-p', '--output-format', 'stream-json', '--verbose']);
});

test('start streams parsed JSON events then exit 0; prompt goes via stdin', async () => {
  const ev = await collect(createRunner({ claude: FAKE }), { prompt: 'hello' });
  const data = ev.filter((e) => e.type === 'event').map((e) => e.data);
  assert.equal(data.length, 3);
  assert.equal(data[0].subtype, 'init');
  assert.equal(data[1].message.content[0].text, 'echo:hello');
  assert.deepEqual(ev.at(-1), { type: 'exit', code: 0 });
});

test('failure emits stderr and non-zero exit', async () => {
  const ev = await collect(createRunner({ claude: FAKE }), { prompt: 'x' }, 'fail');
  assert.ok(ev.some((e) => e.type === 'stderr' && /not logged in/.test(e.text)));
  assert.deepEqual(ev.at(-1), { type: 'exit', code: 2 });
});

test('nonexistent command reports error or non-zero exit without throwing', async () => {
  const r = createRunner({ claude: { cmd: 'definitely-not-a-real-cmd-xyz', args: [], shell: false } });
  const ev = await collect(r, { prompt: 'x' });
  const last = ev.at(-1);
  assert.ok(last.type === 'error' || (last.type === 'exit' && last.code !== 0));
});

test('stop kills a running process', async () => {
  const r = createRunner({ claude: FAKE });
  const p = collect(r, { prompt: 'x' }, 'hang');
  await new Promise((res) => setTimeout(res, 300));
  assert.equal(r.isRunning('r1'), true);
  r.stop('r1');
  const ev = await p;
  assert.equal(ev.at(-1).type, 'exit');
  assert.equal(r.isRunning('r1'), false);
});

test('version returns null when the command is missing', async () => {
  const r = createRunner({ claude: { cmd: 'definitely-not-a-real-cmd-xyz', args: [], shell: false } });
  assert.equal(await r.version(), null);
});
