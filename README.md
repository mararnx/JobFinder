# JobFinder

A local job-search funnel for the German market: finds ads (Arbeitsagentur API, company career feeds, optional Chrome search on portals, links you add yourself), ranks them against what you actually want, drafts tailored applications you approve with one keystroke, and tracks every job to an offer. AI runs on a Claude Max subscription through the Claude Code CLI.

- **Set up:** [SETUP.md](SETUP.md) – easiest is to open this repo in Claude Code and say *"Set up JobFinder for me and start it"*
- **How it works and why:** [PLAN.md](PLAN.md)
- **Design reference:** [design/prototype.html](design/prototype.html)

```bash
npm install && npx playwright install chromium && npm start
```
```bash
npm test
```
`npm run test:ui` clicks through every screen in a real browser against the production build, on a throwaway copy of the demo data.

## Demo

`npm run demo` starts JobFinder on a separate `data-demo/` folder filled with a fictional job seeker and ~30 fictional ads spread over every stage (matches to triage, drafts to review, applications, interviews, a final round). AI is simulated and nothing is sent; your real `data/` is untouched. `npm run demo:seed` rebuilds the demo data from scratch.

```bash
npm run demo
```
