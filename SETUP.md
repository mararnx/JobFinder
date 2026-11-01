# Setting up Kompass on a Mac

Kompass runs entirely on the job seeker's Mac. AI runs through **their own Claude Max subscription** via the Claude Code CLI. Nothing is uploaded anywhere except the text Claude reads.

## 1. Install the basics (once)

1. **Node.js 22.13 or newer** – from [nodejs.org](https://nodejs.org) (LTS installer) or `brew install node`.
2. **Claude Code** – install it and log in once with the Max account:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
   ```bash
   claude
   ```
   Follow the login in the browser, then quit with `/exit`. Kompass now uses this login. Without it, Kompass still runs but every AI answer is simulated ("Mock AI" badge in the top bar).
3. **Apple Mail** set up with the email address applications should come from (Kompass opens ready-to-send drafts there).

## 2. Install Kompass

Copy this folder to the Mac (without `data/`, `data-dev/`, `node_modules/`, `.next/`), then in Terminal inside the folder:

```bash
npm install
```
```bash
npx playwright install chromium
```

## 3. Start

```bash
npm start
```

The first start builds the app (about a minute). Then open **http://localhost:4317** – the setup wizard walks through documents, personal details, the search and example ads.

To have Kompass start automatically at login (and restart if it crashes):

```bash
npm run setup:launchd
```

Undo with `npm run remove:launchd`. Logs go to `data/kompass.log`.

## 4. Optional: job portals in Chrome

Under **Sources** you can turn on Chrome search for StepStone, Indeed, XING and LinkedIn. It runs slowly (max 40 pages per portal per day by default) in Kompass's own browser profile and stops for the day on any CAPTCHA, bot check or login wall. Portal terms forbid automated access and accounts can be restricted – keep it off if that matters to you.

To search while logged in, open Kompass's browser once and log in yourself:

```bash
npm run browser
```

## Where things are

| What | Where |
|---|---|
| Database, uploaded documents, generated PDFs | `data/` (back this folder up; never share it) |
| Prompts Claude gets | `prompts/*.md` – edit to change tone or rules |
| Usage | Sidebar shows Claude calls in the last 5 hours; when the Max limit is hit, AI work pauses until it resets |

## Troubleshooting

- **"Mock AI" badge although Claude Code is installed** – run `claude --version` in Terminal. If it isn't found, the app can't see it either; reinstall, or set `CLAUDE_BIN=/full/path/to/claude` before `npm start`. Sources → Claude lets you force "Always real".
- **"Worker not running"** in the sidebar – start with `npm start` (not `npm run web`), or check `data/kompass.log`.
- **Apple Mail asks for permission** the first time Kompass opens a draft – allow it (System Settings → Privacy & Security → Automation).
- **Run the tests**: `npm test` (uses a temporary database and simulated AI; touches nothing in `data/`).
