'use strict';
const child_process = require('child_process');

const DEFAULT_CLAUDE = { cmd: 'claude', args: [], shell: process.platform === 'win32' };
const SAFE_ARG = /^[\w.:@\-\/\[\]]+$/;

function parseLines(buffer) {
  const parts = buffer.split('\n');
  const rest = parts.pop();
  return { lines: parts.map((l) => l.replace(/\r$/, '')).filter((l) => l.length), rest };
}

function buildArgs({ model, permissionMode, resume } = {}) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  for (const [flag, v] of [['--model', model], ['--permission-mode', permissionMode], ['--resume', resume]]) {
    if (!v) continue;
    // Arguments may pass through a shell on Windows; only allow plain tokens.
    if (!SAFE_ARG.test(v)) throw new Error(`Invalid value for ${flag}: ${v}`);
    args.push(flag, v);
  }
  return args;
}

// cmd.exe metacharacters (and wt's ';' separator) that cannot be safely quoted in a folder path.
const UNSAFE_CWD = /["&|<>^%;!\r\n]/;
function checkCwd(cwd) {
  if (!cwd || UNSAFE_CWD.test(cwd)) throw new Error(`Unsupported characters in folder path for terminal launch: ${cwd}`);
}
/** Command line for `cmd.exe /c <this>` (run with windowsVerbatimArguments). */
function terminalFallbackCommand(cwd, resume) {
  checkCwd(cwd);
  if (resume && !SAFE_ARG.test(resume)) throw new Error('Invalid session id');
  return `start "" /D "${cwd}" cmd /k claude${resume ? ` --resume ${resume}` : ''}`;
}

function killTree(child) {
  if (!child || child.exitCode != null) return;
  if (process.platform === 'win32') {
    try { child_process.spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); }
    catch { child.kill(); }
  } else {
    child.kill('SIGTERM');
  }
}

function createRunner({ claude = DEFAULT_CLAUDE, spawnFn = child_process.spawn } = {}) {
  const runs = new Map();
  // With shell:true Node concatenates args anyway; pass one string (all args are validated safe tokens).
  const spawnClaude = (args, opts) => (claude.shell
    ? spawnFn([claude.cmd, ...args].join(' '), { ...opts, shell: true })
    : spawnFn(claude.cmd, args, opts));

  function start({ runId, prompt, cwd, model, permissionMode, resume }, onEvent) {
    let args;
    try { args = [...claude.args, ...buildArgs({ model, permissionMode, resume })]; }
    catch (e) { onEvent({ type: 'error', message: e.message }); return; }
    let child;
    let done = false;
    const finish = (ev) => { if (done) return; done = true; runs.delete(runId); onEvent(ev); };
    try {
      child = spawnClaude(args, { cwd: cwd || undefined, windowsHide: true, env: process.env });
    } catch (e) {
      finish({ type: 'error', message: e.message });
      return;
    }
    runs.set(runId, child);
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const { lines, rest } = parseLines(buf + chunk);
      buf = rest;
      for (const line of lines) {
        try { onEvent({ type: 'event', data: JSON.parse(line) }); }
        catch { onEvent({ type: 'stderr', text: line }); }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text) => onEvent({ type: 'stderr', text }));
    child.on('error', (e) => finish({ type: 'error', message: e.message }));
    child.on('close', (code) => {
      if (buf.trim()) {
        try { onEvent({ type: 'event', data: JSON.parse(buf) }); } catch { onEvent({ type: 'stderr', text: buf }); }
      }
      finish({ type: 'exit', code: code == null ? -1 : code });
    });
    child.stdin.on('error', () => { /* process may exit before reading stdin */ });
    child.stdin.end(String(prompt || ''));
  }

  function stop(runId) { killTree(runs.get(runId)); }
  const isRunning = (runId) => runs.has(runId);

  function version() {
    return new Promise((resolve) => {
      let out = '';
      let child;
      try {
        child = spawnClaude([...claude.args, '--version'], { windowsHide: true });
      } catch { resolve(null); return; }
      child.stdout.on('data', (d) => { out += d; });
      child.on('error', () => resolve(null));
      child.on('close', (code) => resolve(code === 0 && out.trim() ? out.trim() : null));
      setTimeout(() => { killTree(child); resolve(null); }, 15000);
    });
  }

  function openTerminal({ cwd, resume } = {}) {
    if (resume && !SAFE_ARG.test(resume)) throw new Error('Invalid session id');
    if (process.platform === 'win32') checkCwd(cwd);
    const claudeArgs = ['claude', ...(resume ? ['--resume', resume] : [])];
    if (process.platform !== 'win32') {
      const c = spawnFn('x-terminal-emulator', ['-e', ...claudeArgs], { cwd, detached: true, stdio: 'ignore' });
      c.on('error', () => {});
      c.unref();
      return;
    }
    const fallback = () => {
      const c = spawnFn('cmd.exe', ['/d', '/s', '/c', `"${terminalFallbackCommand(cwd, resume)}"`],
        { detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
      c.on('error', () => {});
      c.unref();
    };
    try {
      const c = spawnFn('wt.exe', ['-d', cwd, 'cmd', '/k', ...claudeArgs], { detached: true, stdio: 'ignore' });
      c.on('error', fallback);
      c.unref();
    } catch { fallback(); }
  }

  return { start, stop, isRunning, version, openTerminal };
}

module.exports = { createRunner, parseLines, buildArgs, terminalFallbackCommand };
