# Claude Code Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Electron desktop app with Insight, Control and Command Center sections for Claude Code.

**Architecture:** Main process owns all filesystem and process access (pure CommonJS modules under `main/data/`, unit-tested with `node --test`). A sandboxed renderer (plain ES modules, no framework) calls `window.api.*` exposed by `preload.js`, which maps 1:1 to `ipcMain.handle` channels in `main/ipc.js`.

**Tech Stack:** Electron (only devDependency), Node 24 built-ins (`fs`, `path`, `os`, `child_process`, `node:test`), vanilla HTML/CSS/JS, hand-rolled SVG charts.

**Spec:** `docs/superpowers/specs/2026-11-05-claude-dashboard-design.md`

## Global Constraints

- No runtime npm dependencies. `electron` is the only devDependency. No native modules.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP `default-src 'self'; style-src 'self' 'unsafe-inline'`.
- Every config write: validate → backup → write temp → rename. Backups in `<app>/backups/<ISO-timestamp-safe>__<flattened-path>`.
- Writes allowed only under `~/.claude/`, `~/.claude.json`, or `<knownProject>/.claude/`, `<knownProject>/.mcp.json`, `<knownProject>/CLAUDE.md`, `<knownProject>/CLAUDE.local.md`.
- Costs labeled "API-equivalent estimate" wherever shown.
- Windows-first: paths via `path`/`os.homedir()`; terminal launch via `wt.exe`, fallback `cmd /c start cmd /k`.
- Dark theme only.
- No git repo exists: skip commit steps unless the user runs `git init`.

## Review Focus

1. Transcript files being written while read (partial last line) → the partial line is skipped, not counted as an error, and picked up on the next refresh. (Test in Task 2.)
2. Same assistant `message.id` repeated across several lines → usage counted once. (Test in Task 2.)
3. `settings.json` containing invalid JSON already → Control shows raw editor with parse error, never overwrites silently. (Test in Task 4.)
4. Write target outside the allowed roots (e.g. `..\..\Windows\x`) → rejected in main. (Test in Task 4.)
5. `claude` not on PATH / run exits non-zero → Command Center shows the stderr and exit code, app keeps working. (Test in Task 6.)

---

### Task 1: Scaffold, paths, pricing

**Files:**
- Create: `package.json`, `main/paths.js`, `main/data/pricing.js`, `test/pricing.test.js`

**Interfaces:**
- Produces: `paths.claudeDir()`, `paths.claudeJson()`, `paths.projectsDir()`, `paths.historyFile()`, `paths.appDataDir()` (→ `<repo>/backups` parent; overridable via env `CCD_HOME`). All `~` paths use `process.env.CCD_USER_HOME || os.homedir()` so tests and scratch runs can point at a fake home. `pricing.costOf(model: string, usage: Usage, overrides?: object) → { usd: number, known: boolean }`, `pricing.DEFAULT_PRICES`.
- `Usage = { input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, cache_creation?: { ephemeral_5m_input_tokens, ephemeral_1h_input_tokens } }`.

- [ ] **Step 1:** `package.json`: name `claude-dashboard`, `main: "main/main.js"`, scripts `start: "electron ."`, `test: "node --test test/"`, devDependency `electron` (latest). Run `npm install`.
- [ ] **Step 2: Failing tests** in `test/pricing.test.js`:
  - `costOf('claude-opus-5-5', {input_tokens:1e6,output_tokens:1e6})` → usd `24`, known `true`.
  - `costOf('claude-opus-5-5', {cache_read_input_tokens:1e6})` → `0.20`.
  - 1h write: `{cache_creation_input_tokens:1e6, cache_creation:{ephemeral_1h_input_tokens:1e6, ephemeral_5m_input_tokens:0}}` on `claude-sonnet-5-5` → `4.00` (2× input).
  - 5m write without breakdown on `claude-sonnet-5-5` → `2.50` (1.25×).
  - Model with suffix `claude-opus-5-5[1m]` resolves to the base model.
  - `costOf('unknown-x', …)` → `{usd:0, known:false}`.
  - overrides `{ 'claude-opus-5-5': {input: 1} }` changes the input rate only.
- [ ] **Step 3:** Run `npm test` → FAIL.
- [ ] **Step 4:** Implement. `DEFAULT_PRICES` ($/MTok `{input, output, cacheRead?}`; writes are 1.25× (5m) / 2× (1h) input; cacheRead defaults to 0.1× input):
  `claude-fable-5-1` 10/50 read 0.25 · `claude-fable-5` 10/50 · `claude-mythos-5-1` 10/50 read 0.25 · `claude-opus-5-5` 4/20 read 0.20 · `claude-opus-5` 5/25 · `claude-opus-4-8` `-4-7` `-4-6` 5/25 · `claude-sonnet-5-5` 2/10 read 0.20 · `claude-sonnet-5` 2/10 · `claude-sonnet-4-6` 3/15 · `claude-haiku-5-5` 0.10/0.50 · `claude-haiku-4-5` 1/5.
  Model resolution: strip `[...]` suffix and any `-YYYYMMDD` date suffix, then exact match, then longest-prefix match.
- [ ] **Step 5:** `npm test` → PASS.

### Task 2: Transcript parsing and aggregation

**Files:**
- Create: `main/data/transcripts.js`, `test/transcripts.test.js`, `test/fixtures/projects/C--proj-a/s1.jsonl`, `.../s2.jsonl`

**Interfaces:**
- Consumes: `pricing.costOf`.
- Produces:
  - `parseSessionFile(filePath) → Session` where `Session = { id, projectKey, cwd, gitBranch, version, title, start, end, userMsgs, assistantMsgs, tokens:{input,output,cacheRead,cacheWrite}, costUsd, unknownModel:boolean, models:{[m]:count}, tools:{[name]:count}, toolErrors, bashCommands:string[], editedFiles:string[], skippedLines, entries }`. `entries` is the ordered array of raw parsed lines for replay; omit from list views.
  - `createIndex(projectsDir) → { refresh(): Promise<Session[]> (mtime+size cache; returns summaries without entries), getSession(id) → Session with entries, stats({from?, to?}) → Stats }`.
  - `Stats = { sessions, prompts, tokens, costUsd, byDay:[{date, tokens, costUsd, byModel:{}}], byModel:{}, byTool:{[name]:{count,errors}}, topBash:[{cmd,count}], topFiles:[{path,count}], mcpTools:{}, cacheHitRate, streakDays, byProject:[{projectKey,cwd,sessions,tokens,costUsd,last}] }`.
- [ ] **Step 1: Fixtures** modeled on real lines (see spec Data model): s1 has 2 user prompts, an assistant message `msg_A` written on 3 lines with identical usage, a `tool_use` Bash `{command:"npm test"}`, a `tool_result` with `is_error:true`, an Edit on `src/a.js`, an `mcp__x__y` tool use, a malformed line mid-file, and a truncated final line with no newline. s2 is a sidechain-only file (`isSidechain:true`) for a different day.
- [ ] **Step 2: Failing tests:** usage of `msg_A` counted once; `tools.Bash === 1`, `toolErrors === 1`; `bashCommands` contains `npm test`; `editedFiles` contains `src/a.js`; `skippedLines === 1` (malformed only, the truncated tail is not counted); `title` = first non-meta user text truncated to 80 chars; `stats().byDay` has 2 days; `cacheHitRate = cacheRead/(cacheRead+cacheWrite+input)`; second `refresh()` without file changes does not re-read (spy on `fs.readFileSync` or check a parse counter).
- [ ] **Step 3:** `npm test` → FAIL. **Step 4:** Implement (user prompts = `type:"user"` entries whose content is a string or contains a `text` block and are not `isMeta`/tool_result-only). **Step 5:** PASS.

### Task 3: Prompt history

**Files:** Create `main/data/history.js`, `test/history.test.js`, fixture `test/fixtures/history.jsonl`

**Interfaces:** Produces `readHistory(file) → [{text, timestamp:number, project, sessionId}]` newest first; `searchHistory(items, query) → items` (case-insensitive substring over text and project).
- [ ] Steps: failing tests (order, search, malformed line skipped, missing file → `[]`) → FAIL → implement → PASS.

### Task 4: Path guard, backups, config read/write

**Files:** Create `main/data/guard.js`, `main/data/backup.js`, `main/data/config.js`, `test/config.test.js`

**Interfaces:**
- `guard.assertWritable(target, knownProjects:string[])` throws `Error('Path not allowed: …')`.
- `backup.backupFile(target) → backupPath|null` (null if target did not exist); `backup.list() → [{id, original, time, size}]`; `backup.read(id) → string`; `backup.restore(id)` (itself backs up the current file first).
- `config.readJson(target) → {exists, raw, data|null, error|null}`; `config.writeText(target, text, {json:boolean, knownProjects}) → {backupPath}`; `config.locations(knownProjects) → [{scope:'user'|'project'|'local', kind:'settings'|'mcp'|'claudemd'|'claudejson', path, exists}]` covering `~/.claude/settings.json`, `~/.claude/CLAUDE.md`, `~/.claude.json`, and per project `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json`, `CLAUDE.md`.
- `config.diffLines(a, b) → [{op:'='|'+'|'-', line}]` (LCS line diff).
- [ ] **Step 1: Failing tests** (use a temp dir via `CCD_HOME` and a fake home via env `CCD_USER_HOME` that `paths` honors):
  - write with `json:true` and invalid JSON → throws, file unchanged, no backup created.
  - successful write → backup exists with old content; new content on disk; no `.tmp` left behind.
  - `readJson` on a file with invalid JSON → `{data:null, error: <message>, raw}`.
  - `assertWritable('<home>/.claude/../../evil.txt')` throws; `<home>/.claude/settings.json` passes; `<proj>/.mcp.json` passes only when `<proj>` is in knownProjects.
  - `restore` round-trip returns the original content and creates a backup of the replaced version.
  - `diffLines('a\nb\nc','a\nx\nc')` → `=a, -b, +x, =c`.
- [ ] **Step 2:** FAIL → **Step 3:** implement (write via `fs.writeFileSync(tmp)` + `fs.renameSync`) → **Step 4:** PASS.

### Task 5: Plugins, skills, agents, commands, memory inventory

**Files:** Create `main/data/plugins.js`, `test/plugins.test.js`, fixtures under `test/fixtures/home/.claude/`

**Interfaces:** `inventory(knownProjects) → { plugins:[{name, marketplace, enabled, path}], marketplaces:[{name, source}], skills:[{name, description, scope, path}], agents:[…same], commands:[…same], memory:[{project, files:[path]}] }`. Skills are any `SKILL.md` under `~/.claude/skills/**`, `~/.claude/plugins/**`, `<proj>/.claude/skills/**`; name/description from YAML frontmatter (simple `key: value` parser, no dependency). Agents: `agents/*.md`; commands: `commands/*.md`. Plugin enabled state from `settings.json` `enabledPlugins`. Memory from `~/.claude/projects/*/memory/*.md`.
`createFromTemplate(kind:'skill'|'agent'|'command', scope, name, knownProjects) → path` writes a starter file via `config.writeText`.
- [ ] Steps: failing tests (frontmatter parsing incl. quoted values, missing dirs → empty arrays, template creation path and contents start with `---\nname: <name>`) → FAIL → implement → PASS.

### Task 6: Runner (Command Center backend)

**Files:** Create `main/runner.js`, `test/runner.test.js`, `test/fixtures/fake-claude.js`

**Interfaces:**
- `createRunner({ claudeCmd = 'claude', spawnFn = child_process.spawn })` → `{ start({runId, prompt, cwd, model?, permissionMode?, resume?}, onEvent), stop(runId), version() → Promise<string|null>, openTerminal({cwd, resume?}) }`.
- Args: `['-p', prompt, '--output-format', 'stream-json', '--verbose']` + `--model m` + `--permission-mode p` + `--resume id`. On Windows spawn with `shell: true` so `claude.cmd` resolves; pass prompt via stdin (`--input-format text`) rather than argv to avoid quoting issues.
- `onEvent` receives `{type:'event', data:<parsed JSON line>}`, `{type:'stderr', text}`, `{type:'exit', code}`, `{type:'error', message}`.
- `parseLines(buffer) → {lines:string[], rest:string}` exported for tests.
- [ ] **Step 1: Failing tests:** `parseLines('{"a":1}\n{"b"')` → one line, rest `{"b"`; with `claudeCmd: process.execPath + ' test/fixtures/fake-claude.js'`, `start` emits the fixture's 3 JSON events then `exit 0`; fake in fail mode emits `stderr` and `exit 2`; nonexistent command → `error` or non-zero `exit` (no throw); `stop` kills the process (exit event received).
- [ ] **Step 2:** FAIL → implement → PASS.
- [ ] `openTerminal`: `wt.exe -d <cwd> cmd /k claude [--resume id]`, on spawn error fallback `cmd /c start "" /D <cwd> cmd /k claude …`. Not unit-tested; covered in Task 12.

### Task 7: Electron shell (main, preload, IPC, watcher, tray)

**Files:** Create `main/main.js`, `main/preload.js`, `main/ipc.js`, `main/data/watch.js`, `assets/icon.png` (generated 32×32 PNG via a tiny inline base64)

**Interfaces:** IPC channels (preload exposes `window.api.<name>(...args)` → `ipcRenderer.invoke(name, ...args)`, plus `window.api.on(channel, cb)` for pushes):
`sessions.list`, `sessions.get(id)`, `sessions.exportMarkdown(id) → string`, `stats.get(range)`, `history.list(query?)`, `config.locations`, `config.read(path)`, `config.preview(path, newText) → diffLines`, `config.write(path, text, json)`, `backups.list`, `backups.read(id)`, `backups.restore(id)`, `inventory.get`, `inventory.create(kind, scope, name)`, `pricing.get`, `pricing.set(overrides)` (stored in `<appData>/pricing.json`), `runner.start(opts) → runId`, `runner.stop(runId)`, `runner.version`, `terminal.open(opts)`, `shell.openPath(p)`, `clipboard.write(text)`, `dialog.pickFolder() → path|null`, `templates.list`, `templates.save(list)`.
Pushes: `transcripts-changed`, `runner-event` `{runId, ...event}`.
knownProjects = distinct `cwd` values from the transcript index.
- [ ] Window 1400×900, dark background `#0f1115`, security flags from Global Constraints, menu hidden.
- [ ] `watch.js`: `fs.watch(projectsDir, {recursive:true})` debounced 500 ms → `index.refresh()` → push `transcripts-changed`.
- [ ] Tray: tooltip and context menu "Today: N tokens · $X (est.)", Show, Quit; refreshed on `transcripts-changed`.
- [ ] Notification on `runner` exit: "Run finished" + first 80 chars of the prompt.
- [ ] Verify: `npm start` opens a blank window without console errors; DevTools `await window.api['sessions.list']()` returns an array.

### Task 8: Renderer foundation

**Files:** Create `renderer/index.html`, `renderer/app.css`, `renderer/app.js`, `renderer/lib/dom.js`, `renderer/lib/charts.js`, `renderer/lib/format.js`, `renderer/lib/md.js`, `renderer/lib/diffview.js`, `renderer/lib/search.js`

**Interfaces:**
- `dom.h(tag, attrs, ...children)`; `dom.toast(msg, kind)`; `dom.modal({title, body, actions}) → Promise<action>`.
- `charts.bar(el, {series:[{label, values}], labels})`, `charts.heatmap(el, byDay)`, `charts.donut(el, [{label, value}])`, `charts.sparkline(el, values)`: SVG, tooltip on hover, theme colors from CSS variables.
- `format.tokens(n)` (1.2K / 3.4M), `format.usd(n)` ("$1.23"), `format.ago(ts)`, `format.date(ts)`.
- `md.render(text) → safe HTML` (escape first; supports code fences, inline code, bold, italics, links, lists, headings).
- `diffview.confirmWrite(path, oldText, newText) → Promise<boolean>`: modal with colored diff and Save/Cancel; every Control save goes through this.
- `app.js`: sidebar with groups Insight / Control / Command Center and items per spec, hash router `#/<view>/<param>`, each view module exports `async render(container, param)`; Ctrl+K palette (`search.js`) searching session titles, prompt history and nav items.
- [ ] Verify: `npm start` → sidebar renders, navigating to each item shows its placeholder, Ctrl+K opens and Esc closes.

### Task 9: Insight views

**Files:** Create `renderer/views/overview.js`, `sessions.js`, `session.js`, `projects.js`, `tools.js`, `history.js`

- [ ] **Overview:** KPI tiles for Today / 7d / 30d / All (sessions, prompts, tokens, est. cost); 52-week heatmap; stacked bar of daily tokens by model (last 30 days); donut of model split; cache hit rate tile; streak tile. Re-renders on `transcripts-changed`.
- [ ] **Sessions:** table (title, project, branch, model, tokens, cost, last active); filters for text, project, model and date range; click → `#/session/<id>`.
- [ ] **Session replay:** header with metadata and actions (Resume in Command Center → `#/run?resume=<id>&cwd=<cwd>`, Open in terminal, Export Markdown → save via a download link). Timeline: user bubbles, assistant text via `md.render`, collapsible thinking, tool-call cards (name, input JSON, matching result truncated to 4 KB with expand, red if `is_error`), sidechain entries indented and labeled "subagent", per-turn usage chip.
- [ ] **Projects:** card grid (from `stats.byProject`); a card opens its CLAUDE.md (read-only preview + "Edit" → Memory view) and memory files.
- [ ] **Tools & Models:** tool frequency bar with error counts, top 20 Bash commands, top 20 edited files, MCP tools table, per-model tokens/cost table.
- [ ] **History:** search box with debounce; list of prompts with project and time; Copy and "Send to Command Center" (`#/run?prompt=<encoded>`).
- [ ] Verify with real data: Overview totals match `node -e` sum over `stats.get('all')`; opening the largest session renders without freezing (virtualize: render the first 200 entries, then "Load more").

### Task 10: Control views

**Files:** Create `renderer/views/settings.js`, `permissions.js`, `hooks.js`, `mcp.js`, `extensions.js`, `memory.js`, `backups.js`, `renderer/lib/jsonedit.js`

All saves: build new text → `config.preview` → `diffview.confirmWrite` → `config.write` → toast with backup path.
- [ ] **Settings:** scope switcher (user / each project / local); form fields for `model`, `theme`, `outputStyle`, `includeCoAuthoredBy`, `cleanupPeriodDays`, `statusLine.command`, `env` (key/value list), `autoUpdatesChannel`; "Raw JSON" tab with textarea and live parse validation. Unknown keys are preserved untouched. If the file is invalid JSON, show only the raw tab with the error banner. A "Pricing" sub-tab edits per-model $/MTok overrides via `pricing.get/set` (dashboard-only file, no backup needed).
- [ ] **Permissions:** three list editors for `permissions.allow|ask|deny` (add/remove/reorder), `permissions.defaultMode` select (`default`, `acceptEdits`, `plan`, `auto`, `bypassPermissions`), `additionalDirectories` list.
- [ ] **Hooks:** events `PreToolUse, PostToolUse, UserPromptSubmit, Notification, Stop, SubagentStop, PreCompact, SessionStart, SessionEnd`; per event, a list of `{matcher, hooks:[{type:'command', command, timeout?}]}` with an add/edit form; templates: "Log Bash commands to file", "Notify on Stop (PowerShell toast)", "Block edits to .env".
- [ ] **MCP:** user servers from `~/.claude.json` `mcpServers`, per-project from `~/.claude.json` `projects[<path>].mcpServers` and `<proj>/.mcp.json`; table with type, command/url and scope; add/edit form (stdio: command, args, env; http/sse: url, headers); remove. Writes to `~/.claude.json` preserve every other key.
- [ ] **Extensions:** tabs for Plugins (enable toggle → `settings.enabledPlugins`), Marketplaces, Skills, Agents, Commands; each item opens its file in a read-only viewer with "Open file"; a "New skill/agent/command" button → `inventory.create`.
- [ ] **Memory & CLAUDE.md:** file picker (global CLAUDE.md, each project CLAUDE.md / CLAUDE.local.md, memory files) and a textarea editor with a Markdown preview toggle.
- [ ] **Backups:** list newest first; selecting one shows a diff against the current file; Restore (with confirm modal).
- [ ] Verify against a throwaway copy: set `CCD_USER_HOME` to a scratch copy of `~/.claude` + `.claude.json`, edit each section, confirm the backup appears and the file content is correct.

### Task 11: Command Center view

**Files:** Create `renderer/views/run.js`, `renderer/views/actions.js`

- [ ] **Run:** run tabs (+ new); form with cwd (dropdown of known projects + Browse via `dialog.showOpenDialog` exposed as `dialog.pickFolder`), model select (default / `claude-opus-5-5` / `claude-sonnet-5-5` / `claude-haiku-5-5` / `claude-fable-5-1`), permission mode select, optional resume id (pre-filled from query params), prompt textarea (Ctrl+Enter sends). The stream renders `system/init` (session id, tools, model), assistant text/thinking/tool_use cards, `user` tool_result cards, and the final `result` (cost, duration, turns). Live token/cost meter from `usage` fields. Stop button. "Continue" sends a follow-up as a new run with `resume=<session_id from init>`. stderr shown in a collapsible red panel. If `runner.version` returns null, show the install hint `npm install -g @anthropic-ai/claude-code`.
- [ ] **Quick Actions:** prompt templates CRUD stored in `<appData>/templates.json` (IPC `templates.list/save`), each with "Run" → prefilled Run tab; "Open terminal here" per known project; shows `claude --version`.
- [ ] Verify: run `Say hi in 3 words` in this project folder → streamed text appears, result shows cost, the new session appears in Sessions within ~1 s.

### Task 12: Verification pass

- [ ] `npm test` → all suites PASS (paste summary).
- [ ] `npm start` smoke: each sidebar item renders with real data, no errors in DevTools console; Ctrl+K works; tray tooltip shows today's tokens; open-in-terminal opens Windows Terminal in the right folder; one Control edit on the scratch home shows diff → backup → restore works.
- [ ] Write `README.md`: what it is, `npm install`, `npm start`, data sources, safety model (backups, path guard), cost-estimate caveat.
