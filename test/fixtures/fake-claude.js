// Fake `claude` CLI for runner tests. Mode via FAKE_CLAUDE_MODE: ok | fail | hang
const mode = process.env.FAKE_CLAUDE_MODE || 'ok';
let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', () => {
  if (mode === 'fail') {
    process.stderr.write('boom: not logged in\n');
    process.exit(2);
  }
  const args = process.argv.slice(2);
  const ev = [
    { type: 'system', subtype: 'init', session_id: 'sess-1', model: 'claude-opus-5-5', args },
    { type: 'assistant', message: { content: [{ type: 'text', text: `echo:${input.trim()}` }], usage: { input_tokens: 1, output_tokens: 2 } } },
    { type: 'result', subtype: 'success', total_cost_usd: 0.01, session_id: 'sess-1' },
  ];
  // Write the second event in two chunks to exercise line buffering.
  process.stdout.write(JSON.stringify(ev[0]) + '\n');
  const s = JSON.stringify(ev[1]) + '\n';
  process.stdout.write(s.slice(0, 10));
  setTimeout(() => {
    process.stdout.write(s.slice(10));
    if (mode === 'hang') { setInterval(() => {}, 1000); return; }
    process.stdout.write(JSON.stringify(ev[2]) + '\n');
    process.exit(0);
  }, 20);
});
