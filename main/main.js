'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Tray, Menu, Notification, nativeImage, session } = require('electron');
const paths = require('./paths');
const transcripts = require('./data/transcripts');
const { createRunner } = require('./runner');
const { watchDir } = require('./data/watch');
const ipc = require('./ipc');

let win = null;
let tray = null;

// Rounded orange tile with a white "C"-ish ring, drawn as a BGRA bitmap (no image files needed).
function makeIcon(size = 32) {
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const r = size * 0.22;
    const dx = Math.max(0, Math.abs(x - c) - (c - r)), dy = Math.max(0, Math.abs(y - c) - (c - r));
    const inside = dx * dx + dy * dy <= r * r;
    if (!inside) continue;
    const d = Math.hypot(x - c, y - c);
    const ring = d > size * 0.2 && d < size * 0.32 && !(x > c && Math.abs(y - c) < size * 0.12);
    const [R, G, B] = ring ? [255, 255, 255] : [217, 119, 87];
    buf[i] = B; buf[i + 1] = G; buf[i + 2] = R; buf[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function readOverrides() {
  try { return JSON.parse(fs.readFileSync(path.join(paths.appDataDir(), 'pricing.json'), 'utf8')); } catch { return {}; }
}

const fmtTokens = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1000, minHeight: 640,
    backgroundColor: '#0f1115', title: 'Claude Code Dashboard', icon: makeIcon(64), autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  // Links open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) require('electron').shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('closed', () => { win = null; });
  if (process.env.CCD_SMOKE) runSmoke(win);
}

// Smoke test: CCD_SMOKE=<dir> visits every view, saves screenshots and reports console errors, then quits.
function runSmoke(w) {
  const outDir = process.env.CCD_SMOKE;
  const views = (process.env.CCD_SMOKE_VIEWS || 'overview,sessions,projects,tools,history,settings,permissions,hooks,mcp,extensions,memory,backups,run,actions').split(',');
  const errors = [];
  w.webContents.on('console-message', (e) => {
    const level = e.level != null ? e.level : e;
    if (String(e.message || '').startsWith('SAVE-SMOKE')) process.stdout.write(e.message + '\n');
    if (level === 'error' || level === 3) errors.push(`${e.message || ''} (${e.sourceId || ''}:${e.lineNumber || ''})`);
  });
  w.webContents.once('did-finish-load', async () => {
    fs.mkdirSync(outDir, { recursive: true });
    for (const v of views) {
      await w.webContents.executeJavaScript(`location.hash = '#/${v}'`);
      await new Promise((r) => setTimeout(r, 1500));
      const banner = await w.webContents.executeJavaScript(`(document.querySelector('.banner:not(.info)')||{}).textContent||''`);
      if (banner) errors.push(`[${v}] banner: ${banner}`);
      const img = await w.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, `${v.replace(/[^\w-]/g, '_')}.png`), img.toPNG());
      process.stdout.write(`SMOKE view ${v} ok\n`);
    }
    if (process.env.CCD_SMOKE_SCRIPT) {
      await w.webContents.executeJavaScript(fs.readFileSync(process.env.CCD_SMOKE_SCRIPT, 'utf8'));
      await new Promise((r) => setTimeout(r, Number(process.env.CCD_SMOKE_WAIT || 5000)));
      const img = await w.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, 'script-final.png'), img.toPNG());
      const out = await w.webContents.executeJavaScript(`document.querySelector('#main').innerText.slice(0, 3000)`);
      process.stdout.write(`SMOKE script text:\n${out}\n`);
    }
    process.stdout.write(`SMOKE errors ${errors.length}\n${errors.join('\n')}\nSMOKE done\n`);
    app.exit(errors.length ? 1 : 0);
  });
}

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders,
      'Content-Security-Policy': ["default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:"] } });
  });

  const index = transcripts.createIndex(paths.projectsDir(), readOverrides);
  const runner = createRunner();

  const updateTray = () => {
    if (!tray) return;
    const st = index.stats({ from: new Date().setHours(0, 0, 0, 0) });
    const label = `Today: ${fmtTokens(st.tokens.total)} tokens · $${st.costUsd.toFixed(2)} (est.)`;
    tray.setToolTip(`Claude Code Dashboard\n${label}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label, enabled: false },
      { type: 'separator' },
      { label: 'Show dashboard', click: () => { if (!win) createWindow(); else { win.show(); win.focus(); } } },
      { label: 'Quit', click: () => app.quit() },
    ]));
  };

  ipc.register({
    index, runner, getWindow: () => win,
    onRunFinished: (opts, ev) => {
      if (!Notification.isSupported()) return;
      const ok = ev.type === 'exit' && ev.code === 0;
      new Notification({
        title: ok ? 'Claude run finished' : 'Claude run failed',
        body: String(opts.prompt || '').slice(0, 80) || (ev.message || `exit ${ev.code}`),
        icon: makeIcon(64),
      }).show();
    },
  });

  await index.refresh();
  createWindow();

  tray = new Tray(makeIcon(16));
  tray.on('click', () => { if (!win) createWindow(); else { win.show(); win.focus(); } });
  updateTray();

  watchDir(paths.projectsDir(), async () => {
    await index.refresh();
    updateTray();
    if (win && !win.isDestroyed()) win.webContents.send('transcripts-changed');
  });

  app.on('activate', () => { if (!win) createWindow(); });
});

// Keep running in the tray when the window is closed on Windows; quit from the tray menu.
app.on('window-all-closed', () => { if (process.platform === 'darwin') return; });
