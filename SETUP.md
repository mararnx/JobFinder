# Setting up JobFinder on a Mac

JobFinder runs entirely on the job seeker's Mac. AI runs through **their own Claude Max subscription** via the Claude Code CLI. Nothing is uploaded anywhere except the text Claude reads.

## The easy way: let Claude Code set it up

1. Install the **Claude desktop app** from [claude.ai/download](https://claude.ai/download) and log in with your Claude (Max) account.
2. Open the **Code** tab and start a new session. When it asks for a folder, choose **Clone from GitHub** (or "Clone repository") and paste:
   ```
   https://github.com/mararnx/kompass
   ```
   Pick where it should go, e.g. your Documents folder. (No clone option? Install Git with `xcode-select --install` in Terminal, then in Terminal run `git clone https://github.com/mararnx/kompass ~/Documents/kompass` and open that folder in the Code tab.)
3. Type:
   > Set up JobFinder for me and start it.

   Claude reads the project's instructions ([CLAUDE.md](CLAUDE.md)), installs what's missing, runs the tests and opens JobFinder in the browser. Say yes when it asks for permission to run commands. Once, it will ask you to log in to Claude in Terminal – that's the login JobFinder uses for its AI.
4. Later, to get a new version: open the same folder in Claude Code and say *"Update JobFinder"*.

The steps below are the same thing done by hand.

## 1. Install the basics (once)

1. **Node.js 22.13 or newer** – from [nodejs.org](https://nodejs.org) (LTS installer) or `brew install node`.
2. **Claude Code** – install it and log in once with the Max account:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
   ```bash
   claude
   ```
   Follow the login in the browser, then quit with `/exit`. JobFinder now uses this login. Without it, JobFinder still runs but every AI answer is simulated ("Mock AI" badge in the top bar).
3. **Apple Mail** set up with the email address applications should come from (JobFinder opens ready-to-send drafts there).

## 2. Install JobFinder

```bash
git clone https://github.com/mararnx/kompass ~/Documents/kompass
```
```bash
cd ~/Documents/kompass
```
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

To have JobFinder start automatically at login (and restart if it crashes):

```bash
npm run setup:launchd
```

Undo with `npm run remove:launchd`. Logs go to `data/kompass.log`.

## 4. Optional: job portals in Chrome

Under **Sources** you can turn on Chrome search for StepStone, Indeed, XING and LinkedIn. It runs slowly (max 40 pages per portal per day by default) in JobFinder's own browser profile and stops for the day on any CAPTCHA, bot check or login wall. Portal terms forbid automated access and accounts can be restricted – keep it off if that matters to you.

To search while logged in, open JobFinder's browser once and log in yourself:

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
- **Apple Mail asks for permission** the first time JobFinder opens a draft – allow it (System Settings → Privacy & Security → Automation).
- **Run the tests**: `npm test` (uses a temporary database and simulated AI; touches nothing in `data/`).
