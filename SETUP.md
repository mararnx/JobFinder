# Setting up JobFinder on a Mac

JobFinder runs entirely on the job seeker's Mac. AI runs through **their own Claude Max subscription** via the Claude Code CLI. Nothing is uploaded anywhere except the text Claude reads.

## The easy way: let Claude Code set it up

1. Install the **Claude desktop app** from [claude.ai/download](https://claude.ai/download) and log in with your Claude (Max) account.
2. Open the **Code** tab and start a new session. When it asks for a folder, choose **Clone from GitHub** (or "Clone repository") and paste:
   ```
   https://github.com/mararnx/JobFinder
   ```
   Pick where it should go, e.g. your Documents folder. (No clone option? Install Git with `xcode-select --install` in Terminal, then in Terminal run `git clone https://github.com/mararnx/JobFinder ~/Documents/JobFinder` and open that folder in the Code tab.)
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
3. **A Gmail account** that applications should come from, with 2-Step Verification on. In JobFinder (Sources → Gmail) you paste an *app password* for it once – JobFinder puts every application into your Gmail drafts with the PDF attached, and moves jobs on the Pipeline when you send them or the company replies.

## 2. Install JobFinder

```bash
git clone https://github.com/mararnx/JobFinder ~/Documents/JobFinder
```
```bash
cd ~/Documents/JobFinder
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

Under **Sources** you can turn on Chrome search for jobs.ch, Indeed, XING and LinkedIn. It runs slowly (max 40 pages per portal per day by default) in JobFinder's own browser profile and stops for the day on any CAPTCHA, bot check or login wall. Portal terms forbid automated access and accounts can be restricted – keep it off if that matters to you.

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

## More job sources (setup wizard step "More sources", or Sources page)

Indeed and LinkedIn limit programs that browse them, so JobFinder gets their jobs the ways they allow:

- **Job alerts by email** – save a search with alerts on jobs.ch, Indeed, LinkedIn and XING, label the alert emails in Gmail with a filter (e.g. label "Job alerts"), and enter that label name. JobFinder reads it every 2 hours through the Gmail connection.
- **jobs.ch** – on by default, no key needed; it reads the search behind jobs.ch's website, slowly. Switch it off under More sources if you prefer.
- **Adzuna and Jooble** – free API keys (developer.adzuna.com, jooble.org/api/about); they aggregate many Swiss portals. For Jooble, choose Switzerland when asking for the key.
- **"Add to JobFinder" button** – drag it from the wizard into the browser's bookmarks bar; on any job ad, click it to add the ad with its full text.
- **Chrome search** – jobs.ch and XING work; LinkedIn runs once a day; Indeed is off by default.

## Troubleshooting

- **"Mock AI" badge although Claude Code is installed** – run `claude --version` in Terminal. If it isn't found, the app can't see it either; reinstall, or set `CLAUDE_BIN=/full/path/to/claude` before `npm start`. Sources → Claude lets you force "Always real".
- **"Worker not running"** in the sidebar – start with `npm start` (not `npm run web`), or check `data/kompass.log`.
- **"Gmail didn't accept the address and app password"** – the app password is the 16 letters from myaccount.google.com/apppasswords, not the normal Google password. If that page says app passwords aren't available, turn on 2-Step Verification first (work and school accounts may have them switched off by the admin).
- **"No label called … in Gmail"** – the name in Sources must match the Gmail label exactly, including capitals; a nested label is written `Parent/Child`.
- **Where is the app password?** In the macOS Keychain (Keychain Access → "JobFinder Gmail"), not in `data/`. Disconnect in Sources removes it; revoking it in the Google account cuts JobFinder off at once.
- **Run the tests**: `npm test` (uses a temporary database and simulated AI; touches nothing in `data/`).
