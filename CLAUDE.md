# Kompass – notes for Claude Code

Kompass is a local job-search app (Next.js + a background worker, SQLite in `data/`) that runs on the job seeker's own Mac. Its AI calls go through the `claude` CLI on that Mac, using their Claude subscription. The person you are talking to is most likely the job seeker, not a developer: explain in plain words, run commands for them, and don't ask them to edit code.

## First-time setup

When asked to set up, install or start Kompass, do this in order and fix problems as you go:

1. **Node.js 22.13+**: `node --version`. If missing or older, suggest `brew install node` (if Homebrew is there) or the LTS installer from nodejs.org, and wait for them.
2. **Claude CLI**: `claude --version` in a normal shell. Kompass needs the CLI on the PATH, not just the desktop app. If missing: `npm install -g @anthropic-ai/claude-code`. Then ask them to run `claude` once in Terminal, log in with their Claude account in the browser, and quit with `/exit`. Without a login Kompass still runs, but every AI answer is simulated ("Mock AI" badge).
3. **Dependencies**: `npm install`, then `npx playwright install chromium`.
4. **Check**: `npm test` (temporary database, simulated AI, touches nothing in `data/`).
5. **Start**: `npm start` (run it in the background; the first start builds for about a minute). Then open http://localhost:4317 for them. The setup wizard in the app takes over from there (documents, personal details, search, example ads).
6. **Optional**: start at login with `npm run setup:launchd` (undo: `npm run remove:launchd`). Ask before doing this.
7. **Apple Mail** must have the account applications should be sent from; the first time Kompass opens a draft, macOS asks for Automation permission – tell them to allow it.

[SETUP.md](SETUP.md) has the same steps for humans plus troubleshooting; [PLAN.md](PLAN.md) explains how everything works.

## Updating

`git pull`, then `npm install`, then `npm start` (it rebuilds when the code changed and detects an already running Kompass). If Kompass runs via launchd, restart it with `npm run remove:launchd && npm run setup:launchd`.

## Rules

- `data/` holds their database, CV, certificates and generated applications. Never delete it, never commit it, never upload or paste its contents anywhere. It's in `.gitignore`; keep it that way.
- To look around without touching real data: `npm run demo` (fictional data in `data-demo/`, simulated AI, nothing sent).
- Changes to tone or writing rules belong in `prompts/*.md` or the app's settings, not in code.
- Don't push to GitHub unless they ask; this repository belongs to someone else, and their own changes stay on their Mac.
