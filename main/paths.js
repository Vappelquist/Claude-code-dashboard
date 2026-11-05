'use strict';
const os = require('os');
const path = require('path');

const userHome = () => process.env.CCD_USER_HOME || os.homedir();
const claudeDir = () => path.join(userHome(), '.claude');
const claudeJson = () => path.join(userHome(), '.claude.json');
const projectsDir = () => path.join(claudeDir(), 'projects');
const historyFile = () => path.join(claudeDir(), 'history.jsonl');
// Outside the project folder (which may be cloud-synced): backups contain config that can hold secrets.
const appDataDir = () => process.env.CCD_HOME
  || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'claude-dashboard');
const backupsDir = () => path.join(appDataDir(), 'backups');

module.exports = { userHome, claudeDir, claudeJson, projectsDir, historyFile, appDataDir, backupsDir };
