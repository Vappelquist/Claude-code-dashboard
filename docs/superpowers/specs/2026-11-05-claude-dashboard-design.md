# Claude Code Dashboard — Design Spec

Date: 2026-11-05
Status: Approved in conversation, pending written-spec review

## Goal

A local Electron desktop app that gives one place to (1) understand Claude Code usage,
(2) manage Claude Code configuration safely, and (3) launch and drive Claude Code sessions.

## Decisions (from the user)

- Scope: Insight + Control + Command Center (all three).
- Config edits: read/write, **always** with a timestamped backup and a diff confirmation before saving.
- Platform: Electron desktop app (Windows 11, Node 24 available; no Python).

## Non-goals / Not possible locally

- Real plan quota / remaining usage, org billing (not exposed on disk).
- Attaching to a `claude` process running in another terminal (its transcript is shown live instead).
- Embedded PTY terminal (native module; replaced by "Open in Windows Terminal").

## Architecture

```
package.json           devDependency: electron only. `npm start` launches.
main/
  main.js              BrowserWindow, Tray, app lifecycle, notifications
  preload.js           contextBridge: exposes window.api.<method>() only
  ipc.js               registers every ipcMain.handle; the only gateway to fs/processes
  paths.js             resolves ~/.claude, ~/.claude.json, project dirs
  data/transcripts.js  parse projects/**/*.jsonl; mtime+size cache; aggregate stats
  data/history.js      parse history.jsonl
  data/config.js       read/write settings (user/project/local), .claude.json, .mcp.json, CLAUDE.md
  data/plugins.js      plugins, marketplaces, skills, agents, commands
  data/pricing.js      per-model $/MTok table (input, output, cache write 5m/1h, cache read); user-overridable
  data/backup.js       backup-before-write, list, diff, restore
  data/watch.js        fs.watch on ~/.claude/projects → push "transcripts-changed" to renderer
  runner.js            spawn `claude -p --output-format stream-json --verbose`; stream events; stop; WT launcher
renderer/
  index.html, app.css, app.js (router, Ctrl+K search)
  lib/ (dom helpers, charts in SVG, json diff, markdown-lite renderer)
  views/ one module per tab
```

Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict CSP.
Writes are only allowed to paths under `~/.claude`, `~/.claude.json`, or a known project's
`.claude/`, `.mcp.json`, `CLAUDE.md` — validated in main.

## Data model

Transcript lines of interest: `type: user|assistant|system`, `message.model`,
`message.usage` (input, output, cache_creation, cache_read, ephemeral 5m/1h split),
`message.content[]` (text, thinking, tool_use, tool_result), `timestamp`, `cwd`,
`gitBranch`, `sessionId`, `isSidechain`, `version`. Assistant entries are de-duplicated by
`message.id` (streaming may write several lines per message) before summing usage.

Session summary: id, project, cwd, branch, first/last timestamp, first prompt (title),
message counts, tokens by type, cost, models, tool counts, error count.

Cost = Σ tokens × price(model). Labeled "API-equivalent estimate". Unknown models → $0 + flag.

## Views

Insight: Overview (KPIs today/7d/30d/all, heatmap, daily tokens by model, cache hit rate,
streak) · Sessions (filterable list + full replay with thinking/tool calls/subagents, per-turn
tokens/cost, resume/open-in-terminal/export Markdown) · Projects (cards + CLAUDE.md + memory) ·
Tools & Models (frequency, errors, top Bash commands, top edited files, model split, MCP tools) ·
Prompt History (full-text search, copy, send to Command Center).

Control: Settings (form + raw JSON, user/project/local scopes) · Permissions (allow/ask/deny
lists, defaultMode) · Hooks (per event, matchers, commands, templates) · MCP servers
(user + project, add stdio/http, edit, remove, disable) · Plugins/Skills/Agents/Commands
(view, create from template) · Memory & CLAUDE.md editor · Backups (browse, diff, restore).

Command Center: tabbed runs (cwd, model, permission mode, optional resume id), streaming
messages with tool cards, token/cost meter, stop, session id; prompt templates; open
folder/session in Windows Terminal (`wt` fallback to `cmd /c start`); `claude --version` check.

Extras: Ctrl+K global search, dark theme, tray with today's tokens, notification on run finish.

## Error handling

- Malformed JSONL lines are skipped and counted; never crash a parse.
- Missing files/dirs → empty state with explanation, not an error.
- Write path: validate JSON → backup → write to temp → rename. On failure, file untouched, error toast.
- `claude` not on PATH → Command Center shows install hint; other tabs unaffected.

## Testing

`node --test` unit tests for pure modules: transcript parsing/aggregation (dedupe, cost),
history parsing, backup/restore round-trip, path-guard, pricing. Manual smoke test of the
Electron app via `npm start`.
