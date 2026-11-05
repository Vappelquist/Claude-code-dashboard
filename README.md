# Claude Code Dashboard

A desktop console for Claude Code (Electron, Windows-first). It reads Claude Code's local data in `~/.claude`, so it needs no account, API key or network access, except for the runs you start yourself.

## Run it

```
npm install
npm start
```

Or double-click `Start Dashboard.cmd`. Closing the window keeps the app in the system tray; quit from the tray menu.

## What's inside

**Insight**
- **Overview**: tokens, prompts, sessions and estimated cost for today, 7 days, 30 days and all time. Also cache hit rate, streak, currently running Claude processes, daily tokens by model, model split, and a 12-month activity heatmap. Updates live while you work.
- **Sessions**: every conversation, filterable by text, project, model and date. Click one for a full replay: prompts, replies, thinking, tool calls with their inputs and results, subagents, and per-turn usage. You can also resume it, open it in a terminal, or export it to Markdown.
- **Projects**: per-project totals, CLAUDE.md preview and memory files.
- **Tools & Models**: tool frequency and errors, top Bash commands, most edited files, MCP tool usage, per-model tokens and cost.
- **Prompt History**: search everything you've typed, copy it, run it again, or jump to its session.

**Control** (every save shows a diff, makes a backup, and refuses to overwrite a file that changed on disk in the meantime)
- **Settings**: a form plus raw JSON for user, project and local `settings.json`. A cost-estimate price table is under *Settings → Cost estimates*.
- **Permissions**: allow, ask and deny rules, default mode, and additional directories.
- **Hooks**: per-event hooks with templates (log Bash, toast on Stop, block `.env` edits, run Prettier).
- **MCP Servers**: user, private-per-project and shared (`.mcp.json`) servers. You can add, edit and remove them.
- **Plugins & Skills**: plugins (enable or disable), skills, agents, slash commands and marketplace catalogs. You can create new skills, agents and commands from templates.
- **Memory & CLAUDE.md**: edit global and project instructions and auto-memory files.
- **Backups**: browse, diff and restore every file the dashboard has changed.

**Command Center**
- **Run**: tabbed headless runs (`claude -p --output-format stream-json`) with a chosen folder, model and permission mode. Replies stream live with tool cards, a token meter, Stop, and follow-ups that continue the same session. "Open in terminal" launches the real interactive `claude` in Windows Terminal.
- **Quick Actions**: prompt templates, per-project terminal and run shortcuts, CLI version check.

Press **Ctrl+K** anywhere to search pages, sessions and prompts.

## Notes

- **Costs are API-equivalent estimates** from a price table you can edit. On a Pro or Max plan you are not billed per token.
- The dashboard can only write inside `~/.claude/`, `~/.claude.json`, and known projects' `.claude/`, `.mcp.json`, `CLAUDE.md` and `CLAUDE.local.md`. This is enforced in the main process.
- Backups (the newest 20 per file) and dashboard settings (prices, templates) live in `%LOCALAPPDATA%\claude-dashboard`, not in this folder. This folder may be cloud-synced, and config files can contain secrets.
- Headless runs can't answer permission prompts. Pick a permission mode that allows what the task needs, or use "Open in terminal".

## Development

- `npm test`: unit tests for the data layer (`node --test`).
- `CCD_SMOKE=<dir> npm start`: opens every view, saves screenshots to `<dir>`, and exits non-zero on console errors.
- `CCD_USER_HOME=<dir>`: point the app at a different home folder, for example a scratch copy of `~/.claude`.
