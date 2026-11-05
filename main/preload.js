'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = [
  'sessions.list', 'sessions.get', 'sessions.exportMarkdown', 'sessions.live', 'stats.get',
  'history.list', 'config.locations', 'config.read', 'config.preview', 'config.write',
  'backups.list', 'backups.read', 'backups.restore', 'inventory.get', 'inventory.create',
  'pricing.get', 'pricing.set', 'runner.start', 'runner.stop', 'runner.version',
  'terminal.open', 'shell.openPath', 'clipboard.write', 'dialog.pickFolder', 'dialog.saveText',
  'templates.list', 'templates.save', 'projects.known', 'file.read', 'mcp.list', 'mcp.plan', 'mcp.apply',
];
const PUSH = ['transcripts-changed', 'runner-event'];

const api = {};
for (const ch of CHANNELS) api[ch] = (...args) => ipcRenderer.invoke(ch, ...args);
api.on = (channel, cb) => {
  if (!PUSH.includes(channel)) throw new Error(`Unknown channel ${channel}`);
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('api', api);
