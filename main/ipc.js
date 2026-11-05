'use strict';
const fs = require('fs');
const path = require('path');
const { ipcMain, shell, clipboard, dialog, BrowserWindow } = require('electron');
const paths = require('./paths');
const transcripts = require('./data/transcripts');
const history = require('./data/history');
const config = require('./data/config');
const backup = require('./data/backup');
const guard = require('./data/guard');
const plugins = require('./data/plugins');
const mcp = require('./data/mcp');
const { exportMarkdown } = require('./data/export');
const { DEFAULT_PRICES } = require('./data/pricing');

const appFile = (name) => path.join(paths.appDataDir(), name);
const readAppJson = (name, dflt) => { try { return JSON.parse(fs.readFileSync(appFile(name), 'utf8')); } catch { return dflt; } };
const writeAppJson = (name, data) => {
  fs.mkdirSync(paths.appDataDir(), { recursive: true });
  fs.writeFileSync(appFile(name), JSON.stringify(data, null, 2));
};

function liveSessions() {
  const dir = path.join(paths.claudeDir(), 'sessions');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      let alive = false;
      try { process.kill(j.pid, 0); alive = true; } catch (e) { alive = e.code === 'EPERM'; }
      if (!alive) continue;
      out.push({ pid: j.pid, sessionId: j.sessionId, cwd: j.cwd, status: j.status, name: j.name,
        kind: j.kind, entrypoint: j.entrypoint, version: j.version, startedAt: j.startedAt, updatedAt: j.updatedAt });
    } catch { /* skip */ }
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function register({ index, runner, getWindow, onRunFinished }) {
  const knownProjects = () => {
    const set = new Set(index.knownProjects());
    const cj = config.readJson(paths.claudeJson()).data;
    if (cj && cj.projects) for (const p of Object.keys(cj.projects)) set.add(p);
    // ~/.claude.json uses forward slashes, transcripts use backslashes: normalize and dedupe case-insensitively.
    const seen = new Map();
    for (const p of set) {
      const n = path.resolve(p);
      const k = n.toLowerCase();
      if (!seen.has(k)) seen.set(k, n);
    }
    return [...seen.values()].filter((p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } }).sort();
  };
  const handle = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => fn(...args));
  const rangeOf = (r) => {
    const now = Date.now();
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    if (r === 'today') return { from: startOfToday.getTime() };
    if (r === '7d') return { from: now - 7 * 864e5 };
    if (r === '30d') return { from: now - 30 * 864e5 };
    if (r && typeof r === 'object') return r;
    return {};
  };

  handle('sessions.list', () => index.list());
  handle('sessions.get', (id) => index.getSession(id));
  handle('sessions.exportMarkdown', (id) => { const s = index.getSession(id); return s ? exportMarkdown(s) : null; });
  handle('sessions.live', () => liveSessions());
  handle('stats.get', (r) => index.stats(rangeOf(r)));
  handle('history.list', (q) => history.searchHistory(history.readHistory(paths.historyFile()), q).slice(0, 2000));
  handle('projects.known', () => knownProjects());

  handle('config.locations', () => config.locations(knownProjects()));
  handle('config.read', (p) => {
    if (!guard.isWritable(p, knownProjects())) throw new Error(`Path not allowed: ${p}`);
    return config.readJson(p);
  });
  handle('config.preview', (p, text) => {
    if (!guard.isWritable(p, knownProjects())) throw new Error(`Path not allowed: ${p}`);
    return config.diffLines(config.readText(p) || '', text);
  });
  handle('config.write', (p, text, json, expected) => config.writeText(p, text, { json: !!json, knownProjects: knownProjects(), expected }));
  handle('file.read', (p) => {
    if (!guard.isWritable(p, knownProjects())) throw new Error(`Path not allowed: ${p}`);
    return config.readText(p);
  });

  handle('mcp.list', () => mcp.list(knownProjects()));
  handle('mcp.plan', (change) => mcp.plan(change, knownProjects()));
  handle('mcp.apply', (change) => mcp.apply(change, knownProjects()));

  handle('backups.list', () => backup.list());
  handle('backups.read', (id) => backup.read(id));
  handle('backups.restore', (id) => backup.restore(id, knownProjects()));

  handle('inventory.get', () => plugins.inventory(knownProjects()));
  handle('inventory.create', (kind, scope, name, project) => plugins.createFromTemplate(kind, scope, name, knownProjects(), project));

  handle('pricing.get', () => ({ defaults: DEFAULT_PRICES, overrides: readAppJson('pricing.json', {}) }));
  handle('pricing.set', async (overrides) => {
    writeAppJson('pricing.json', overrides || {});
    index.invalidate();
    await index.refresh();
    const w = getWindow(); if (w) w.webContents.send('transcripts-changed');
    return true;
  });

  handle('templates.list', () => readAppJson('templates.json', [
    { name: 'Explain this repo', prompt: 'Give me a concise tour of this repository: structure, main entry points, and how to run it.' },
    { name: 'Find bugs', prompt: 'Review the code in this project for likely bugs. List them with file:line and a one-line fix each. Do not edit files.' },
    { name: 'Write tests', prompt: 'Find the least-tested module in this project and propose unit tests for it.' },
  ]));
  handle('templates.save', (list) => { writeAppJson('templates.json', list || []); return true; });

  let runSeq = 0;
  handle('runner.start', (opts) => {
    const runId = `run-${Date.now()}-${++runSeq}`;
    runner.start({ ...opts, runId }, (ev) => {
      const w = getWindow();
      if (w && !w.isDestroyed()) w.webContents.send('runner-event', { runId, ...ev });
      if (ev.type === 'exit' || ev.type === 'error') onRunFinished(opts, ev);
    });
    return runId;
  });
  handle('runner.stop', (runId) => runner.stop(runId));
  handle('runner.version', () => runner.version());
  handle('terminal.open', (opts) => runner.openTerminal(opts || {}));

  handle('shell.openPath', (p) => {
    if (!guard.isOpenable(p, knownProjects())) throw new Error(`Path not allowed: ${p}`);
    return shell.openPath(p);
  });
  handle('clipboard.write', (t) => clipboard.writeText(String(t)));
  handle('dialog.pickFolder', async () => {
    const r = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), { properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('dialog.saveText', async (defaultName, text) => {
    const r = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow(), { defaultPath: defaultName });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, text, 'utf8');
    return r.filePath;
  });

  return { knownProjects, readPricing: () => readAppJson('pricing.json', {}) };
}

module.exports = { register, liveSessions };
